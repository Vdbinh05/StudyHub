import type { ParsedQuestion } from "@/types/import";

/** Safe JSON body cap per `/api/import/commit` chunk on Vercel Hobby (hard platform cap: 4.5 MB). */
export const VERCEL_SAFE_COMMIT_CHUNK_BYTES = 2_500_000;

/** Maximum questions per `/api/import/commit` chunk for fast Postgres batch inserts. */
export const MAX_COMMIT_QUESTIONS_PER_CHUNK = 500;

const utf8ByteLength = (str: string | null | undefined): number => {
  if (!str) return 0;
  // Fast UTF-8 byte estimate (1 byte ASCII, up to 3 bytes Vietnamese BMP, 4 bytes astral)
  let bytes = 0;
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
};

/**
 * Estimates serialized JSON byte size for a single `ParsedQuestion` including
 * Vietnamese UTF-8 text, options, accepted answers, tags, and embedded preview media.
 */
export function estimateQuestionPayloadBytes(q: ParsedQuestion): number {
  let bytes = 320; // Fixed JSON keys & envelope overhead
  bytes += utf8ByteLength(q.prompt);
  bytes += utf8ByteLength(q.chapter);
  bytes += utf8ByteLength(q.promptImageUrl);
  bytes += utf8ByteLength(q.backText);
  bytes += utf8ByteLength(q.backImageUrl);
  bytes += utf8ByteLength(q.explanation);
  bytes += utf8ByteLength(q.hint);

  for (const tag of q.tags) {
    bytes += utf8ByteLength(tag) + 6;
  }

  for (const m of q.promptMedia ?? []) {
    bytes +=
      160 +
      utf8ByteLength(m.fileName) +
      utf8ByteLength(m.previewPath) +
      utf8ByteLength(m.tempStoragePath) +
      utf8ByteLength(m.dataUrl) +
      utf8ByteLength(m.alt);
  }

  for (const m of q.explanationMedia ?? []) {
    bytes +=
      160 +
      utf8ByteLength(m.fileName) +
      utf8ByteLength(m.previewPath) +
      utf8ByteLength(m.tempStoragePath) +
      utf8ByteLength(m.dataUrl) +
      utf8ByteLength(m.alt);
  }

  for (const opt of q.options) {
    bytes += 120 + utf8ByteLength(opt.content) + utf8ByteLength(opt.imageUrl);
    for (const m of opt.media ?? []) {
      bytes +=
        160 +
        utf8ByteLength(m.fileName) +
        utf8ByteLength(m.previewPath) +
        utf8ByteLength(m.tempStoragePath) +
        utf8ByteLength(m.dataUrl) +
        utf8ByteLength(m.alt);
    }
  }

  for (const acc of q.acceptedAnswers ?? []) {
    bytes += 64 + utf8ByteLength(acc.answerText);
  }

  return bytes;
}

/**
 * Splits questions into ordered commit chunks guaranteed to stay within BOTH
 * `maxChunkBytes` (default `2.5 MB`, safely below Vercel Hobby's 4.5 MB limit)
 * AND `maxQuestionsPerChunk` (default `500`) across ALL import formats.
 */
export function buildVercelSafeCommitChunks(
  questions: readonly ParsedQuestion[],
  options?: {
    maxChunkBytes?: number;
    maxQuestionsPerChunk?: number;
  },
): ParsedQuestion[][] {
  if (questions.length === 0) return [];
  const maxBytes = options?.maxChunkBytes ?? VERCEL_SAFE_COMMIT_CHUNK_BYTES;
  const maxCount = options?.maxQuestionsPerChunk ?? MAX_COMMIT_QUESTIONS_PER_CHUNK;
  const ENVELOPE_OVERHEAD = 2048;

  const chunks: ParsedQuestion[][] = [];
  let current: ParsedQuestion[] = [];
  let currentBytes = ENVELOPE_OVERHEAD;

  for (const q of questions) {
    const qBytes = estimateQuestionPayloadBytes(q);
    if (
      current.length > 0 &&
      (current.length >= maxCount || currentBytes + qBytes > maxBytes)
    ) {
      chunks.push(current);
      current = [];
      currentBytes = ENVELOPE_OVERHEAD;
    }
    current.push(q);
    currentBytes += qBytes;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}
