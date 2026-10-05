import { describe, expect, test } from "bun:test";
import { Money } from "@/shared/domain/money/money";
import {
  canonicalJson,
  computePayloadHash,
  type PayloadHashInput,
} from "@/wagering/domain/payload-hash";
import { WagerTransactionKind } from "@/wagering/domain/wager-transaction-kind.enum";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });

const baseInput = (overrides: Partial<PayloadHashInput> = {}): PayloadHashInput => ({
  providerId: "provider-a",
  externalTransactionId: "transaction-123",
  playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  walletId: "0192f291-27dd-7d3f-8071-5f8685deef37",
  roundId: "round-987",
  gameId: "fortune-chimp",
  kind: WagerTransactionKind.Bet,
  money: brl("25.00"),
  ...overrides,
});

describe("canonicalJson", () => {
  test("sorts object keys at every depth and removes whitespace", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
  });

  test("is independent of key insertion order", () => {
    expect(canonicalJson({ a: 1, b: 2, c: 3 })).toBe(canonicalJson({ c: 3, a: 1, b: 2 }));
  });

  test("keeps array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  test("omits undefined members but keeps null", () => {
    expect(canonicalJson({ a: undefined, b: null, c: 1 })).toBe('{"b":null,"c":1}');
  });

  test("escapes strings like JSON.stringify and keeps unicode intact", () => {
    expect(canonicalJson({ text: 'a"b\\c\né' })).toBe('{"text":"a\\"b\\\\c\\né"}');
  });

  test("sorts keys by code point, not by locale", () => {
    const mixedCase = Object.fromEntries([
      ["b", 1],
      ["B", 2],
      ["a", 3],
    ]);

    expect(canonicalJson(mixedCase)).toBe('{"B":2,"a":3,"b":1}');
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY])("rejects the non-finite number %p", (value) => {
    expect(() => canonicalJson({ value })).toThrow(TypeError);
  });

  test("rejects values that JSON cannot represent", () => {
    expect(() => canonicalJson({ value: () => 1 })).toThrow(TypeError);
  });
});

describe("computePayloadHash", () => {
  test("returns a lowercase SHA-256 hex digest", () => {
    expect(computePayloadHash(baseInput())).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is deterministic", () => {
    expect(computePayloadHash(baseInput())).toBe(computePayloadHash(baseInput()));
  });

  describe("pinned vectors (algorithm v1, verified with an independent SHA-256)", () => {
    test("BET without reference", () => {
      expect(computePayloadHash(baseInput())).toBe(
        "629836932b79106b99523d06a1e7fa80689b0ea1e1c47aa3f0a5a2c87d0c4344",
      );
    });

    test("REFUND with reference", () => {
      expect(
        computePayloadHash(
          baseInput({
            kind: WagerTransactionKind.Refund,
            referenceExternalTransactionId: "transaction-100",
          }),
        ),
      ).toBe("8c475246da0670adc81177e3f871be74814e2b9c78fe09c8fcb26c6811df2d08");
    });
  });

  test('is insensitive to how the amount was written ("25" equals "25.00")', () => {
    expect(computePayloadHash(baseInput({ money: brl("25") }))).toBe(
      computePayloadHash(baseInput({ money: brl("25.00") })),
    );
  });

  test("an absent reference and an undefined reference hash the same", () => {
    const withoutKey = baseInput();
    const withUndefined = baseInput({ referenceExternalTransactionId: undefined });

    expect(computePayloadHash(withUndefined)).toBe(computePayloadHash(withoutKey));
  });

  test("ignores fields outside the business subset (transport metadata)", () => {
    const polluted = {
      ...baseInput(),
      idempotencyKey: "provider-a:transaction-123",
      messageId: "msg-1",
      occurredAt: "2026-10-03T12:00:00.000Z",
    } as PayloadHashInput;

    expect(computePayloadHash(polluted)).toBe(computePayloadHash(baseInput()));
  });

  test.each<[string, Partial<PayloadHashInput>]>([
    ["providerId", { providerId: "provider-b" }],
    ["externalTransactionId", { externalTransactionId: "transaction-124" }],
    ["playerId", { playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a2" }],
    ["walletId", { walletId: "0192f291-27dd-7d3f-8071-5f8685deef38" }],
    ["roundId", { roundId: "round-988" }],
    ["gameId", { gameId: "other-game" }],
    ["kind", { kind: WagerTransactionKind.Win }],
    ["amount", { money: brl("25.01") }],
    ["currency", { money: Money.from({ amount: "25.00", currency: "USD" }) }],
    ["reference", { referenceExternalTransactionId: "transaction-100" }],
  ])("changes when %s changes", (_field, overrides) => {
    expect(computePayloadHash(baseInput(overrides))).not.toBe(computePayloadHash(baseInput()));
  });

  test("different references produce different hashes", () => {
    const first = baseInput({ referenceExternalTransactionId: "transaction-100" });
    const second = baseInput({ referenceExternalTransactionId: "transaction-101" });

    expect(computePayloadHash(first)).not.toBe(computePayloadHash(second));
  });
});
