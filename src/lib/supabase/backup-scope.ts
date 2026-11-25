/**
 * Honest StudyHub V3 backup manifest describing which entities are restored
 * by `POST /api/account/restore` versus exported as archival metadata by `GET /api/account/data`.
 */
export const V3_BACKUP_SCOPE = {
  restored_entities: [
    "preferences",
    "folders",
    "tags",
    "study_sets",
    "shared_passages",
    "diagram_sets",
    "diagram_hotspots",
    "questions",
    "question_options",
    "question_accepted_answers",
    "question_tags",
    "content_media_relations",
    "user_question_notes",
  ],
  export_only_entities: [
    "profile",
    "progress",
    "starred_questions",
    "study_sessions",
    "study_session_answers",
    "exam_attempts",
    "exam_attempt_answers",
    "exam_presets",
    "exam_preset_sources",
    "coverage_cycles",
    "media_assets",
    "learning_session_checkpoints",
    "learning_confidence_events",
    "question_reports",
  ],
  excluded_note:
    "Binary Storage files (images/audio) are exported as metadata and URL references only (not embedded binary blobs). Progress, sessions, exam history, presets, checkpoints, confidence events, media metadata, and question reports are exported as archival backup metadata and are not overwritten during restore.",
} as const;
