import type { Money } from "@/shared/domain/money/money";
import { CurrencyMismatchError } from "@/shared/domain/money/money.errors";
import { LedgerDirection } from "./ledger-direction.enum";
import {
  InsufficientFundsError,
  InvalidInitialBalanceError,
  InvalidWalletMovementError,
} from "./wallet.errors";
import { WalletLedgerEntry } from "./wallet-ledger-entry";

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
  openingTransactionId: string;
  openingEntryId: string;
  at: Date;
}

export interface WalletOpening {
  wallet: Wallet;
  openingEntry: WalletLedgerEntry | undefined;
}

export interface WalletMovement {
  entryId: string;
  transactionId: string;
  amount: Money;
  at: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: OpenWalletProps): WalletOpening {
    if (props.initialBalance.isNegative()) {
      throw new InvalidInitialBalanceError();
    }

    const wallet = new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      props.at,
      props.at,
    );

    const openingEntry = props.initialBalance.isPositive()
      ? WalletLedgerEntry.create({
          id: props.openingEntryId,
          walletId: props.id,
          transactionId: props.openingTransactionId,
          walletVersion: 1,
          direction: LedgerDirection.Credit,
          money: props.initialBalance,
          balanceBefore: props.initialBalance.subtract(props.initialBalance),
          balanceAfter: props.initialBalance,
          createdAt: props.at,
        })
      : undefined;

    return { wallet, openingEntry };
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  debit(movement: WalletMovement): WalletLedgerEntry {
    return this.apply(LedgerDirection.Debit, movement);
  }

  credit(movement: WalletMovement): WalletLedgerEntry {
    return this.apply(LedgerDirection.Credit, movement);
  }

  private apply(direction: LedgerDirection, movement: WalletMovement): WalletLedgerEntry {
    this.assertSameCurrency(movement.amount);
    if (!movement.amount.isPositive()) {
      throw new InvalidWalletMovementError("amount must be greater than zero");
    }

    const balanceAfter =
      direction === LedgerDirection.Credit
        ? this._balance.add(movement.amount)
        : this._balance.subtract(movement.amount);

    if (balanceAfter.isNegative()) {
      throw new InsufficientFundsError(this.id);
    }

    const entry = WalletLedgerEntry.create({
      id: movement.entryId,
      walletId: this.id,
      transactionId: movement.transactionId,
      walletVersion: this._version + 1,
      direction,
      money: movement.amount,
      balanceBefore: this._balance,
      balanceAfter,
      createdAt: movement.at,
    });

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = movement.at;

    return entry;
  }

  private assertSameCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }
}
