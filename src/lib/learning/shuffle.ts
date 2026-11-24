export type RngFn = () => number;

/**
 * Hash a string seed into a 32-bit unsigned integer (FNV-1a).
 */
function hashSeed(seed: string | number): number {
  if (typeof seed === "number") {
    return seed >>> 0;
  }
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Create a deterministic PRNG (Mulberry32) for reproducible shuffling in exams and tests.
 */
export function createSeededRng(seed: string | number): RngFn {
  let state = hashSeed(seed) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Non-mutating Fisher-Yates shuffle.
 */
export function fisherYatesShuffle<T>(
  items: readonly T[],
  rng: RngFn = Math.random,
): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = copy[i];
    copy[i] = copy[j];
    copy[j] = temp;
  }
  return copy;
}

/**
 * Convert a 0-based rendered option position to display label ('A', 'B', ..., 'Z', 'AA', ...).
 */
export function indexToOptionLabel(index: number): string {
  if (index < 0) return "A";
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

export interface ShufflableOption {
  id: string;
}

export type DisplayedOption<T extends ShufflableOption> = T & {
  displayLabel: string;
  displayPosition: number;
};

/**
 * Shuffle options via Fisher-Yates while preserving each option's stable UUID `id`.
 * Recomputes `displayLabel` (A, B, C, D...) strictly from the rendered position.
 */
export function shuffleOptions<T extends ShufflableOption>(
  options: readonly T[],
  rng: RngFn = Math.random,
): Array<DisplayedOption<T>> {
  return fisherYatesShuffle(options, rng).map((option, idx) => ({
    ...option,
    displayLabel: indexToOptionLabel(idx),
    displayPosition: idx,
  }));
}

/**
 * Keep original option order while attaching displayLabel and displayPosition.
 */
export function withOptionDisplayLabels<T extends ShufflableOption>(
  options: readonly T[],
): Array<DisplayedOption<T>> {
  return options.map((option, idx) => ({
    ...option,
    displayLabel: indexToOptionLabel(idx),
    displayPosition: idx,
  }));
}

/**
 * Shuffle questions without mutating the source array.
 */
export function shuffleQuestions<T>(
  questions: readonly T[],
  rng: RngFn = Math.random,
): T[] {
  return fisherYatesShuffle(questions, rng);
}

/**
 * Grade a choice question strictly by stable option UUID set equality.
 * NEVER grades by display letter or index so option shuffling can never corrupt grading.
 */
export function gradeChoiceSelection(
  selectedOptionIds: readonly string[],
  correctOptionIds: readonly string[],
): boolean {
  const correctSet = new Set(correctOptionIds.filter(Boolean));
  if (correctSet.size === 0) return false;

  const selectedSet = new Set(selectedOptionIds.filter(Boolean));
  if (selectedSet.size !== correctSet.size) return false;

  for (const id of correctSet) {
    if (!selectedSet.has(id)) return false;
  }
  return true;
}
