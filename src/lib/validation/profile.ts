import { z } from "zod";
import { localeSchema, nullableSafeUrlSchema, themeSchema } from "./common";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9_]{3,30}$/,
    "Username must be 3-30 lowercase letters, numbers, or underscores.",
  );

export const updateProfileSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "Display name is required.")
    .max(100, "Display name must be 100 characters or fewer.")
    .optional(),
  username: z.union([usernameSchema, z.null()]).optional(),
  avatar_url: nullableSafeUrlSchema,
  bio: z
    .string()
    .trim()
    .max(300, "Bio must be 300 characters or fewer.")
    .nullable()
    .optional(),
});

export const updatePreferencesSchema = z.object({
  language: localeSchema.optional(),
  theme: themeSchema.optional(),
  daily_goal: z.number().int().min(1).max(500).optional(),
  default_shuffle_questions: z.boolean().optional(),
  default_shuffle_options: z.boolean().optional(),
  show_instant_feedback: z.boolean().optional(),
  sound_effects: z.boolean().optional(),
  reduced_motion: z.boolean().optional(),
});

export const deleteAccountDataSchema = z.object({
  confirm: z.literal("DELETE_MY_DATA"),
  scope: z.enum(["study_data", "account"]).default("study_data"),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
