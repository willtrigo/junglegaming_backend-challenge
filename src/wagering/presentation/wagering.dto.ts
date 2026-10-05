import { z } from "zod";

import { WagerTransactionKind } from "@/wagering/domain/wager-transaction-kind.enum";

const moneySchema = z.object({
  amount: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const submitWagerBodySchema = z.object({
  providerId: z.string().min(1),
  externalTransactionId: z.string().min(1),
  playerId: z.string().uuid(),
  walletId: z.string().uuid(),
  roundId: z.string().min(1),
  gameId: z.string().min(1),
  kind: z.nativeEnum(WagerTransactionKind),
  money: moneySchema,
  referenceExternalTransactionId: z.string().min(1).optional(),
});

export type SubmitWagerBody = z.infer<typeof submitWagerBodySchema>;
