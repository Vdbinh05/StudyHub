import { z } from "zod";
import {
  sharePermissionSchema,
  studySetTypeSchema,
  uuidSchema,
  visibilitySchema,
} from "./common";

export const listSetsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  folderId: z.union([uuidSchema, z.literal("unfiled")]).optional(),
  type: studySetTypeSchema.optional(),
  visibility: visibilitySchema.optional(),
  scope: z.enum(["owned", "shared", "all"]).default("owned"),
  includeArchived: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
  favoritesOnly: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
  sort: z
    .enum([
      "updated_desc",
      "created_desc",
      "title_asc",
      "last_studied_desc",
      "question_count_desc",
    ])
    .default("updated_desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export const createStudySetSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Study set title is required.")
    .max(200, "Title must be 200 characters or fewer."),
  description: z
    .string()
    .trim()
    .max(2000, "Description must be 2000 characters or fewer.")
    .nullable()
    .optional(),
  subject: z
    .string()
    .trim()
    .max(100, "Subject must be 100 characters or fewer.")
    .nullable()
    .optional(),
  folder_id: uuidSchema.nullable().optional(),
  set_type: studySetTypeSchema.default("multiple_choice"),
  visibility: visibilitySchema.default("private"),
  source_language: z.string().trim().min(2).max(20).default("vi"),
  default_exam_duration_minutes: z.number().int().min(1).max(300).default(45),
  default_pass_threshold: z.number().int().min(1).max(100).default(70),
});

export const updateStudySetSchema = createStudySetSchema
  .extend({
    is_archived: z.boolean().optional(),
    is_favorite: z.boolean().optional(),
  })
  .partial();

export const duplicateStudySetSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    folder_id: uuidSchema.nullable().optional(),
  })
  .optional();

export const addStudySetMemberSchema = z
  .object({
    user_id: uuidSchema.optional(),
    identifier: z.string().trim().min(2).max(255).optional(),
    role: sharePermissionSchema.default("viewer"),
  })
  .refine((val) => Boolean(val.user_id || val.identifier), {
    message: "Either user_id or identifier (username/email) is required.",
  });

export const updateStudySetMemberSchema = z.object({
  role: sharePermissionSchema,
});

export const createShareLinkSchema = z.object({
  permission: sharePermissionSchema.default("viewer"),
  allow_clone: z.boolean().default(true),
  expires_at: z.string().datetime().nullable().optional(),
  expires_in_hours: z.number().int().min(1).max(24 * 365).nullable().optional(),
});

export type ListSetsQuery = z.infer<typeof listSetsQuerySchema>;
export type CreateStudySetInput = z.infer<typeof createStudySetSchema>;
export type UpdateStudySetInput = z.infer<typeof updateStudySetSchema>;
export type AddStudySetMemberInput = z.infer<typeof addStudySetMemberSchema>;
export type UpdateStudySetMemberInput = z.infer<typeof updateStudySetMemberSchema>;
export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>;
