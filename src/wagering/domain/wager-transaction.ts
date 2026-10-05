import type { Money } from "@/shared/domain/money/money";
import { LedgerDirection } from "@/wallets/domain/ledger-direction.enum";
import type { FailureCode } from "./failure-code.enum";
import { computePayloadHash } from "./payload-hash";
import {
  InvalidTransactionError,
  InvalidTransactionStateError,
  NoLedgerEffectError,
  OpeningNotSubmittableError,
  ReferenceRequiredError,
} from "./wager.errors";
import { WagerTransactionKind } from "./wager-transaction-kind.enum";
import { WagerTransactionStatus } from "./wager-transaction-status.enum";

export const INTERNAL_PROVIDER_ID = "internal";

const PAYLOAD_HASH_PATTERN = /^[0-9a-f]{64}$/;

const ALLOWED_TRANSITIONS: Readonly<
  Record<WagerTransactionStatus, readonly WagerTransactionStatus[]>
> = {
  [WagerTransactionStatus.Pending]: [
    WagerTransactionStatus.PendingReference,
    WagerTransactionStatus.Processed,
    WagerTransactionStatus.Rejected,
    WagerTransactionStatus.Failed,
  ],
  [WagerTransactionStatus.PendingReference]: [
    WagerTransactionStatus.Processed,
    WagerTransactionStatus.Rejected,
    WagerTransactionStatus.Failed,
  ],
  [WagerTransactionStatus.Processed]: [],
  [WagerTransactionStatus.Rejected]: [],
  [WagerTransactionStatus.Failed]: [],
};

const REVERTIBLE_KINDS: Readonly<Record<WagerTransactionKind, readonly WagerTransactionKind[]>> = {
  [WagerTransactionKind.Opening]: [],
  [WagerTransactionKind.Bet]: [],
  [WagerTransactionKind.Win]: [],
  [WagerTransactionKind.Loss]: [],
  [WagerTransactionKind.Refund]: [WagerTransactionKind.Bet],
  [WagerTransactionKind.Rollback]: [
    WagerTransactionKind.Bet,
    WagerTransactionKind.Win,
    WagerTransactionKind.Refund,
  ],
};

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string | undefined;
  status: WagerTransactionStatus;
  referenceTransactionId?: string | undefined;
  failureCode?: FailureCode | undefined;
  observedBalance?: Money | undefined;
  referenceAttempts: number;
  nextReferenceAttemptAt?: Date | undefined;
  createdAt: Date;
  updatedAt: Date;
  processedAt?: Date | undefined;
}

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string | undefined;
  createdAt: Date;
}

export interface CreateOpeningTransactionProps {
  id: string;
  walletId: string;
  playerId: string;
  money: Money;
  createdAt: Date;
}

export class WagerTransaction {
  public readonly id: string;
  public readonly providerId: string;
  public readonly externalTransactionId: string;
  public readonly idempotencyKey: string;
  public readonly payloadHash: string;
  public readonly walletId: string;
  public readonly playerId: string;
  public readonly roundId: string;
  public readonly gameId: string;
  public readonly kind: WagerTransactionKind;
  public readonly money: Money;
  public readonly referenceExternalTransactionId: string | undefined;
  public readonly createdAt: Date;

  private _status: WagerTransactionStatus;
  private _referenceTransactionId: string | undefined;
  private _failureCode: FailureCode | undefined;
  private _observedBalance: Money | undefined;
  private _referenceAttempts: number;
  private _nextReferenceAttemptAt: Date | undefined;
  private _updatedAt: Date;
  private _processedAt: Date | undefined;

  private constructor(state: WagerTransactionState) {
    this.id = state.id;
    this.providerId = state.providerId;
    this.externalTransactionId = state.externalTransactionId;
    this.idempotencyKey = state.idempotencyKey;
    this.payloadHash = state.payloadHash;
    this.walletId = state.walletId;
    this.playerId = state.playerId;
    this.roundId = state.roundId;
    this.gameId = state.gameId;
    this.kind = state.kind;
    this.money = state.money;
    this.referenceExternalTransactionId = state.referenceExternalTransactionId;
    this.createdAt = state.createdAt;
    this._status = state.status;
    this._referenceTransactionId = state.referenceTransactionId;
    this._failureCode = state.failureCode;
    this._observedBalance = state.observedBalance;
    this._referenceAttempts = state.referenceAttempts;
    this._nextReferenceAttemptAt = state.nextReferenceAttemptAt;
    this._updatedAt = state.updatedAt;
    this._processedAt = state.processedAt;
  }

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (props.kind === WagerTransactionKind.Opening) {
      throw new OpeningNotSubmittableError();
    }
    if (props.providerId === INTERNAL_PROVIDER_ID) {
      throw new InvalidTransactionError(`provider "${INTERNAL_PROVIDER_ID}" is reserved`);
    }

    WagerTransaction.assertValidFields(props);
    WagerTransaction.assertValidMoney(props.kind, props.money);

    if (WagerTransaction.kindRequiresReference(props.kind)) {
      if (!props.referenceExternalTransactionId?.trim()) {
        throw new ReferenceRequiredError(props.kind);
      }
    }

    return new WagerTransaction({
      ...props,
      status: WagerTransactionStatus.Pending,
      referenceAttempts: 0,
      updatedAt: props.createdAt,
    });
  }

  static createOpening(props: CreateOpeningTransactionProps): WagerTransaction {
    if (!props.money.isPositive()) {
      throw new InvalidTransactionError("opening amount must be greater than zero");
    }

    const externalTransactionId = `opening:${props.walletId}`;
    const fields = {
      providerId: INTERNAL_PROVIDER_ID,
      externalTransactionId,
      playerId: props.playerId,
      walletId: props.walletId,
      roundId: "opening",
      gameId: "opening",
      kind: WagerTransactionKind.Opening,
      money: props.money,
    };

    return new WagerTransaction({
      id: props.id,
      ...fields,
      idempotencyKey: externalTransactionId,
      payloadHash: computePayloadHash(fields),
      status: WagerTransactionStatus.Pending,
      referenceAttempts: 0,
      createdAt: props.createdAt,
      updatedAt: props.createdAt,
    });
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(state);
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get observedBalance(): Money | undefined {
    return this._observedBalance;
  }

  get referenceAttempts(): number {
    return this._referenceAttempts;
  }

  get nextReferenceAttemptAt(): Date | undefined {
    return this._nextReferenceAttemptAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  markProcessed(
    referenceTransactionId: string | undefined,
    at: Date,
    observedBalance: Money,
  ): void {
    this.assertCanMoveTo(WagerTransactionStatus.Processed);
    if (this.requiresReference() && referenceTransactionId === undefined) {
      throw new ReferenceRequiredError(this.kind);
    }

    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._observedBalance = observedBalance;
    this._processedAt = at;
    this._nextReferenceAttemptAt = undefined;
    this._updatedAt = at;
  }

  markPendingReference(at: Date, nextAttemptAt: Date): void {
    this.assertCanMoveTo(WagerTransactionStatus.PendingReference);

    this._status = WagerTransactionStatus.PendingReference;
    this._nextReferenceAttemptAt = nextAttemptAt;
    this._updatedAt = at;
  }

  recordReferenceAttempt(at: Date, nextAttemptAt: Date): void {
    if (this._status !== WagerTransactionStatus.PendingReference) {
      throw new InvalidTransactionStateError(
        this.id,
        this._status,
        WagerTransactionStatus.PendingReference,
      );
    }

    this._referenceAttempts += 1;
    this._nextReferenceAttemptAt = nextAttemptAt;
    this._updatedAt = at;
  }

  reject(code: FailureCode, at: Date, observedBalance?: Money): void {
    this.assertCanMoveTo(WagerTransactionStatus.Rejected);

    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._observedBalance = observedBalance;
    this._nextReferenceAttemptAt = undefined;
    this._updatedAt = at;
  }

  fail(code: FailureCode, at: Date): void {
    this.assertCanMoveTo(WagerTransactionStatus.Failed);

    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._nextReferenceAttemptAt = undefined;
    this._updatedAt = at;
  }

  isTerminal(): boolean {
    return ALLOWED_TRANSITIONS[this._status].length === 0;
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return WagerTransaction.kindRequiresReference(this.kind);
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  canBeRevertedBy(reversalKind: WagerTransactionKind): boolean {
    return REVERTIBLE_KINDS[reversalKind].includes(this.kind);
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Loss:
        throw new NoLedgerEffectError(this.kind);
      case WagerTransactionKind.Rollback: {
        if (reference === undefined) {
          throw new ReferenceRequiredError(this.kind);
        }
        if (!reference.canBeRevertedBy(this.kind)) {
          throw new InvalidTransactionError(`ROLLBACK cannot revert a ${reference.kind}`);
        }
        return reference.ledgerDirectionFor() === LedgerDirection.Debit
          ? LedgerDirection.Credit
          : LedgerDirection.Debit;
      }
    }
  }

  private assertCanMoveTo(target: WagerTransactionStatus): void {
    if (!ALLOWED_TRANSITIONS[this._status].includes(target)) {
      throw new InvalidTransactionStateError(this.id, this._status, target);
    }
  }

  private static kindRequiresReference(kind: WagerTransactionKind): boolean {
    return kind === WagerTransactionKind.Refund || kind === WagerTransactionKind.Rollback;
  }

  private static assertValidFields(props: CreateWagerTransactionProps): void {
    const required: ReadonlyArray<readonly [string, string]> = [
      ["id", props.id],
      ["providerId", props.providerId],
      ["externalTransactionId", props.externalTransactionId],
      ["idempotencyKey", props.idempotencyKey],
      ["walletId", props.walletId],
      ["playerId", props.playerId],
      ["roundId", props.roundId],
      ["gameId", props.gameId],
    ];

    for (const [name, value] of required) {
      if (value.trim().length === 0) {
        throw new InvalidTransactionError(`${name} must not be blank`);
      }
    }
    if (!PAYLOAD_HASH_PATTERN.test(props.payloadHash)) {
      throw new InvalidTransactionError("payloadHash must be a lowercase SHA-256 hex digest");
    }
  }

  private static assertValidMoney(kind: WagerTransactionKind, money: Money): void {
    if (money.isNegative()) {
      throw new InvalidTransactionError("amount cannot be negative");
    }
    if (kind !== WagerTransactionKind.Loss && !money.isPositive()) {
      throw new InvalidTransactionError(`${kind} amount must be greater than zero`);
    }
  }
}
