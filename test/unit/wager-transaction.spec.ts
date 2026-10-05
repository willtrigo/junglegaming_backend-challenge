import { describe, expect, test } from "bun:test";
import { DomainError } from "@/shared/domain/domain-error";
import { Money } from "@/shared/domain/money/money";
import { FailureCode, providerActionFor } from "@/wagering/domain/failure-code.enum";
import { computePayloadHash } from "@/wagering/domain/payload-hash";
import {
  InvalidTransactionError,
  InvalidTransactionStateError,
  NoLedgerEffectError,
  OpeningNotSubmittableError,
  ReferenceRequiredError,
} from "@/wagering/domain/wager.errors";
import {
  type CreateWagerTransactionProps,
  INTERNAL_PROVIDER_ID,
  WagerTransaction,
  type WagerTransactionState,
} from "@/wagering/domain/wager-transaction";
import { WagerTransactionKind } from "@/wagering/domain/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "@/wagering/domain/wager-transaction-status.enum";
import { LedgerDirection } from "@/wallets/domain/ledger-direction.enum";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });

const T0 = new Date("2026-10-03T12:00:00.000Z");
const T1 = new Date("2026-10-03T12:00:01.000Z");
const T2 = new Date("2026-10-03T12:00:02.000Z");
const RETRY_AT = new Date("2026-10-03T12:00:10.000Z");

const money = brl("25.00");

const createProps = (
  overrides: Partial<CreateWagerTransactionProps> = {},
): CreateWagerTransactionProps => {
  const kind = overrides.kind ?? WagerTransactionKind.Bet;
  const referenceExternalTransactionId =
    overrides.referenceExternalTransactionId ??
    (kind === WagerTransactionKind.Refund || kind === WagerTransactionKind.Rollback
      ? "ext-reference"
      : undefined);

  return {
    id: "tx-1",
    providerId: "provider-a",
    externalTransactionId: "ext-1",
    idempotencyKey: "provider-a:ext-1",
    payloadHash: computePayloadHash({
      providerId: "provider-a",
      externalTransactionId: "ext-1",
      playerId: "player-1",
      walletId: "wallet-1",
      roundId: "round-1",
      gameId: "game-1",
      kind,
      money,
      referenceExternalTransactionId,
    }),
    walletId: "wallet-1",
    playerId: "player-1",
    roundId: "round-1",
    gameId: "game-1",
    kind,
    money,
    referenceExternalTransactionId,
    createdAt: T0,
    ...overrides,
  };
};

const newTransaction = (overrides: Partial<CreateWagerTransactionProps> = {}): WagerTransaction =>
  WagerTransaction.create(createProps(overrides));

const stateInStatus = (
  status: WagerTransactionStatus,
  kind: WagerTransactionKind = WagerTransactionKind.Bet,
): WagerTransactionState => ({
  ...createProps({ kind }),
  status,
  referenceAttempts: 0,
  updatedAt: T0,
});

const inStatus = (
  status: WagerTransactionStatus,
  kind: WagerTransactionKind = WagerTransactionKind.Bet,
): WagerTransaction => WagerTransaction.rehydrate(stateInStatus(status, kind));

const TERMINAL: WagerTransactionStatus[] = [
  WagerTransactionStatus.Processed,
  WagerTransactionStatus.Rejected,
  WagerTransactionStatus.Failed,
];

type Transition = (transaction: WagerTransaction) => void;

const TRANSITIONS: ReadonlyArray<readonly [string, WagerTransactionStatus, Transition]> = [
  [
    "markPendingReference",
    WagerTransactionStatus.PendingReference,
    (t) => t.markPendingReference(T1, RETRY_AT),
  ],
  [
    "markProcessed",
    WagerTransactionStatus.Processed,
    (t) => t.markProcessed(undefined, T1, brl("75.00")),
  ],
  ["reject", WagerTransactionStatus.Rejected, (t) => t.reject(FailureCode.InsufficientFunds, T1)],
  ["fail", WagerTransactionStatus.Failed, (t) => t.fail(FailureCode.InfrastructureFailure, T1)],
];

describe("WagerTransaction", () => {
  describe("create", () => {
    test("is born PENDING with the submitted business fields", () => {
      const transaction = newTransaction();

      expect(transaction.status).toBe(WagerTransactionStatus.Pending);
      expect(transaction.kind).toBe(WagerTransactionKind.Bet);
      expect(transaction.money.amount).toBe("25.00");
      expect(transaction.providerId).toBe("provider-a");
      expect(transaction.createdAt).toEqual(T0);
      expect(transaction.updatedAt).toEqual(T0);
      expect(transaction.referenceAttempts).toBe(0);
      expect(transaction.processedAt).toBeUndefined();
      expect(transaction.failureCode).toBeUndefined();
      expect(transaction.isTerminal()).toBe(false);
    });

    test("rejects OPENING: it is internal and cannot be submitted", () => {
      expect(() => newTransaction({ kind: WagerTransactionKind.Opening })).toThrow(
        OpeningNotSubmittableError,
      );
    });

    test("rejects the reserved internal provider", () => {
      expect(() => newTransaction({ providerId: INTERNAL_PROVIDER_ID })).toThrow(
        InvalidTransactionError,
      );
    });

    test.each([
      ["providerId"],
      ["externalTransactionId"],
      ["idempotencyKey"],
      ["walletId"],
      ["playerId"],
      ["roundId"],
      ["gameId"],
    ] as const)("rejects a blank %s", (field) => {
      expect(() => newTransaction({ [field]: "   " })).toThrow(InvalidTransactionError);
    });

    test.each(["", "ABC", "g".repeat(64), "a".repeat(63), "A".repeat(64)])(
      "rejects a malformed payload hash (%p)",
      (payloadHash) => {
        expect(() => newTransaction({ payloadHash })).toThrow(InvalidTransactionError);
      },
    );

    test.each([
      WagerTransactionKind.Bet,
      WagerTransactionKind.Win,
      WagerTransactionKind.Refund,
      WagerTransactionKind.Rollback,
    ])("rejects a zero amount for %s", (kind) => {
      expect(() => newTransaction({ kind, money: brl("0.00") })).toThrow(InvalidTransactionError);
    });

    test("allows LOSS with a zero amount", () => {
      const transaction = newTransaction({
        kind: WagerTransactionKind.Loss,
        money: brl("0.00"),
      });

      expect(transaction.money.isZero()).toBe(true);
    });

    test("rejects a negative amount for every kind", () => {
      for (const kind of [WagerTransactionKind.Bet, WagerTransactionKind.Loss]) {
        expect(() => newTransaction({ kind, money: brl("1.00").negate() })).toThrow(
          InvalidTransactionError,
        );
      }
    });

    test.each([WagerTransactionKind.Refund, WagerTransactionKind.Rollback])(
      "%s requires a reference",
      (kind) => {
        const props = createProps({ kind });
        expect(() =>
          WagerTransaction.create({ ...props, referenceExternalTransactionId: undefined }),
        ).toThrow(ReferenceRequiredError);
        expect(() =>
          WagerTransaction.create({ ...props, referenceExternalTransactionId: "  " }),
        ).toThrow(ReferenceRequiredError);
      },
    );

    test("WIN may carry a reference to its BET", () => {
      const transaction = newTransaction({
        kind: WagerTransactionKind.Win,
        referenceExternalTransactionId: "ext-bet",
      });

      expect(transaction.referenceExternalTransactionId).toBe("ext-bet");
      expect(transaction.requiresReference()).toBe(false);
    });
  });

  describe("createOpening", () => {
    const opening = (): WagerTransaction =>
      WagerTransaction.createOpening({
        id: "tx-opening",
        walletId: "wallet-1",
        playerId: "player-1",
        money: brl("1000.00"),
        createdAt: T0,
      });

    test("builds the internal OPENING transaction in PENDING", () => {
      const transaction = opening();

      expect(transaction.kind).toBe(WagerTransactionKind.Opening);
      expect(transaction.providerId).toBe(INTERNAL_PROVIDER_ID);
      expect(transaction.externalTransactionId).toBe("opening:wallet-1");
      expect(transaction.idempotencyKey).toBe("opening:wallet-1");
      expect(transaction.status).toBe(WagerTransactionStatus.Pending);
      expect(transaction.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    });

    test("is a credit and does not require a reference", () => {
      const transaction = opening();

      expect(transaction.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
      expect(transaction.requiresReference()).toBe(false);
      expect(transaction.affectsBalance()).toBe(true);
    });

    test("can be marked processed like any other transaction", () => {
      const transaction = opening();

      transaction.markProcessed(undefined, T1, brl("1000.00"));

      expect(transaction.status).toBe(WagerTransactionStatus.Processed);
    });

    test("rejects a zero opening amount", () => {
      expect(() =>
        WagerTransaction.createOpening({
          id: "tx-opening",
          walletId: "wallet-1",
          playerId: "player-1",
          money: brl("0.00"),
          createdAt: T0,
        }),
      ).toThrow(InvalidTransactionError);
    });
  });

  describe("state machine", () => {
    test.each(TRANSITIONS)("PENDING -> %s is allowed", (_name, expected, transition) => {
      const transaction = inStatus(WagerTransactionStatus.Pending);

      transition(transaction);

      expect(transaction.status).toBe(expected);
    });

    test.each(TRANSITIONS.filter(([name]) => name !== "markPendingReference"))(
      "PENDING_REFERENCE -> %s is allowed",
      (_name, expected, transition) => {
        const transaction = inStatus(WagerTransactionStatus.PendingReference);

        transition(transaction);

        expect(transaction.status).toBe(expected);
      },
    );

    test("PENDING_REFERENCE -> PENDING_REFERENCE through markPendingReference is not allowed", () => {
      const transaction = inStatus(WagerTransactionStatus.PendingReference);

      expect(() => transaction.markPendingReference(T1, RETRY_AT)).toThrow(
        InvalidTransactionStateError,
      );
    });

    describe.each(TERMINAL)("terminal state %s", (status) => {
      test.each(TRANSITIONS)("%s throws InvalidTransactionStateError", (_name, _to, transition) => {
        const transaction = inStatus(status);

        expect(() => transition(transaction)).toThrow(InvalidTransactionStateError);
      });

      test("recordReferenceAttempt throws as well", () => {
        expect(() => inStatus(status).recordReferenceAttempt(T1, RETRY_AT)).toThrow(
          InvalidTransactionStateError,
        );
      });

      test("a failed transition leaves the transaction untouched", () => {
        const transaction = inStatus(status);

        expect(() => transaction.reject(FailureCode.WalletNotFound, T2)).toThrow();

        expect(transaction.status).toBe(status);
        expect(transaction.failureCode).toBeUndefined();
        expect(transaction.updatedAt).toEqual(T0);
      });

      test("isTerminal is true", () => {
        expect(inStatus(status).isTerminal()).toBe(true);
      });
    });

    test("PENDING and PENDING_REFERENCE are not terminal", () => {
      expect(inStatus(WagerTransactionStatus.Pending).isTerminal()).toBe(false);
      expect(inStatus(WagerTransactionStatus.PendingReference).isTerminal()).toBe(false);
    });

    test("the transition error carries a stable code and the states involved", () => {
      const transaction = inStatus(WagerTransactionStatus.Processed);

      try {
        transaction.reject(FailureCode.InsufficientFunds, T1);
        expect.unreachable("expected an InvalidTransactionStateError");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as InvalidTransactionStateError).code).toBe(
          "WAGER_INVALID_TRANSACTION_STATE",
        );
        expect((error as InvalidTransactionStateError).from).toBe(WagerTransactionStatus.Processed);
        expect((error as InvalidTransactionStateError).to).toBe(WagerTransactionStatus.Rejected);
      }
    });
  });

  describe("markProcessed", () => {
    test("records the outcome, the observed balance and the processing time", () => {
      const transaction = newTransaction();

      transaction.markProcessed(undefined, T1, brl("75.00"));

      expect(transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(transaction.processedAt).toEqual(T1);
      expect(transaction.updatedAt).toEqual(T1);
      expect(transaction.observedBalance?.amount).toBe("75.00");
      expect(transaction.failureCode).toBeUndefined();
    });

    test.each([WagerTransactionKind.Refund, WagerTransactionKind.Rollback])(
      "%s stores its resolved reference",
      (kind) => {
        const transaction = newTransaction({ kind });

        transaction.markProcessed("tx-referenced", T1, brl("100.00"));

        expect(transaction.referenceTransactionId).toBe("tx-referenced");
      },
    );

    test.each([WagerTransactionKind.Refund, WagerTransactionKind.Rollback])(
      "%s cannot be processed without a resolved reference, and stays PENDING",
      (kind) => {
        const transaction = newTransaction({ kind });

        expect(() => transaction.markProcessed(undefined, T1, brl("100.00"))).toThrow(
          ReferenceRequiredError,
        );

        expect(transaction.status).toBe(WagerTransactionStatus.Pending);
        expect(transaction.processedAt).toBeUndefined();
      },
    );

    test("clears the scheduled reference retry when it leaves PENDING_REFERENCE", () => {
      const transaction = newTransaction({ kind: WagerTransactionKind.Refund });
      transaction.markPendingReference(T1, RETRY_AT);

      transaction.markProcessed("tx-referenced", T2, brl("100.00"));

      expect(transaction.nextReferenceAttemptAt).toBeUndefined();
    });
  });

  describe("reject and fail", () => {
    test("reject stores the failure code and the observed balance, without processedAt", () => {
      const transaction = newTransaction();

      transaction.reject(FailureCode.InsufficientFunds, T1, brl("20.00"));

      expect(transaction.status).toBe(WagerTransactionStatus.Rejected);
      expect(transaction.failureCode).toBe(FailureCode.InsufficientFunds);
      expect(transaction.observedBalance?.amount).toBe("20.00");
      expect(transaction.processedAt).toBeUndefined();
      expect(transaction.updatedAt).toEqual(T1);
    });

    test("reject does not require an observed balance", () => {
      const transaction = newTransaction();

      transaction.reject(FailureCode.WalletNotFound, T1);

      expect(transaction.observedBalance).toBeUndefined();
    });

    test("fail stores the failure code", () => {
      const transaction = newTransaction();

      transaction.fail(FailureCode.InfrastructureFailure, T1);

      expect(transaction.status).toBe(WagerTransactionStatus.Failed);
      expect(transaction.failureCode).toBe(FailureCode.InfrastructureFailure);
      expect(transaction.processedAt).toBeUndefined();
    });

    test("a rejected reversal keeps both distinct overdraw and bet failure codes apart", () => {
      expect(FailureCode.ReversalWouldOverdraw).not.toBe(FailureCode.InsufficientFunds);
    });
  });

  describe("pending reference", () => {
    test("markPendingReference schedules the first retry", () => {
      const transaction = newTransaction({ kind: WagerTransactionKind.Refund });

      transaction.markPendingReference(T1, RETRY_AT);

      expect(transaction.status).toBe(WagerTransactionStatus.PendingReference);
      expect(transaction.nextReferenceAttemptAt).toEqual(RETRY_AT);
      expect(transaction.referenceAttempts).toBe(0);
      expect(transaction.updatedAt).toEqual(T1);
    });

    test("recordReferenceAttempt counts the attempt and reschedules", () => {
      const transaction = newTransaction({ kind: WagerTransactionKind.Refund });
      transaction.markPendingReference(T1, RETRY_AT);
      const later = new Date("2026-10-03T12:01:00.000Z");

      transaction.recordReferenceAttempt(T2, later);
      transaction.recordReferenceAttempt(T2, later);

      expect(transaction.referenceAttempts).toBe(2);
      expect(transaction.nextReferenceAttemptAt).toEqual(later);
      expect(transaction.status).toBe(WagerTransactionStatus.PendingReference);
    });

    test("recordReferenceAttempt is invalid while PENDING", () => {
      expect(() => newTransaction().recordReferenceAttempt(T1, RETRY_AT)).toThrow(
        InvalidTransactionStateError,
      );
    });

    test("exhausted retries end in REJECTED with REFERENCE_NOT_FOUND and clear the schedule", () => {
      const transaction = newTransaction({ kind: WagerTransactionKind.Rollback });
      transaction.markPendingReference(T1, RETRY_AT);

      transaction.reject(FailureCode.ReferenceNotFound, T2);

      expect(transaction.status).toBe(WagerTransactionStatus.Rejected);
      expect(transaction.failureCode).toBe(FailureCode.ReferenceNotFound);
      expect(transaction.nextReferenceAttemptAt).toBeUndefined();
    });
  });

  describe("domain queries", () => {
    test.each([
      [WagerTransactionKind.Bet, true],
      [WagerTransactionKind.Win, true],
      [WagerTransactionKind.Loss, false],
      [WagerTransactionKind.Refund, true],
      [WagerTransactionKind.Rollback, true],
    ])("affectsBalance for %s is %p", (kind, expected) => {
      expect(newTransaction({ kind }).affectsBalance()).toBe(expected);
    });

    test.each([
      [WagerTransactionKind.Bet, false],
      [WagerTransactionKind.Win, false],
      [WagerTransactionKind.Loss, false],
      [WagerTransactionKind.Refund, true],
      [WagerTransactionKind.Rollback, true],
    ])("requiresReference for %s is %p", (kind, expected) => {
      expect(newTransaction({ kind }).requiresReference()).toBe(expected);
    });

    test("matchesPayload compares the stored hash", () => {
      const transaction = newTransaction();

      expect(transaction.matchesPayload(transaction.payloadHash)).toBe(true);
      expect(transaction.matchesPayload("f".repeat(64))).toBe(false);
    });

    test.each([
      [WagerTransactionKind.Bet, WagerTransactionKind.Refund, true],
      [WagerTransactionKind.Win, WagerTransactionKind.Refund, false],
      [WagerTransactionKind.Refund, WagerTransactionKind.Refund, false],
      [WagerTransactionKind.Loss, WagerTransactionKind.Refund, false],
      [WagerTransactionKind.Bet, WagerTransactionKind.Rollback, true],
      [WagerTransactionKind.Win, WagerTransactionKind.Rollback, true],
      [WagerTransactionKind.Refund, WagerTransactionKind.Rollback, true],
      [WagerTransactionKind.Rollback, WagerTransactionKind.Rollback, false],
      [WagerTransactionKind.Loss, WagerTransactionKind.Rollback, false],
      [WagerTransactionKind.Opening, WagerTransactionKind.Rollback, false],
      [WagerTransactionKind.Bet, WagerTransactionKind.Win, false],
    ])(
      "a %s referenced by a %s: canBeRevertedBy is %p",
      (referenceKind, reversalKind, expected) => {
        const reference = inStatus(WagerTransactionStatus.Processed, referenceKind);

        expect(reference.canBeRevertedBy(reversalKind)).toBe(expected);
      },
    );
  });

  describe("ledgerDirectionFor", () => {
    test.each([
      [WagerTransactionKind.Bet, LedgerDirection.Debit],
      [WagerTransactionKind.Win, LedgerDirection.Credit],
      [WagerTransactionKind.Refund, LedgerDirection.Credit],
    ])("%s produces a %s entry", (kind, expected) => {
      expect(newTransaction({ kind }).ledgerDirectionFor()).toBe(expected);
    });

    test("LOSS has no ledger effect", () => {
      expect(() =>
        newTransaction({ kind: WagerTransactionKind.Loss }).ledgerDirectionFor(),
      ).toThrow(NoLedgerEffectError);
    });

    test.each([
      [WagerTransactionKind.Bet, LedgerDirection.Credit],
      [WagerTransactionKind.Win, LedgerDirection.Debit],
      [WagerTransactionKind.Refund, LedgerDirection.Debit],
    ])("ROLLBACK of a %s is the inverse: %s", (referenceKind, expected) => {
      const rollback = newTransaction({ kind: WagerTransactionKind.Rollback });
      const reference = inStatus(WagerTransactionStatus.Processed, referenceKind);

      expect(rollback.ledgerDirectionFor(reference)).toBe(expected);
    });

    test("ROLLBACK without its reference cannot decide a direction", () => {
      const rollback = newTransaction({ kind: WagerTransactionKind.Rollback });

      expect(() => rollback.ledgerDirectionFor()).toThrow(ReferenceRequiredError);
    });

    test.each([
      WagerTransactionKind.Loss,
      WagerTransactionKind.Rollback,
      WagerTransactionKind.Opening,
    ])("ROLLBACK refuses to revert a %s", (referenceKind) => {
      const rollback = newTransaction({ kind: WagerTransactionKind.Rollback });
      const reference = inStatus(WagerTransactionStatus.Processed, referenceKind);

      expect(() => rollback.ledgerDirectionFor(reference)).toThrow(InvalidTransactionError);
    });
  });

  describe("rehydrate", () => {
    test("restores persisted state without revalidating it", () => {
      const transaction = WagerTransaction.rehydrate({
        ...stateInStatus(WagerTransactionStatus.Processed),
        processedAt: undefined,
        referenceAttempts: 3,
        observedBalance: brl("75.00"),
      });

      expect(transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(transaction.referenceAttempts).toBe(3);
      expect(transaction.observedBalance?.amount).toBe("75.00");
    });

    test("rehydrated terminal transactions stay final", () => {
      const transaction = WagerTransaction.rehydrate(
        stateInStatus(WagerTransactionStatus.Rejected),
      );

      expect(() => transaction.markProcessed(undefined, T1, brl("1.00"))).toThrow(
        InvalidTransactionStateError,
      );
    });

    test("rehydrated PENDING_REFERENCE transactions keep retrying", () => {
      const transaction = WagerTransaction.rehydrate({
        ...stateInStatus(WagerTransactionStatus.PendingReference, WagerTransactionKind.Refund),
        referenceAttempts: 2,
        nextReferenceAttemptAt: RETRY_AT,
      });

      transaction.recordReferenceAttempt(T1, RETRY_AT);

      expect(transaction.referenceAttempts).toBe(3);
    });
  });

  describe("failure code contract", () => {
    test("every failure code tells the provider what to do", () => {
      for (const code of Object.values(FailureCode)) {
        expect(["FIX_PAYLOAD", "DO_NOT_RETRY", "CONTACT_SUPPORT"]).toContain(
          providerActionFor(code),
        );
      }
    });

    test("failure code values are unique and uppercase snake case", () => {
      const values = Object.values(FailureCode);

      expect(new Set(values).size).toBe(values.length);
      for (const value of values) {
        expect(value).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
      }
    });
  });
});
