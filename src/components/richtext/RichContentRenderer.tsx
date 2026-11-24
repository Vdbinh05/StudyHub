import * as React from "react";
import "katex/dist/katex.min.css";
import {
  renderSafeKatexHtml,
  sanitizeRichTextDoc,
  tokenizePlainTextWithMath,
} from "@/lib/richtext";
import { cn } from "@/lib/utils";
import type { RichTextDoc, RichTextMark, RichTextNode } from "@/types/v3";

export interface RichContentRendererProps {
  /** Canonical TipTap/ProseMirror v1 AST JSON. Takes precedence when non-empty. */
  richDoc?: RichTextDoc | null;
  /** Backward-compatible plain text fallback (supports inline `$...$` / block `$$...$$` math). */
  plainText?: string | null;
  /** Optional className on outer wrapper. */
  className?: string;
  /** Compact inline layout (ideal for option labels, flashcards, or list previews). */
  inline?: boolean;
  /** Parse `$...$` / `$$...$$` math in legacy plain-text fallback. Default: `true`. */
  enableMathInPlainText?: boolean;
  /**
   * Allow safe raster `data:image/*;base64,...` image nodes (ONLY for transient import preview!).
   * Default: `false`.
   */
  allowDataImagePreview?: boolean;
}

function SafeMathFragment({
  latex,
  displayMode,
}: {
  latex: string;
  displayMode: boolean;
}): React.ReactElement | null {
  const rendered = renderSafeKatexHtml(latex, displayMode);
  if (!rendered.html) {
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-muted-foreground">
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

function wrapTextWithMarks(
  content: React.ReactNode,
  marks: RichTextMark[] | undefined,
  keyPrefix: string,
): React.ReactNode {
  if (!marks || marks.length === 0) return content;

  return marks.reduce<React.ReactNode>((acc, mark, idx) => {
    const key = `${keyPrefix}-m-${idx}`;
    switch (mark.type) {
      case "bold":
        return <strong key={key} className="font-semibold">{acc}</strong>;
      case "italic":
        return <em key={key}>{acc}</em>;
      case "underline":
        return <u key={key} className="underline underline-offset-2">{acc}</u>;
      case "strike":
        return <s key={key} className="line-through">{acc}</s>;
      case "code":
        return (
          <code
            key={key}
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.875em] text-foreground"
          >
            {acc}
          </code>
        );
      case "superscript":
        return <sup key={key} className="text-[0.75em]">{acc}</sup>;
      case "subscript":
        return <sub key={key} className="text-[0.75em]">{acc}</sub>;
      case "link": {
        const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
        if (!href) return acc;
        const isExternal = href.startsWith("https://") || href.startsWith("http://");
        return (
          <a
            key={key}
            href={href}
            target={isExternal ? "_blank" : undefined}
            rel={isExternal ? "noopener noreferrer" : undefined}
            className="text-primary underline underline-offset-2 hover:text-primary/80"
          >
            {acc}
          </a>
        );
      }
      default:
        return acc;
    }
  }, content);
}

function renderNodes(
  nodes: RichTextNode[] | undefined,
  keyPrefix: string,
  inline: boolean,
  enableMathInText: boolean,
): React.ReactNode {
  if (!nodes || nodes.length === 0) return null;

  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case "text": {
        const rawText = node.text ?? "";
        const isCodeMarked = node.marks?.some((m) => m.type === "code") ?? false;
        if (
          enableMathInText &&
          !isCodeMarked &&
          (rawText.includes("$") || rawText.includes("\\(") || rawText.includes("\\["))
        ) {
          const tokens = tokenizePlainTextWithMath(rawText);
          if (tokens.some((t) => t.type !== "text")) {
            return (
              <React.Fragment key={key}>
                {tokens.map((tok, tokIdx) => {
                  const tokKey = `${key}-t-${tokIdx}`;
                  if (tok.type === "blockMath") {
                    return <SafeMathFragment key={tokKey} latex={tok.value} displayMode={true} />;
                  }
                  if (tok.type === "inlineMath") {
                    return <SafeMathFragment key={tokKey} latex={tok.value} displayMode={false} />;
                  }
                  return (
                    <React.Fragment key={tokKey}>
                      {wrapTextWithMarks(tok.value, node.marks, tokKey)}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            );
          }
        }
        return (
          <React.Fragment key={key}>
            {wrapTextWithMarks(rawText, node.marks, key)}
          </React.Fragment>
        );
      }
      case "hardBreak":
        return <br key={key} />;
      case "inlineMath": {
        const latex = typeof node.attrs?.latex === "string" ? node.attrs.latex : "";
        return <SafeMathFragment key={key} latex={latex} displayMode={false} />;
      }
      case "blockMath": {
        const latex = typeof node.attrs?.latex === "string" ? node.attrs.latex : "";
        return <SafeMathFragment key={key} latex={latex} displayMode={true} />;
      }
      case "paragraph": {
        const children = renderNodes(node.content, key, inline, enableMathInText);
        if (inline) {
          return (
            <span key={key} className="block [&:not(:last-child)]:mb-1">
              {children ?? "\u00A0"}
            </span>
          );
        }
        return (
          <p key={key} className="leading-relaxed [&:not(:last-child)]:mb-2">
            {children ?? "\u00A0"}
          </p>
        );
      }
      case "heading": {
        const rawLevel = typeof node.attrs?.level === "number" ? node.attrs.level : 3;
        const level = Math.min(4, Math.max(1, rawLevel));
        const children = renderNodes(node.content, key, inline, enableMathInText);
        if (level === 1) {
          return (
            <h2 key={key} className="mb-2 text-lg font-semibold tracking-tight text-foreground">
              {children}
            </h2>
          );
        }
        if (level === 2) {
          return (
            <h3 key={key} className="mb-1.5 text-base font-semibold tracking-tight text-foreground">
              {children}
            </h3>
          );
        }
        return (
          <h4 key={key} className="mb-1 text-sm font-semibold text-foreground">
            {children}
          </h4>
        );
      }
      case "bulletList":
        return (
          <ul key={key} className="my-2 list-disc space-y-1 pl-5">
            {renderNodes(node.content, key, false, enableMathInText)}
          </ul>
        );
      case "orderedList": {
        const start = typeof node.attrs?.start === "number" ? node.attrs.start : undefined;
        return (
          <ol key={key} start={start} className="my-2 list-decimal space-y-1 pl-5">
            {renderNodes(node.content, key, false, enableMathInText)}
          </ol>
        );
      }
      case "listItem":
        return (
          <li key={key} className="leading-relaxed">
            {renderNodes(node.content, key, true, enableMathInText)}
          </li>
        );
      case "blockquote":
        return (
          <blockquote
            key={key}
            className="my-2 border-l-2 border-primary/50 bg-muted/40 py-1.5 pl-3 pr-2 text-muted-foreground italic"
          >
            {renderNodes(node.content, key, false, enableMathInText)}
          </blockquote>
        );
      case "codeBlock": {
        const textContent = (node.content ?? []).map((n) => n.text ?? "").join("");
        return (
          <pre
            key={key}
            className="my-2 overflow-x-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-xs leading-relaxed text-foreground"
          >
            <code>{textContent}</code>
          </pre>
        );
      }
      case "table": {
        const rows = node.content ?? [];
        return (
          <div key={key} className="my-2.5 overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-left text-sm">
              <tbody>{renderNodes(rows, key, false, enableMathInText)}</tbody>
            </table>
          </div>
        );
      }
      case "tableRow":
        return (
          <tr key={key} className="border-b border-border last:border-b-0">
            {renderNodes(node.content, key, false, enableMathInText)}
          </tr>
        );
      case "tableHeader": {
        const colSpan = typeof node.attrs?.colspan === "number" ? node.attrs.colspan : undefined;
        const rowSpan = typeof node.attrs?.rowspan === "number" ? node.attrs.rowspan : undefined;
        return (
          <th
            key={key}
            colSpan={colSpan}
            rowSpan={rowSpan}
            className="border-r border-border bg-muted/60 px-3 py-2 font-semibold text-foreground last:border-r-0"
          >
            {renderNodes(node.content, key, true, enableMathInText)}
          </th>
        );
      }
      case "tableCell": {
        const colSpan = typeof node.attrs?.colspan === "number" ? node.attrs.colspan : undefined;
        const rowSpan = typeof node.attrs?.rowspan === "number" ? node.attrs.rowspan : undefined;
        return (
          <td
            key={key}
            colSpan={colSpan}
            rowSpan={rowSpan}
            className="border-r border-border px-3 py-2 align-top text-foreground last:border-r-0"
          >
            {renderNodes(node.content, key, true, enableMathInText)}
          </td>
        );
      }
      case "image": {
        const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
        if (!src) return null;
        const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
        const title = typeof node.attrs?.title === "string" ? node.attrs.title : undefined;
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={key}
            src={src}
            alt={alt}
            title={title}
            loading="lazy"
            className="my-2 max-h-80 max-w-full rounded-lg border border-border object-contain"
          />
        );
      }
      default:
        return null;
    }
  });
}

function renderPlainTextFallback(
  text: string,
  enableMathInPlainText: boolean,
  inline: boolean,
): React.ReactNode {
  if (!enableMathInPlainText) {
    return <span className="whitespace-pre-wrap">{text}</span>;
  }

  const tokens = tokenizePlainTextWithMath(text);
  if (tokens.length === 0) return null;

  return tokens.map((token, idx) => {
    if (token.type === "blockMath") {
      return <SafeMathFragment key={`pm-${idx}`} latex={token.value} displayMode={true} />;
    }
    if (token.type === "inlineMath") {
      return <SafeMathFragment key={`pm-${idx}`} latex={token.value} displayMode={false} />;
    }
    return (
      <span
        key={`pm-${idx}`}
        className={inline ? "whitespace-pre-wrap" : "whitespace-pre-wrap leading-relaxed"}
      >
        {token.value}
      </span>
    );
  });
}

/**
 * Single canonical rich-content renderer for StudyHub V3.0.
 * Safely renders canonical TipTap AST v1 (`richDoc`) or backward-compatible `plainText`
 * with strict XSS protection and safe KaTeX math (`trust: false`).
 */
export function RichContentRenderer({
  richDoc,
  plainText,
  className,
  inline = false,
  enableMathInPlainText = true,
  allowDataImagePreview = false,
}: RichContentRendererProps): React.ReactElement | null {
  const sanitizedDoc = React.useMemo(
    () =>
      richDoc
        ? sanitizeRichTextDoc(richDoc, { allowDataImagePreview })
        : null,
    [richDoc, allowDataImagePreview],
  );

  if (sanitizedDoc && sanitizedDoc.content.length > 0) {
    const Wrapper = inline ? "div" : "div";
    return (
      <Wrapper
        className={cn(
          "break-words text-foreground",
          inline ? "text-sm leading-snug" : "text-sm sm:text-[15px]",
          className,
        )}
        data-rich-renderer="ast-v1"
      >
        {renderNodes(sanitizedDoc.content, "rt", inline, enableMathInPlainText)}
      </Wrapper>
    );
  }

  const fallback = plainText ?? "";
  if (!fallback) return null;

  return (
    <div
      className={cn(
        "break-words text-foreground",
        inline ? "text-sm leading-snug" : "text-sm sm:text-[15px]",
        className,
      )}
      data-rich-renderer="plain-fallback"
    >
      {renderPlainTextFallback(fallback, enableMathInPlainText, inline)}
    </div>
  );
}
