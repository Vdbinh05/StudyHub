import katex from "katex";

const MAX_KATEX_INPUT = 2000;

export interface SafeKatexResult {
  html: string;
  valid: boolean;
  error?: string;
}

export interface AcademicSymbolGroup {
  id: string;
  labelVi: string;
  labelEn: string;
  items: ReadonlyArray<{
    label: string;
    latex: string;
    description: string;
  }>;
}

export const ACADEMIC_SYMBOL_PALETTE: readonly AcademicSymbolGroup[] = [
  {
    id: "structure",
    labelVi: "Cấu trúc",
    labelEn: "Structures",
    items: [
      { label: "a/b", latex: "\\frac{a}{b}", description: "Fraction" },
      { label: "x²", latex: "x^{2}", description: "Superscript" },
      { label: "xᵢ", latex: "x_{i}", description: "Subscript" },
      { label: "√x", latex: "\\sqrt{x}", description: "Square root" },
      { label: "ⁿ√x", latex: "\\sqrt[n]{x}", description: "Nth root" },
      { label: "∑", latex: "\\sum_{i=1}^{n} x_i", description: "Summation" },
      { label: "∫", latex: "\\int_{a}^{b} f(x)\\,dx", description: "Integral" },
      { label: "lim", latex: "\\lim_{x \\to 0}", description: "Limit" },
    ],
  },
  {
    id: "operators",
    labelVi: "Toán tử & So sánh",
    labelEn: "Operators & Relations",
    items: [
      { label: "±", latex: "\\pm", description: "Plus-minus" },
      { label: "×", latex: "\\times", description: "Times" },
      { label: "÷", latex: "\\div", description: "Divided by" },
      { label: "·", latex: "\\cdot", description: "Dot product" },
      { label: "≤", latex: "\\le", description: "Less than or equal" },
      { label: "≥", latex: "\\ge", description: "Greater than or equal" },
      { label: "≠", latex: "\\ne", description: "Not equal" },
      { label: "≈", latex: "\\approx", description: "Approximately" },
      { label: "→", latex: "\\rightarrow", description: "Yields / approaches" },
      { label: "⇌", latex: "\\rightleftharpoons", description: "Equilibrium" },
      { label: "°", latex: "^{\\circ}", description: "Degree" },
      { label: "∞", latex: "\\infty", description: "Infinity" },
    ],
  },
  {
    id: "greek",
    labelVi: "Hy Lạp & Khoa học",
    labelEn: "Greek & Science",
    items: [
      { label: "α", latex: "\\alpha", description: "Alpha" },
      { label: "β", latex: "\\beta", description: "Beta" },
      { label: "γ", latex: "\\gamma", description: "Gamma" },
      { label: "Δ", latex: "\\Delta", description: "Delta" },
      { label: "θ", latex: "\\theta", description: "Theta" },
      { label: "λ", latex: "\\lambda", description: "Lambda" },
      { label: "μ", latex: "\\mu", description: "Mu" },
      { label: "π", latex: "\\pi", description: "Pi" },
      { label: "ρ", latex: "\\rho", description: "Rho" },
      { label: "σ", latex: "\\sigma", description: "Sigma" },
      { label: "Ω", latex: "\\Omega", description: "Omega" },
      { label: "H₂O", latex: "\\text{H}_2\\text{O}", description: "Chemical formula" },
    ],
  },
];

/**
 * Renders LaTeX safely with KaTeX:
 * - `trust: false` blocks `\href`, `\url`, `\htmlClass`, `\htmlStyle`, `\htmlData`, `\includegraphics`
 * - `maxExpand: 500` prevents macro expansion DoS
 * - `throwOnError: false` shows non-crashing error styling on malformed formulas
 */
export function renderSafeKatexHtml(
  latex: string,
  displayMode = false,
): SafeKatexResult {
  const trimmed = latex.trim().slice(0, MAX_KATEX_INPUT);
  if (!trimmed) {
    return { html: "", valid: false, error: "Empty formula" };
  }

  try {
    // Check validity first with throwOnError: true, then render gracefully on syntax error
    const html = katex.renderToString(trimmed, {
      displayMode,
      trust: false,
      strict: "ignore",
      throwOnError: true,
      maxExpand: 500,
      maxSize: 20,
      output: "htmlAndMathml",
    });

    // Defense-in-depth sanity check: KaTeX with trust:false never emits script/javascript:
    if (/<script\b|javascript:/i.test(html)) {
      return {
        html: "",
        valid: false,
        error: "Disallowed formula output",
      };
    }

    return { html, valid: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid LaTeX syntax";
    const fallbackHtml = katex.renderToString(trimmed, {
      displayMode,
      trust: false,
      strict: "ignore",
      throwOnError: false,
      maxExpand: 500,
      maxSize: 20,
      output: "htmlAndMathml",
    });
    return {
      html: /<script\b|javascript:/i.test(fallbackHtml) ? "" : fallbackHtml,
      valid: false,
      error: message,
    };
  }
}
