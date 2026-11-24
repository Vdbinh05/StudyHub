import { z } from "zod";
import { uuidSchema } from "./common";

export const createFriendRequestSchema = z
  .object({
    addressee_id: uuidSchema.optional(),
    identifier: z.string().trim().min(3).max(255).optional(),
  })
  .refine((val) => Boolean(val.addressee_id || val.identifier), {
    message: "Provide addressee_id or identifier (username or email).",
  });

export const updateFriendshipSchema = z.object({
  action: z.enum(["accept", "decline", "block"]),
});

export const userSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(3, "Search query must be at least 3 characters.")
    .max(255),
});

export type CreateFriendRequestInput = z.infer<typeof createFriendRequestSchema>;
export type UpdateFriendshipInput = z.infer<typeof updateFriendshipSchema>;
