import type { AnswerMatchMode } from "@/types/domain";
import type {
  BlanksStructuredResponse,
  FillInBlankPayload,
  HotspotGeometry,
  HotspotStructuredResponse,
  ImageHotspotPayload,
  MatchingPayload,
  MatchingStructuredResponse,
  NormalizedPoint,
  NumericalPayload,
  NumericalStructuredResponse,
  OrderingPayload,
  OrderingStructuredResponse,
} from "@/types/v3";

export interface GradeOptionLike {
  id: string;
  content?: string | null;
  image_url?: string | null;
  media_id?: string | null;
  is_correct: boolean;
}

export interface GradeAcceptedAnswerLike {
  answer_text: string;
  normalized_answer?: string | null;
  match_mode?: AnswerMatchMode;
}

export interface GradeOptions {
  /** Enable explicit partial credit for multiple_choice / ordering / matching / fill_in_blank */
  partialCredit?: boolean;
  /** Explicit self-assessment override for short_answer (never silently assumed) */
  selfAssessedCorrect?: boolean;
}

export interface QuestionGradeResult {
  isCorrect: boolean;
  /** Normalized score in [0, 1] (1 = full credit, 0 = incorrect, (0,1) = explicit partial credit) */
  scoreRatio: number;
  gradingMode: "deterministic" | "self_assessed";
  reason?: string;
  details?: Record<string, unknown>;
}

const DEFAULT_POINT_HIT_RADIUS = 0.04;
const DEFAULT_NUMERIC_EPSILON = 1e-9;

/**
 * Strip Vietnamese/Unicode combining diacritics deterministically (`đ` -> `d`).
 */
export function stripDiacritics(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFC");
}

/**
 * Deterministic numeric string normalizer preserving `0`, `10`, `100`, negative numbers,
 * and decimal fractions without corrupting integer trailing zeros.
 */
export function normalizeNumericString(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, "").replace(/,/g, ".");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(cleaned)) {
    return raw.trim().toLowerCase();
  }
  const num = Number(cleaned);
  if (!Number.isFinite(num)) {
    return raw.trim().toLowerCase();
  }
  if (Object.is(num, -0) || num === 0) {
    return "0";
  }
  return String(num);
}

/**
 * Normalize text answer for deterministic comparison.
 * Preserves decimals (`-0.5`, `3.14`), minus signs, and numbers cleanly.
 */
export function normalizeAnswerForMode(
  raw: string,
  matchMode: AnswerMatchMode = "case_insensitive",
  caseSensitive = false,
): string {
  const trimmed = raw.normalize("NFC").replace(/\uFEFF/g, "").trim();
  if (!trimmed) return "";

  if (matchMode === "numeric") {
    return normalizeNumericString(trimmed);
  }

  if (matchMode === "exact") {
    return trimmed.replace(/\s+/g, " ");
  }

  let out = trimmed.replace(/\s+/g, " ");
  // Trim trailing/leading decorative punctuation while preserving minus signs, decimals, and numbers
  out = out.replace(/^[.,;:!?'"()[\]{}]+|[.,;:!?'"()[\]{}]+$/g, "").trim();

  if (matchMode === "ignore_diacritics") {
    out = stripDiacritics(out);
  }

  if (!caseSensitive) {
    out = out.toLowerCase();
  }

  return out;
}

/**
 * Grade single_choice, true_false, or single-mode image_choice strictly by stable option UUID.
 */
export function gradeSingleChoiceByUuid(
  options: readonly GradeOptionLike[],
  selectedOptionIds: readonly string[],
): QuestionGradeResult {
  const uniqueSelected = Array.from(new Set(selectedOptionIds.filter(Boolean)));
  const correctIds = options.filter((o) => o.is_correct).map((o) => o.id);

  if (uniqueSelected.length !== 1 || correctIds.length === 0) {
    return {
      isCorrect: false,
      scoreRatio: 0,
      gradingMode: "deterministic",
      reason: uniqueSelected.length === 0 ? "unanswered" : "wrong_selection",
    };
  }

  const isCorrect = correctIds.includes(uniqueSelected[0]);
  return {
    isCorrect,
    scoreRatio: isCorrect ? 1 : 0,
    gradingMode: "deterministic",
    reason: isCorrect ? "exact_match" : "wrong_selection",
  };
}

/**
 * Grade multiple_choice or multi-mode image_choice strictly by stable option UUID.
 * Exact-match by default; optional explicit `partialCredit` deducts symmetrically for
 * wrong selections so accidental wrong guesses NEVER grant free credit.
 */
export function gradeMultipleChoiceByUuid(
  options: readonly GradeOptionLike[],
  selectedOptionIds: readonly string[],
  opts: { partialCredit?: boolean } = {},
): QuestionGradeResult {
  const validOptionIds = new Set(options.map((o) => o.id));
  const selectedSet = new Set(
    selectedOptionIds.filter((id) => validOptionIds.has(id)),
  );
  const correctSet = new Set(options.filter((o) => o.is_correct).map((o) => o.id));

  if (correctSet.size === 0 || selectedSet.size === 0) {
    return {
      isCorrect: false,
      scoreRatio: 0,
      gradingMode: "deterministic",
      reason: selectedSet.size === 0 ? "unanswered" : "no_answer_key",
    };
  }

  let truePositives = 0;
  let falsePositives = 0;
  for (const id of selectedSet) {
    if (correctSet.has(id)) truePositives += 1;
    else falsePositives += 1;
  }

  const exactMatch =
    truePositives === correctSet.size && falsePositives === 0;

  if (exactMatch) {
    return {
      isCorrect: true,
      scoreRatio: 1,
      gradingMode: "deterministic",
      reason: "exact_match",
      details: { truePositives, falsePositives, totalCorrect: correctSet.size },
    };
  }

  if (opts.partialCredit) {
    // Symmetric penalty: wrong selections subtract from correct selections, clamped to [0, 1)
    const rawRatio = (truePositives - falsePositives) / correctSet.size;
    const scoreRatio = Math.max(0, Math.min(1, Number(rawRatio.toFixed(4))));
    return {
      isCorrect: false,
      scoreRatio,
      gradingMode: "deterministic",
      reason: scoreRatio > 0 ? "partial_credit" : "wrong_selection",
      details: { truePositives, falsePositives, totalCorrect: correctSet.size },
    };
  }

  return {
    isCorrect: false,
    scoreRatio: 0,
    gradingMode: "deterministic",
    reason: "wrong_selection",
    details: { truePositives, falsePositives, totalCorrect: correctSet.size },
  };
}

/**
 * Grade fill_in_blank across 1+ blanks using blank_id mapping.
 */
export function gradeFillInBlankResponse(
  payload: FillInBlankPayload,
  response: BlanksStructuredResponse,
  opts: { partialCredit?: boolean } = {},
): QuestionGradeResult {
  const blanks = payload.blanks ?? [];
  if (blanks.length === 0) {
    return {
      isCorrect: false,
      scoreRatio: 0,
      gradingMode: "deterministic",
      reason: "no_blanks_configured",
    };
  }

  const perBlank: Array<{ blankId: string; isCorrect: boolean }> = [];
  let correctCount = 0;

  for (const spec of blanks) {
    const rawTyped = response.answers[spec.blank_id] ?? "";
    const matchMode = spec.match_mode ?? "case_insensitive";
    const caseSensitive = Boolean(spec.case_sensitive);
    const normTyped = normalizeAnswerForMode(rawTyped, matchMode, caseSensitive);

    let matched = false;
    if (normTyped.length > 0) {
      for (const accepted of spec.accepted_answers) {
        const normAccepted = normalizeAnswerForMode(
          accepted,
          matchMode,
          caseSensitive,
        );
        if (normAccepted.length > 0 && normTyped === normAccepted) {
          matched = true;
          break;
        }
      }
    }

    if (matched) correctCount += 1;
    perBlank.push({ blankId: spec.blank_id, isCorrect: matched });
  }

  const allCorrect = correctCount === blanks.length;
  const requireAll = payload.require_all_blanks !== false;
  const ratio = Number((correctCount / blanks.length).toFixed(4));

  return {
    isCorrect: allCorrect,
    scoreRatio: allCorrect ? 1 : !requireAll || opts.partialCredit ? ratio : 0,
    gradingMode: "deterministic",
    reason: allCorrect ? "exact_match" : "blank_mismatch",
    details: { correctCount, totalBlanks: blanks.length, perBlank },
  };
}

/**
 * Grade short_answer deterministically with explicit separation of `self_assessed`.
 */
export function gradeShortAnswerResponse(
  acceptedAnswers: readonly GradeAcceptedAnswerLike[],
  fallbackBackText: string | null | undefined,
  rawTyped: string,
  opts: { selfAssessedCorrect?: boolean } = {},
): QuestionGradeResult {
  if (opts.selfAssessedCorrect !== undefined) {
    return {
      isCorrect: opts.selfAssessedCorrect,
      scoreRatio: opts.selfAssessedCorrect ? 1 : 0,
      gradingMode: "self_assessed",
      reason: opts.selfAssessedCorrect
        ? "self_assessed_correct"
        : "self_assessed_incorrect",
    };
  }

  const candidates: GradeAcceptedAnswerLike[] =
    acceptedAnswers.length > 0
      ? [...acceptedAnswers]
      : fallbackBackText && fallbackBackText.trim().length > 0
        ? [{ answer_text: fallbackBackText.trim(), match_mode: "case_insensitive" }]
        : [];

  if (candidates.length === 0 || !rawTyped.trim()) {
    return {
      isCorrect: false,
      scoreRatio: 0,
      gradingMode: "deterministic",
      reason: !rawTyped.trim() ? "unanswered" : "no_answer_key",
    };
  }

  for (const candidate of candidates) {
    const mode = candidate.match_mode ?? "case_insensitive";
    const normTyped = normalizeAnswerForMode(rawTyped, mode, mode === "exact");
    const normExpected = normalizeAnswerForMode(
      candidate.answer_text,
      mode,
      mode === "exact",
    );
    if (normExpected.length > 0 && normTyped === normExpected) {
      return {
        isCorrect: true,
        scoreRatio: 1,
        gradingMode: "deterministic",
        reason: "exact_match",
      };
    }
  }

  return {
    isCorrect: false,
    scoreRatio: 0,
    gradingMode: "deterministic",
    reason: "answer_mismatch",
  };
}

export interface ParsedNumericalInput {
  value: number;
  unit: string | null;
}

/**
 * Parse a user numerical input supporting:
 * - integers (`0`, `10`, `100`, `-42`)
 * - decimals (`-0.5`, `1013.25`, `0,75`)
 * - scientific notation (`1.2e-3`, `3.0E+8`, `2.5 × 10^4`, `2.5 x 10^-2`)
 * - optional trailing unit (`1013.25 hPa`, `250kt`, `-5 °C`, `9.81 m/s^2`)
 */
export function parseNumericalInput(raw: string): ParsedNumericalInput | null {
  const trimmed = raw.normalize("NFC").replace(/\uFEFF/g, "").trim();
  if (!trimmed) return null;

  // Handle "2.5 × 10^4 unit" / "2.5 x 10^-3 unit" notation first
  const sciExplicit =
    /^([+-]?(?:\d+(?:[.,]\d+)?|\.\d+))\s*[×xX*]\s*10\s*\^?\s*([+-]?\d+)(?:\s*(.*))?$/.exec(
      trimmed,
    );
  if (sciExplicit) {
    const mantissa = Number(sciExplicit[1].replace(",", "."));
    const exponent = Number(sciExplicit[2]);
    const val = mantissa * Math.pow(10, exponent);
    if (!Number.isFinite(val)) return null;
    const unit = (sciExplicit[3] ?? "").trim() || null;
    return { value: Object.is(val, -0) ? 0 : val, unit };
  }

  // Handle standard integer, decimal, or e-notation + optional unit
  // Reject ambiguous comma-thousands vs comma-decimal like "1,234,567" unless clean
  const stdMatch =
    /^([+-]?(?:\d+(?:[.,]\d+)?|\.\d+)(?:[eE][+-]?\d+)?)(?:\s*(.*))?$/.exec(
      trimmed,
    );
  if (!stdMatch) return null;

  const numStr = stdMatch[1].replace(",", ".");
  const value = Number(numStr);
  if (!Number.isFinite(value)) return null;

  const trailing = (stdMatch[2] ?? "").trim();
  // Reject trailing arithmetic expressions like "10 + 5" or extra digits
  if (trailing && /^[+\-*/=0-9]/.test(trailing)) {
    return null;
  }

  return {
    value: Object.is(value, -0) ? 0 : value,
    unit: trailing || null,
  };
}

function normalizeUnit(unit: string): string {
  return unit
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

/**
 * Grade numerical response with absolute/relative tolerance and strict unit checking.
 * Dimensionally wrong units are NEVER accepted even when the numeric value matches!
 */
export function gradeNumericalResponse(
  payload: NumericalPayload,
  response: NumericalStructuredResponse,
): QuestionGradeResult {
  if (!Number.isFinite(payload.correct_value)) {
    return {
      isCorrect: false,
      scoreRatio: 0,
      gradingMode: "deterministic",
      reason: "invalid_expected_value",
    };
  }

  const parsedFromValue = parseNumericalInput(response.value ?? "");
  let numericVal: number | null = null;
  let suppliedUnit: string | null = null;

  if (parsedFromValue) {
    numericVal = parsedFromValue.value;
    suppliedUnit = response.unit?.trim() || parsedFromValue.unit;
  } else if (
    typeof response.numeric_value === "number" &&
    Number.isFinite(response.numeric_value) &&
    !(response.value ?? "").trim()
  ) {
    numericVal = response.numeric_value;
    suppliedUnit = response.unit?.trim() || null;
  }

  if (numericVal === null) {
    return {
      isCorrect: false,
      scoreRatio: 0,
      gradingMode: "deterministic",
      reason: "invalid_number",
    };
  }

  // Unit validation: build normalized allowlist from payload.unit + payload.accepted_units
  const acceptedUnits = new Set<string>();
  if (payload.unit && payload.unit.trim()) {
    acceptedUnits.add(normalizeUnit(payload.unit));
  }
  for (const u of payload.accepted_units ?? []) {
    if (u.trim()) acceptedUnits.add(normalizeUnit(u));
  }

  if (suppliedUnit) {
    if (acceptedUnits.size === 0 || !acceptedUnits.has(normalizeUnit(suppliedUnit))) {
      return {
        isCorrect: false,
        scoreRatio: 0,
        gradingMode: "deterministic",
        reason: "wrong_unit",
        details: { suppliedUnit, expectedUnit: payload.unit ?? null },
      };
    }
  } else if (payload.unit_required && acceptedUnits.size > 0) {
    return {
      isCorrect: false,
      scoreRatio: 0,
      gradingMode: "deterministic",
      reason: "missing_unit",
      details: { expectedUnit: payload.unit ?? null },
    };
  }

  const expected = payload.correct_value;
  const diff = Math.abs(numericVal - expected);
  const absTol =
    typeof payload.abs_tolerance === "number" && payload.abs_tolerance >= 0
      ? payload.abs_tolerance
      : null;
  const relTol =
    typeof payload.rel_tolerance === "number" && payload.rel_tolerance >= 0
      ? payload.rel_tolerance
      : null;

  let withinTolerance = false;
  if (absTol === null && relTol === null) {
    withinTolerance = diff <= DEFAULT_NUMERIC_EPSILON;
  } else {
    const absOk = absTol !== null && diff <= absTol + DEFAULT_NUMERIC_EPSILON;
    const relOk =
      relTol !== null &&
      diff <= Math.abs(expected) * relTol + DEFAULT_NUMERIC_EPSILON;
    withinTolerance = absOk || relOk;
  }

  return {
    isCorrect: withinTolerance,
    scoreRatio: withinTolerance ? 1 : 0,
    gradingMode: "deterministic",
    reason: withinTolerance ? "within_tolerance" : "out_of_tolerance",
    details: { numericVal, expected, diff, suppliedUnit },
  };
}

/**
 * Grade ordering response strictly by stable `item.id`.
 */
export function gradeOrderingResponse(
  payload: OrderingPayload,
  response: OrderingStructuredResponse,
  opts: { partialCredit?: boolean } = {},
): QuestionGradeResult {
  const expectedOrder = [...(payload.items ?? [])]
    .sort((a, b) => a.correct_position - b.correct_position)
    .map((item) => item.id);

  if (expectedOrder.length === 0) {
    return {
      isCorrect: false,
      scoreRatio: 0,
      gradingMode: "deterministic",
      reason: "no_ordering_items",
    };
  }

  const submitted = response.ordered_item_ids ?? [];
  if (submitted.length !== expectedOrder.length) {
    return {
      isCorrect: false,
      scoreRatio: 0,
      gradingMode: "deterministic",
      reason: "incomplete_order",
    };
  }

  // Reject duplicate IDs in submitted permutation
  if (new Set(submitted).size !== expectedOrder.length) {
    return {
      isCorrect: false,
      scoreRatio: 0,
      gradingMode: "deterministic",
      reason: "duplicate_item_ids",
    };
  }

  let matchedPositions = 0;
  for (let i = 0; i < expectedOrder.length; i += 1) {
    if (submitted[i] === expectedOrder[i]) {
      matchedPositions += 1;
    }
  }

  const exact = matchedPositions === expectedOrder.length;
  const allowPartial = Boolean(payload.allow_partial_credit || opts.partialCredit);

  return {
    isCorrect: exact,
    scoreRatio: exact
      ? 1
      : allowPartial
        ? Number((matchedPositions / expectedOrder.length).toFixed(4))
        : 0,
    gradingMode: "deterministic",
    reason: exact ? "exact_order" : "order_mismatch",
    details: { matchedPositions, totalItems: expectedOrder.length },
  };
}

/**
 * Grade matching response strictly by stable `pair.id -> pair.right_id`
 * so duplicate display text labels NEVER collide or corrupt grading.
 */
export function gradeMatchingResponse(
  payload: MatchingPayload,
  response: MatchingStructuredResponse,
  opts: { partialCredit?: boolean } = {},
): QuestionGradeResult {
  const pairs = payload.pairs ?? [];
  if (pairs.length === 0) {
    return {
      isCorrect: false,
      scoreRatio: 0,
      gradingMode: "deterministic",
      reason: "no_matching_pairs",
    };
  }

  let matchedCount = 0;
  const perPair: Array<{ pairId: string; isCorrect: boolean }> = [];

  for (const pair of pairs) {
    const selectedRightId = response.pairs[pair.id];
    const ok = Boolean(selectedRightId) && selectedRightId === pair.right_id;
    if (ok) matchedCount += 1;
    perPair.push({ pairId: pair.id, isCorrect: ok });
  }

  const exact = matchedCount === pairs.length;
  return {
    isCorrect: exact,
    scoreRatio: exact
      ? 1
      : opts.partialCredit
        ? Number((matchedCount / pairs.length).toFixed(4))
        : 0,
    gradingMode: "deterministic",
    reason: exact ? "exact_match" : "pair_mismatch",
    details: { matchedCount, totalPairs: pairs.length, perPair },
  };
}

/**
 * Pure normalized [0, 1] point-in-hotspot check supporting point (with radius),
 * rectangle, and polygon (even-odd ray casting + boundary hit).
 */
export function isPointInsideHotspot(
  point: NormalizedPoint,
  geometry: HotspotGeometry,
): boolean {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.x > 1 ||
    point.y < 0 ||
    point.y > 1
  ) {
    return false;
  }

  if (geometry.shape === "point") {
    const radius =
      typeof geometry.radius === "number" &&
      Number.isFinite(geometry.radius) &&
      geometry.radius > 0
        ? geometry.radius
        : DEFAULT_POINT_HIT_RADIUS;
    const dx = point.x - geometry.x;
    const dy = point.y - geometry.y;
    return dx * dx + dy * dy <= radius * radius + 1e-12;
  }

  if (geometry.shape === "rect") {
    const minX = Math.min(geometry.x, geometry.x + geometry.width);
    const maxX = Math.max(geometry.x, geometry.x + geometry.width);
    const minY = Math.min(geometry.y, geometry.y + geometry.height);
    const maxY = Math.max(geometry.y, geometry.y + geometry.height);
    return (
      point.x >= minX - 1e-12 &&
      point.x <= maxX + 1e-12 &&
      point.y >= minY - 1e-12 &&
      point.y <= maxY + 1e-12
    );
  }

  // Polygon ray-casting
  const pts = geometry.points;
  if (!pts || pts.length < 3) return false;

  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;

    // Boundary check (point on segment)
    const cross = (point.y - yi) * (xj - xi) - (point.x - xi) * (yj - yi);
    if (
      Math.abs(cross) <= 1e-9 &&
      point.x >= Math.min(xi, xj) - 1e-9 &&
      point.x <= Math.max(xi, xj) + 1e-9 &&
      point.y >= Math.min(yi, yj) - 1e-9 &&
      point.y <= Math.max(yi, yj) + 1e-9
    ) {
      return true;
    }

    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Grade image_hotspot response against normalized [0, 1] target hotspots.
 * Supports pointer clicks (`clicks`) AND accessible keyboard target selection (`selected_hotspot_ids`).
 */
export function gradeImageHotspotResponse(
  payload: ImageHotspotPayload,
  response: HotspotStructuredResponse,
): QuestionGradeResult {
  const targets = payload.target_hotspots ?? [];
  if (targets.length === 0) {
    return {
      isCorrect: false,
      scoreRatio: 0,
      gradingMode: "deterministic",
      reason: "no_hotspots_configured",
    };
  }

  const hits = new Set<string>();
  const clicks = response.clicks ?? [];
  for (const click of clicks) {
    for (const target of targets) {
      if (isPointInsideHotspot(click, target.geometry)) {
        hits.add(target.id);
      }
    }
  }

  // Keyboard accessibility path: explicit hotspot IDs selected from accessible list
  const targetIdSet = new Set(targets.map((t) => t.id));
  let invalidSelectedIds = 0;
  for (const id of response.selected_hotspot_ids ?? []) {
    if (targetIdSet.has(id)) hits.add(id);
    else invalidSelectedIds += 1;
  }

  const requireAll = Boolean(payload.require_all_targets);
  const isCorrect = requireAll
    ? hits.size === targets.length && invalidSelectedIds === 0
    : hits.size > 0 && invalidSelectedIds === 0;

  return {
    isCorrect,
    scoreRatio: isCorrect ? 1 : 0,
    gradingMode: "deterministic",
    reason: isCorrect ? "hotspot_hit" : "hotspot_miss",
    details: { hitTargetIds: Array.from(hits), totalTargets: targets.length },
  };
}
