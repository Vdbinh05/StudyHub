"use client";

import * as React from "react";
import type { SafeKatexResult } from "@/lib/richtext/katex";

type RenderSafeKatexFn = (
  latex: string,
  displayMode?: boolean,
) => SafeKatexResult;

interface TestKatexModule {
  renderToString: (
    tex: string,
    options?: Record<string, unknown>,
  ) => string;
}

interface NodeModuleBuiltin {
  createRequire: (filename: string) => (id: string) => unknown;
}

interface ProcessWithBuiltin {
  getBuiltinModule?: (id: string) => unknown;
}

const MAX_KATEX_INPUT = 2000;

let cachedRenderSafeKatex: RenderSafeKatexFn | null = null;
let katexLoadPromise: Promise<RenderSafeKatexFn> | null = null;

/**
 * In Vitest (`NODE_ENV === "test"`), `renderToStaticMarkup` executes synchronously
 * without running client effects. Because Next.js statically replaces
 * `process.env.NODE_ENV` with `"production"` during builds, this branch is
 * completely dead-code eliminated from browser bundles and NEVER pulls `katex`
 * into eager client chunks.
 */
function tryGetTestSyncRenderer(): RenderSafeKatexFn | null {
  if (process.env.NODE_ENV !== "test") {
    return null;
  }
  if (cachedRenderSafeKatex) {
    return cachedRenderSafeKatex;
  }
  try {
    const proc = process as unknown as ProcessWithBuiltin;
    const modBuiltin = proc.getBuiltinModule?.("module") as
      | NodeModuleBuiltin
      | undefined;
    if (!modBuiltin) return null;
    const req = modBuiltin.createRequire(import.meta.url);
    const katex = req("katex") as TestKatexModule;
    if (!katex || typeof katex.renderToString !== "function") {
      return null;
    }

    const syncFn: RenderSafeKatexFn = (latex: string, displayMode = false) => {
      const trimmed = latex.trim().slice(0, MAX_KATEX_INPUT);
      if (!trimmed) {
        return { html: "", valid: false, error: "Empty formula" };
      }
      try {
        const html = katex.renderToString(trimmed, {
          displayMode,
          trust: false,
          strict: "ignore",
          throwOnError: true,
          maxExpand: 500,
          maxSize: 20,
          output: "htmlAndMathml",
        });
        if (/<script\b|javascript:/i.test(html)) {
          return { html: "", valid: false, error: "Disallowed formula output" };
        }
        return { html, valid: true };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Invalid LaTeX syntax";
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
    };

    cachedRenderSafeKatex = syncFn;
    return syncFn;
  } catch {
    return null;
  }
}

function loadKatexRenderer(): Promise<RenderSafeKatexFn> {
  if (cachedRenderSafeKatex) {
    return Promise.resolve(cachedRenderSafeKatex);
  }
  if (!katexLoadPromise) {
    katexLoadPromise = Promise.all([
      import("@/lib/richtext/katex"),
      import("katex/dist/katex.min.css"),
    ]).then(([katexMod]) => {
      cachedRenderSafeKatex = katexMod.renderSafeKatexHtml;
      return katexMod.renderSafeKatexHtml;
    });
  }
  return katexLoadPromise;
}

export interface SafeMathFragmentProps {
  latex: string;
  displayMode: boolean;
}

/**
 * Code-split KaTeX formula renderer (`trust: false` + `<script|javascript:` guard).
 * Non-math study sets & exams never download `katex` (78 KB gz) or `katex.min.css` (5 KB gz).
 */
export function SafeMathFragment({
  latex,
  displayMode,
}: SafeMathFragmentProps): React.ReactElement | null {
  const [renderer, setRenderer] = React.useState<RenderSafeKatexFn | null>(
    () => cachedRenderSafeKatex ?? tryGetTestSyncRenderer(),
  );

  React.useEffect(() => {
    if (renderer) return;
    let active = true;
    void loadKatexRenderer()
      .then((fn) => {
        if (active) {
          setRenderer(() => fn);
        }
      })
      .catch(() => {
        // Keep readable raw formula fallback if chunk load fails offline
      });
    return () => {
      active = false;
    };
  }, [renderer]);

  const activeRenderer = renderer ?? cachedRenderSafeKatex;
  const rendered = activeRenderer
    ? activeRenderer(latex, displayMode)
    : null;

  if (!rendered || !rendered.html) {
    if (displayMode) {
      return (
        <div
          className="my-2 overflow-x-auto py-1 text-center"
          data-math-mode="block"
        >
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {latex}
          </code>
        </div>
      );
    }
    return (
      <code
        className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-muted-foreground"
        data-math-mode="inline"
      >
        {latex}
      </code>
    );
  }

  if (displayMode) {
    return (
      <div
        className="my-2 overflow-x-auto py-1 text-center"
        data-math-mode="block"
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
    );
  }

  return (
    <span
      className="inline-block align-baseline"
      data-math-mode="inline"
      dangerouslySetInnerHTML={{ __html: rendered.html }}
    />
  );
}
