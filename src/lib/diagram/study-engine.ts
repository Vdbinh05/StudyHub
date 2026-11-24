/**
 * Deterministic 6-Mode Diagram Study Engine for StudyHub V3.0.
 * Zero AI, zero React coupling — shared across DiagramStudyPlayer and unit tests.
 */

import {
  fromDiagramHotspot,
  hitTestAllHotspots,
  hitTestV3HotspotGeometry,
  type NormalizedPoint,
} from "@/lib/diagram/geometry";
import { normalizeAnswerText } from "@/lib/security/sanitize";
import type { DiagramHotspot, DiagramStudyMode } from "@/types/v3";

export interface DiagramIdentifyGradeResult {
  isCorrect: boolean;
  clickedHotspotId: string | null;
  clickedHotspotLabel: string | null;
}

export interface DiagramNameGradeResult {
  isCorrect: boolean;
  matchedLabel: string | null;
}

export interface DiagramMcChoice {
  hotspotId: string;
  label: string;
  isCorrect: boolean;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const arr = [...items];
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function hashStringSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic click/tap hit grader for "Identify Location" mode.
 */
export function gradeDiagramIdentifyClick(
  click: NormalizedPoint,
  target: DiagramHotspot,
  allHotspots: readonly DiagramHotspot[],
  extraTolerance = 0,
): DiagramIdentifyGradeResult {
  if (hitTestV3HotspotGeometry(click, target.geometry, extraTolerance)) {
    return {
      isCorrect: true,
      clickedHotspotId: target.id,
      clickedHotspotLabel: target.label,
    };
  }

  const mapped = allHotspots.map((h) => ({
    ...fromDiagramHotspot(h),
    original: h,
  }));
  const hits = hitTestAllHotspots(click, mapped, extraTolerance);
  const firstHit = hits[0]?.original ?? null;

  return {
    isCorrect: false,
    clickedHotspotId: firstHit?.id ?? null,
    clickedHotspotLabel: firstHit?.label ?? null,
  };
}

/**
 * Deterministic typed-label grader for "Name the Location" mode.
 * Supports primary label and `accepted_alternatives`, aligned 1:1 with StudyHub's `normalizeAnswerText`.
 */
export function gradeDiagramNameAnswer(
  typed: string,
  target: DiagramHotspot,
  strictDiacritics = false,
): DiagramNameGradeResult {
  const mode = strictDiacritics ? "case_insensitive" : "ignore_diacritics";
  const normalizedTyped = normalizeAnswerText(typed, mode);
  if (!normalizedTyped) {
    return { isCorrect: false, matchedLabel: null };
  }

  const candidates = [target.label, ...(target.accepted_alternatives ?? [])]
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  for (const candidate of candidates) {
    if (normalizeAnswerText(candidate, mode) === normalizedTyped) {
      return { isCorrect: true, matchedLabel: candidate };
    }
  }

  return { isCorrect: false, matchedLabel: null };
}

/**
 * Generates deterministic unique multiple-choice options for "Multiple Choice Diagram" mode.
 */
export function buildDiagramMcChoices(
  target: DiagramHotspot,
  allHotspots: readonly DiagramHotspot[],
  maxChoices = 4,
  seed?: number,
): DiagramMcChoice[] {
  const safeMax = Math.max(2, Math.min(6, maxChoices));
  const targetNorm = normalizeAnswerText(target.label, "ignore_diacritics");
  const baseSeed = seed ?? hashStringSeed(`${target.id}:${allHotspots.length}`);

  const uniqueDistractors: DiagramHotspot[] = [];
  const seenLabels = new Set<string>([targetNorm]);

  const shuffledPool = seededShuffle(
    allHotspots.filter((h) => h.id !== target.id),
    baseSeed ^ 0x9e3779b9,
  );

  for (const candidate of shuffledPool) {
    const norm = normalizeAnswerText(candidate.label, "ignore_diacritics");
    if (!norm || seenLabels.has(norm)) continue;
    seenLabels.add(norm);
    uniqueDistractors.push(candidate);
    if (uniqueDistractors.length >= safeMax - 1) break;
  }

  const choices: DiagramMcChoice[] = [
    { hotspotId: target.id, label: target.label, isCorrect: true },
    ...uniqueDistractors.map((d) => ({
      hotspotId: d.id,
      label: d.label,
      isCorrect: false,
    })),
  ];

  return seededShuffle(choices, baseSeed);
}

/**
 * Creates the ordered or deterministically shuffled study queue for any of the 6 diagram modes.
 */
export function createDiagramStudyQueue(
  hotspots: readonly DiagramHotspot[],
  mode: DiagramStudyMode,
  incorrectIds: readonly string[],
  shuffleSeed?: number,
): DiagramHotspot[] {
  const sorted = [...hotspots].sort((a, b) => a.sort_order - b.sort_order);

  if (mode === "review_incorrect") {
    const missSet = new Set(incorrectIds);
    return sorted.filter((h) => missSet.has(h.id));
  }

  if (mode === "explore" || mode === "hidden_labels") {
    return sorted;
  }

  if (typeof shuffleSeed === "number") {
    return seededShuffle(sorted, shuffleSeed);
  }

  return sorted;
}
