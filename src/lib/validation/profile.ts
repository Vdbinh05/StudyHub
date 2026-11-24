import { z } from "zod";
import {
  answerMatchModeSchema,
  difficultySchema,
  localeSchema,
  nullableSafeUrlSchema,
  questionTypeSchema,
  studySetTypeSchema,
  themeSchema,
  visibilitySchema,
} from "./common";

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

// SH-033: Full StudyHub JSON Account Backup Restore validation
export const restoreAccountBackupSchema = z.object({
  version: z.string().min(1).max(20).optional(),
  exported_at: z.string().optional(),
  mode: z.enum(["merge", "append"]).default("merge"),
  preferences: updatePreferencesSchema.nullable().optional(),
  folders: z
    .array(
      z.object({
        id: z.string().optional(),
        parent_id: z.string().nullable().optional(),
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500).nullable().optional(),
        color: z.string().trim().max(30).optional(),
        icon: z.string().trim().max(40).optional(),
        sort_order: z.number().int().min(0).optional(),
      }),
    )
    .max(500)
    .optional(),
  study_sets: z
    .array(
      z.object({
        id: z.string().optional(),
        folder_id: z.string().nullable().optional(),
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2000).nullable().optional(),
        subject: z.string().trim().max(100).nullable().optional(),
        set_type: studySetTypeSchema.optional(),
        visibility: visibilitySchema.optional(),
        source_language: z.string().trim().min(2).max(20).optional(),
        default_exam_duration_minutes: z.number().int().min(1).max(300).optional(),
        default_pass_threshold: z.number().int().min(1).max(100).optional(),
        is_archived: z.boolean().optional(),
        is_favorite: z.boolean().optional(),
      }),
    )
    .max(500)
    .optional(),
  questions: z
    .array(
      z.object({
        id: z.string().optional(),
        study_set_id: z.string(),
        question_type: questionTypeSchema.optional(),
        position: z.number().int().min(0).optional(),
        chapter: z.string().trim().max(200).nullable().optional(),
        prompt: z.string().trim().min(1).max(10000),
        prompt_image_url: nullableSafeUrlSchema,
        back_text: z.string().trim().max(10000).nullable().optional(),
        back_image_url: nullableSafeUrlSchema,
        explanation: z.string().trim().max(10000).nullable().optional(),
        hint: z.string().trim().max(2000).nullable().optional(),
        difficulty: difficultySchema.optional(),
        source_metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(25_000)
    .optional(),
  question_options: z
    .array(
      z.object({
        question_id: z.string(),
        position: z.number().int().min(0).optional(),
        label: z.string().trim().min(1).max(10),
        content: z.string().trim().min(1).max(4000),
        image_url: nullableSafeUrlSchema,
        is_correct: z.boolean().default(false),
      }),
    )
    .max(100_000)
    .optional(),
  question_accepted_answers: z
    .array(
      z.object({
        question_id: z.string(),
        answer_text: z.string().trim().min(1).max(1000),
        match_mode: answerMatchModeSchema.optional(),
      }),
    )
    .max(50_000)
    .optional(),
  tags: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().trim().min(1).max(50),
        color: z.string().trim().max(30).optional(),
      }),
    )
    .max(1000)
    .optional(),
  question_tags: z
    .array(
      z.object({
        question_id: z.string(),
        tag_id: z.string(),
      }),
    )
    .max(100_000)
    .optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
export type RestoreAccountBackupInput = z.infer<typeof restoreAccountBackupSchema>;
