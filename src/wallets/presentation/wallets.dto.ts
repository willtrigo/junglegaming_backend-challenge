import { z } from "zod";

const moneySchema = z.object({
  amount: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const createWalletBodySchema = z.object({
  playerId: z.string().uuid(),
  initialBalance: moneySchema,
});

export type CreateWalletBody = z.infer<typeof createWalletBodySchema>;
