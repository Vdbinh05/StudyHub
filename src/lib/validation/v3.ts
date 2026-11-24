import { z } from "zod";
import { sanitizeRichTextDoc } from "@/lib/security/sanitize";
import type { RichTextDoc } from "@/types/v3";
import {
  answerMatchModeSchema,
  confidenceLevelSchema,
  globalSearchEntityTypeSchema,
  hotspotShapeSchema,
  mediaEntityTypeSchema,
  mediaKindSchema,
  mediaRoleSchema,
  nullableSafeUrlSchema,
  progressResetScopeSchema,
  questionReportCategorySchema,
  questionReportStatusSchema,
  safeUrlSchema,
  studyModeSchema,
  syncEventTypeSchema,
  uuidSchema,
} from "./common";

/**
 * Validates and deterministically sanitizes a canonical TipTap/ProseMirror `RichTextDoc` AST.
 */
export const richTextDocSchema = z
  .unknown()
  .transform((val, ctx): RichTextDoc => {
    const clean = sanitizeRichTextDoc(val);
    if (!clean) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid rich text document structure.",
      });
      return z.NEVER;
    }
    return clean;
  });

export const nullableRichTextDocSchema = z
  .union([z.null(), richTextDocSchema])
  .optional();

// ============================================================================
// Diagram Hotspot Geometry (Normalized [0, 1] Coordinates)
// ============================================================================

export const normalizedPointSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});

export const pointHotspotGeometrySchema = z.object({
  shape: z.literal("point"),
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  radius: z.number().finite().min(0.01).max(0.25).default(0.04),
});

export const rectHotspotGeometrySchema = z
  .object({
    shape: z.literal("rect"),
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().min(0.005).max(1),
    height: z.number().finite().min(0.005).max(1),
  })
  .refine((v) => v.x + v.width <= 1.0001 && v.y + v.height <= 1.0001, {
    message: "Rectangle geometry must remain within normalized [0, 1] bounds.",
  });

export const polygonHotspotGeometrySchema = z.object({
  shape: z.literal("polygon"),
  points: z.array(normalizedPointSchema).min(3).max(64),
});

export const hotspotGeometrySchema = z.discriminatedUnion("shape", [
  pointHotspotGeometrySchema,
  rectHotspotGeometrySchema,
  polygonHotspotGeometrySchema,
]);

// ============================================================================
// V3 Question Type Payloads (All 12 Exam Types)
// ============================================================================

export const fillInBlankSpecSchema = z.object({
  blank_id: z.string().trim().min(1).max(64),
  accepted_answers: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  match_mode: answerMatchModeSchema.optional(),
  case_sensitive: z.boolean().optional(),
  hint: z.string().trim().max(300).nullable().optional(),
});

export const fillInBlankPayloadSchema = z.object({
  type: z.literal("fill_in_blank"),
  template_text: z.string().max(10_000).optional(),
  blanks: z.array(fillInBlankSpecSchema).min(1).max(30),
  require_all_blanks: z.boolean().default(true),
});

export const numericalPayloadSchema = z.object({
  type: z.literal("numerical"),
  correct_value: z.number().finite(),
  abs_tolerance: z.number().finite().min(0).max(1e9).nullable().optional(),
  rel_tolerance: z.number().finite().min(0).max(10).nullable().optional(),
  unit: z.string().trim().max(40).nullable().optional(),
  accepted_units: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  unit_required: z.boolean().default(false),
  significant_figures: z.number().int().min(1).max(15).nullable().optional(),
});

export const imageChoicePayloadSchema = z.object({
  type: z.literal("image_choice"),
  selection_mode: z.enum(["single", "multiple"]).default("single"),
});

export const orderingItemSchema = z.object({
  id: z.string().trim().min(1).max(80),
  text: z.string().trim().max(2000).default(""),
  rich_text: nullableRichTextDocSchema,
  image_url: nullableSafeUrlSchema,
  media_id: uuidSchema.nullable().optional(),
  correct_position: z.number().int().min(0).max(50),
});

export const orderingPayloadSchema = z.object({
  type: z.literal("ordering"),
  items: z.array(orderingItemSchema).min(2).max(20),
  allow_partial_credit: z.boolean().default(false),
});

export const matchingPairSchema = z.object({
  id: z.string().trim().min(1).max(80),
  left_text: z.string().trim().max(2000).default(""),
  left_rich_text: nullableRichTextDocSchema,
  left_image_url: nullableSafeUrlSchema,
  right_id: z.string().trim().min(1).max(80),
  right_text: z.string().trim().max(2000).default(""),
  right_rich_text: nullableRichTextDocSchema,
  right_image_url: nullableSafeUrlSchema,
});

export const matchingDistractorSchema = z.object({
  right_id: z.string().trim().min(1).max(80),
  right_text: z.string().trim().min(1).max(2000),
  right_image_url: nullableSafeUrlSchema,
});

export const matchingPayloadSchema = z.object({
  type: z.literal("matching"),
  pairs: z.array(matchingPairSchema).min(2).max(20),
  distractors: z.array(matchingDistractorSchema).max(10).optional(),
});

export const imageHotspotTargetSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(200),
  shape: hotspotShapeSchema,
  geometry: hotspotGeometrySchema,
});

export const imageHotspotPayloadSchema = z.object({
  type: z.literal("image_hotspot"),
  diagram_id: uuidSchema.nullable().optional(),
  image_url: safeUrlSchema,
  image_media_id: uuidSchema.nullable().optional(),
  target_hotspots: z.array(imageHotspotTargetSchema).min(1).max(30),
  require_all_targets: z.boolean().default(false),
});

export const readingPassagePayloadSchema = z.object({
  type: z.literal("reading_passage"),
  passage_id: uuidSchema.nullable().optional(),
  passage_title: z.string().trim().max(240).nullable().optional(),
  passage_text: z.string().max(40_000).nullable().optional(),
  passage_rich: nullableRichTextDocSchema,
  sub_answer_kind: z
    .enum(["single_choice", "multiple_choice", "true_false", "short_answer"])
    .default("single_choice"),
});

export const listeningPayloadSchema = z.object({
  type: z.literal("listening"),
  audio_media_id: uuidSchema.nullable().optional(),
  audio_url: nullableSafeUrlSchema,
  transcript: z.string().max(20_000).nullable().optional(),
  show_transcript_after_submit: z.boolean().default(true),
  max_replays: z.number().int().min(1).max(20).nullable().optional(),
  language: z.string().trim().max(20).nullable().optional(),
  sub_answer_kind: z
    .enum(["single_choice", "multiple_choice", "short_answer", "fill_in_blank"])
    .default("single_choice"),
});

export const coreQuestionPayloadSchema = z
  .object({
    type: z.enum([
      "single_choice",
      "multiple_choice",
      "true_false",
      "short_answer",
      "flashcard",
    ]),
  })
  .passthrough();

export const questionTypePayloadSchema = z.discriminatedUnion("type", [
  fillInBlankPayloadSchema,
  numericalPayloadSchema,
  imageChoicePayloadSchema,
  orderingPayloadSchema,
  matchingPayloadSchema,
  imageHotspotPayloadSchema,
  readingPassagePayloadSchema,
  listeningPayloadSchema,
  coreQuestionPayloadSchema,
]);

// ============================================================================
// Structured Answer Responses (All 12 Types)
// ============================================================================

export const structuredAnswerResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("options"),
    selected_option_ids: z.array(uuidSchema).max(20),
  }),
  z.object({
    kind: z.literal("text"),
    value: z.string().max(5000),
  }),
  z.object({
    kind: z.literal("blanks"),
    answers: z.record(z.string().max(64), z.string().max(1000)),
  }),
  z.object({
    kind: z.literal("numerical"),
    value: z.string().max(100),
    numeric_value: z.number().finite().nullable().optional(),
    unit: z.string().trim().max(40).nullable().optional(),
  }),
  z.object({
    kind: z.literal("ordering"),
    ordered_item_ids: z.array(z.string().trim().min(1).max(80)).max(30),
  }),
  z.object({
    kind: z.literal("matching"),
    pairs: z.record(z.string().max(80), z.string().max(80)),
  }),
  z.object({
    kind: z.literal("hotspot"),
    clicks: z.array(normalizedPointSchema).max(30),
    selected_hotspot_ids: z.array(z.string().max(80)).max(30).optional(),
  }),
]);

// ============================================================================
// Media, Passages & Diagrams Schemas
// ============================================================================

export const listMediaQuerySchema = z.object({
  studySetId: uuidSchema.optional(),
  kind: mediaKindSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const attachMediaRelationSchema = z.object({
  media_id: uuidSchema,
  entity_type: mediaEntityTypeSchema,
  entity_id: uuidSchema,
  role: mediaRoleSchema,
  sort_order: z.number().int().min(0).max(1000).default(0),
  alt_text: z.string().trim().max(500).nullable().optional(),
  caption: z.string().trim().max(1000).nullable().optional(),
});

export const updateMediaAssetSchema = z.object({
  alt_text: z.string().trim().max(500).nullable().optional(),
  caption: z.string().trim().max(1000).nullable().optional(),
  width: z.number().int().min(1).max(20_000).nullable().optional(),
  height: z.number().int().min(1).max(20_000).nullable().optional(),
  duration_ms: z.number().int().min(0).max(3_600_000).nullable().optional(),
});

export const createPassageSchema = z.object({
  study_set_id: uuidSchema,
  title: z.string().trim().min(1, "Passage title is required.").max(240),
  content_text: z.string().trim().min(1, "Passage content is required.").max(40_000),
  content_rich: nullableRichTextDocSchema,
  audio_media_id: uuidSchema.nullable().optional(),
  transcript: z.string().trim().max(20_000).nullable().optional(),
  source_reference: z.string().trim().max(300).nullable().optional(),
  sort_order: z.number().int().min(0).max(10_000).default(0),
});

export const updatePassageSchema = createPassageSchema
  .omit({ study_set_id: true })
  .partial();

export const diagramHotspotInputSchema = z
  .object({
    id: uuidSchema.optional(),
    label: z.string().trim().min(1, "Hotspot label is required.").max(200),
    accepted_alternatives: z
      .array(z.string().trim().min(1).max(200))
      .max(20)
      .default([]),
    description: z.string().trim().max(2000).nullable().optional(),
    hint: z.string().trim().max(500).nullable().optional(),
    shape: hotspotShapeSchema,
    geometry: hotspotGeometrySchema,
    sort_order: z.number().int().min(0).max(500).optional(),
  })
  .refine((v) => v.shape === v.geometry.shape, {
    message: "Hotspot shape must match geometry.shape.",
    path: ["geometry"],
  });

export const createDiagramSchema = z.object({
  study_set_id: uuidSchema,
  title: z.string().trim().min(1, "Diagram title is required.").max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  base_media_id: uuidSchema.nullable().optional(),
  base_image_url: safeUrlSchema,
  image_width: z.number().int().min(1).max(20_000).nullable().optional(),
  image_height: z.number().int().min(1).max(20_000).nullable().optional(),
  hotspots: z.array(diagramHotspotInputSchema).max(200).default([]),
});

export const updateDiagramSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  base_media_id: uuidSchema.nullable().optional(),
  base_image_url: safeUrlSchema.optional(),
  image_width: z.number().int().min(1).max(20_000).nullable().optional(),
  image_height: z.number().int().min(1).max(20_000).nullable().optional(),
  hotspots: z.array(diagramHotspotInputSchema).max(200).optional(),
});

// ============================================================================
// Personal Notes, Question Reports, Checkpoints, Mode Preferences, Reset, Sync, Search
// ============================================================================

export const listNotesQuerySchema = z.object({
  studySetId: uuidSchema.optional(),
  questionId: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

export const upsertNoteSchema = z.object({
  study_set_id: uuidSchema.optional(),
  question_id: uuidSchema,
  content_text: z.string().trim().max(10_000),
  content_rich: nullableRichTextDocSchema,
  base_version: z.number().int().min(1).nullable().optional(),
});

export const listReportsQuerySchema = z.object({
  studySetId: uuidSchema.optional(),
  questionId: uuidSchema.optional(),
  status: questionReportStatusSchema.optional(),
  mineOnly: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const createReportSchema = z.object({
  study_set_id: uuidSchema.optional(),
  question_id: uuidSchema,
  category: questionReportCategorySchema,
  description: z.string().trim().max(2000).default(""),
});

export const updateReportSchema = z.object({
  status: questionReportStatusSchema.optional(),
  resolution_note: z.string().trim().max(2000).nullable().optional(),
});

export const listCheckpointsQuerySchema = z.object({
  studySetId: uuidSchema.optional(),
  mode: studyModeSchema.optional(),
  sessionKey: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const upsertCheckpointSchema = z.object({
  study_set_id: uuidSchema.nullable().optional(),
  mode: studyModeSchema,
  session_key: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-zA-Z0-9:_-]+$/, "Invalid session_key format."),
  state_json: z.record(z.string(), z.unknown()).default({}),
  progress_percent: z.number().min(0).max(100).default(0),
  current_index: z.number().int().min(0).max(50_000).default(0),
  total_items: z.number().int().min(0).max(50_000).default(0),
  device_id: z.string().trim().max(120).nullable().optional(),
});

export const modePreferencesSchema = z
  .object({
    flashcards: z
      .object({
        start_side: z.enum(["front", "back"]).optional(),
        auto_play_audio: z.boolean().optional(),
        show_hints: z.boolean().optional(),
        show_keyboard_hints: z.boolean().optional(),
      })
      .strict()
      .optional(),
    mc: z
      .object({
        instant_feedback: z.boolean().optional(),
        auto_advance_ms: z.number().int().min(0).max(10_000).nullable().optional(),
        shuffle_options: z.boolean().optional(),
        show_explanation_on_correct: z.boolean().optional(),
      })
      .strict()
      .optional(),
    learn: z
      .object({
        objective: z
          .enum(["quick_familiarity", "exam_prep", "long_term_retention"])
          .optional(),
        batch_size: z.number().int().min(3).max(50).optional(),
        enable_written_recall: z.boolean().optional(),
        require_independent_recall: z.boolean().optional(),
        ask_confidence: z.boolean().optional(),
      })
      .strict()
      .optional(),
    write: z
      .object({
        ignore_diacritics: z.boolean().optional(),
        ignore_case: z.boolean().optional(),
        allow_override: z.boolean().optional(),
      })
      .strict()
      .optional(),
    spell: z
      .object({
        speech_rate: z.number().min(0.5).max(2.0).optional(),
        preferred_voice: z.string().trim().max(120).nullable().optional(),
        preferred_lang: z.string().trim().max(20).optional(),
        auto_play_prompt: z.boolean().optional(),
        show_hint_letters: z.boolean().optional(),
        strict_diacritics: z.boolean().optional(),
      })
      .strict()
      .optional(),
    diagram: z
      .object({
        default_mode: z
          .enum([
            "explore",
            "identify_location",
            "name_location",
            "multiple_choice",
            "hidden_labels",
            "review_incorrect",
          ])
          .optional(),
        show_hotspot_hints: z.boolean().optional(),
        point_tolerance_scale: z.number().min(0.5).max(2.0).optional(),
      })
      .strict()
      .optional(),
    shortcuts: z
      .object({
        enabled: z.boolean().optional(),
        show_hints: z.boolean().optional(),
      })
      .strict()
      .optional(),
    accessibility: z
      .object({
        high_contrast_focus: z.boolean().optional(),
        large_reading_text: z.boolean().optional(),
        reduce_motion_override: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const progressResetSchema = z
  .object({
    scope: progressResetScopeSchema,
    study_set_id: uuidSchema.optional(),
    subject: z.string().trim().min(1).max(120).optional(),
    chapter: z.string().trim().min(1).max(200).optional(),
    question_ids: z.array(uuidSchema).min(1).max(1000).optional(),
    mode: studyModeSchema.optional(),
    clear_mistakes: z.boolean().default(true),
    clear_starred: z.boolean().default(false),
    clear_checkpoints: z.boolean().default(true),
    confirm: z.literal("RESET_PROGRESS"),
  })
  .superRefine((data, ctx) => {
    if (data.scope === "study_set" && !data.study_set_id) {
      ctx.addIssue({
        code: "custom",
        path: ["study_set_id"],
        message: "study_set_id is required when scope is 'study_set'.",
      });
    }
    if (data.scope === "subject" && !data.subject) {
      ctx.addIssue({
        code: "custom",
        path: ["subject"],
        message: "subject is required when scope is 'subject'.",
      });
    }
    if (data.scope === "chapter" && (!data.study_set_id || !data.chapter)) {
      ctx.addIssue({
        code: "custom",
        path: ["chapter"],
        message: "study_set_id and chapter are required when scope is 'chapter'.",
      });
    }
    if (
      data.scope === "question" &&
      (!data.question_ids || data.question_ids.length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["question_ids"],
        message: "question_ids are required when scope is 'question'.",
      });
    }
    if (data.scope === "mode" && !data.mode) {
      ctx.addIssue({
        code: "custom",
        path: ["mode"],
        message: "mode is required when scope is 'mode'.",
      });
    }
  });

export const syncEventInputSchema = z.object({
  event_id: uuidSchema,
  event_type: syncEventTypeSchema,
  study_set_id: uuidSchema.nullable().optional(),
  question_id: uuidSchema.nullable().optional(),
  client_timestamp: z.string().datetime(),
  progress_generation: z.number().int().min(1).optional(),
  base_version: z.number().int().min(1).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const syncEventsBatchSchema = z.object({
  events: z.array(syncEventInputSchema).min(1).max(200),
});

export const globalSearchQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
  type: z
    .string()
    .trim()
    .optional()
    .transform((val) => {
      if (!val || val === "all") return undefined;
      return val
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    })
    .pipe(z.array(globalSearchEntityTypeSchema).max(8).optional()),
  limit: z.coerce.number().int().min(1).max(50).default(30),
  offset: z.coerce.number().int().min(0).max(500).default(0),
});

export const confidenceMetaSchema = z.object({
  confidence: confidenceLevelSchema.nullable().optional(),
  hint_used: z.boolean().optional(),
});
