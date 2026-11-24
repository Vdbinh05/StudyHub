import { z } from "zod";
import { uuidSchema } from "./common";

const ALLOWED_FOLDER_COLORS = [
  "indigo",
  "blue",
  "green",
  "amber",
  "red",
  "slate",
  "purple",
  "teal",
] as const;

export const createFolderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Folder name is required.")
    .max(120, "Folder name must be 120 characters or fewer."),
  description: z
    .string()
    .trim()
    .max(500, "Description must be 500 characters or fewer.")
    .nullable()
    .optional(),
  parent_id: uuidSchema.nullable().optional(),
  color: z.enum(ALLOWED_FOLDER_COLORS).default("indigo"),
  icon: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "Invalid icon identifier.")
    .default("folder"),
  sort_order: z.number().int().min(0).max(100_000).default(0),
});

export const updateFolderSchema = createFolderSchema.partial();

export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;
