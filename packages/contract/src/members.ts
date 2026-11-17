import { z } from "zod";
import { budgetIdParams, roleSchema, uuidSchema } from "./common";

export const memberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  /** Only owners see other members' addresses; everyone sees their own. */
  email: z.string().optional(),
  role: roleSchema,
  joinedAt: z.string(),
});
export type Member = z.infer<typeof memberSchema>;
export const memberListSchema = z.object({ items: z.array(memberSchema) });

export const memberParams = budgetIdParams.extend({
  userId: z.string().min(1).max(128),
});

export const updateMemberBody = z.object({ role: roleSchema });
export type UpdateMemberBody = z.infer<typeof updateMemberBody>;

export const transferOwnershipBody = z.object({ demoteSelf: z.boolean() });
export type TransferOwnershipBody = z.infer<typeof transferOwnershipBody>;

export { uuidSchema };
