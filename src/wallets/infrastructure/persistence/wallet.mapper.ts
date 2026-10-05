import { Money } from "@/shared/domain/money/money";
import type { LedgerDirection } from "@/wallets/domain/ledger-direction.enum";
import { Wallet } from "@/wallets/domain/wallet";
import { WalletLedgerEntry } from "@/wallets/domain/wallet-ledger-entry";
import { WalletOrmEntity } from "./wallet.orm-entity";
import { WalletLedgerEntryOrmEntity } from "./wallet-ledger-entry.orm-entity";

export function walletToOrm(wallet: Wallet): WalletOrmEntity {
  const row = new WalletOrmEntity();
  row.id = wallet.id;
  row.playerId = wallet.playerId;
  row.currency = wallet.currency;
  row.balance = wallet.balance.amount;
  row.version = String(wallet.version);
  row.createdAt = wallet.createdAt;
  row.updatedAt = wallet.updatedAt;
  return row;
}

export function applyWalletToOrm(wallet: Wallet, row: WalletOrmEntity): void {
  row.balance = wallet.balance.amount;
  row.version = String(wallet.version);
  row.updatedAt = wallet.updatedAt;
}

export function walletFromOrm(row: WalletOrmEntity): Wallet {
  return Wallet.rehydrate({
    id: row.id,
    playerId: row.playerId,
    currency: row.currency,
    balance: Money.from({ amount: row.balance, currency: row.currency }),
    version: Number(row.version),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function ledgerEntryToOrm(entry: WalletLedgerEntry): WalletLedgerEntryOrmEntity {
  const row = new WalletLedgerEntryOrmEntity();
  row.id = entry.id;
  row.walletId = entry.walletId;
  row.transactionId = entry.transactionId;
  row.walletVersion = String(entry.walletVersion);
  row.currency = entry.money.currency;
  row.direction = entry.direction;
  row.amount = entry.money.amount;
  row.balanceBefore = entry.balanceBefore.amount;
  row.balanceAfter = entry.balanceAfter.amount;
  row.createdAt = entry.createdAt;
  return row;
}

export function ledgerEntryFromOrm(row: WalletLedgerEntryOrmEntity): WalletLedgerEntry {
  const currency = row.currency;
  return WalletLedgerEntry.rehydrate({
    id: row.id,
    walletId: row.walletId,
    transactionId: row.transactionId,
    walletVersion: Number(row.walletVersion),
    direction: row.direction as LedgerDirection,
    money: Money.from({ amount: row.amount, currency }),
    balanceBefore: Money.from({ amount: row.balanceBefore, currency }),
    balanceAfter: Money.from({ amount: row.balanceAfter, currency }),
    createdAt: row.createdAt,
  });
}
