import type { Money } from "@/shared/domain/money/money";
import { CurrencyMismatchError } from "@/shared/domain/money/money.errors";
import { LedgerDirection } from "./ledger-direction.enum";
import { InvalidLedgerEntryError } from "./wallet.errors";

export interface LedgerEntryState {
  id: string;
  walletId: string;
  transactionId: string;
  walletVersion: number;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

export type CreateLedgerEntryProps = LedgerEntryState;

export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly walletVersion: number,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {
    Object.freeze(this);
  }

  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    WalletLedgerEntry.assertValid(props);
    return WalletLedgerEntry.build(props);
  }

  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return WalletLedgerEntry.build(state);
  }

  isBalanced(): boolean {
    const expected =
      this.direction === LedgerDirection.Credit
        ? this.balanceBefore.add(this.money)
        : this.balanceBefore.subtract(this.money);

    return expected.equals(this.balanceAfter);
  }

  private static build(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.walletVersion,
      state.direction,
      state.money,
      state.balanceBefore,
      state.balanceAfter,
      state.createdAt,
    );
  }

  private static assertValid(props: CreateLedgerEntryProps): void {
    const { money, balanceBefore, balanceAfter } = props;

    for (const balance of [balanceBefore, balanceAfter]) {
      if (balance.currency !== money.currency) {
        throw new CurrencyMismatchError(money.currency, balance.currency);
      }
    }
    if (!money.isPositive()) {
      throw new InvalidLedgerEntryError("amount must be positive");
    }
    if (balanceBefore.isNegative() || balanceAfter.isNegative()) {
      throw new InvalidLedgerEntryError("balances cannot be negative");
    }
    if (!Number.isInteger(props.walletVersion) || props.walletVersion < 1) {
      throw new InvalidLedgerEntryError("wallet version must be a positive integer");
    }

    const entry = WalletLedgerEntry.build(props);
    if (!entry.isBalanced()) {
      throw new InvalidLedgerEntryError("balanceBefore and balanceAfter do not match the amount");
    }
  }
}
