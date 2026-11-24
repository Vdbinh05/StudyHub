import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import {
  isSafeRichImageUrl,
  isSafeRichUrl,
  plainTextToRichTextDoc,
  renderSafeKatexHtml,
  richTextToPlainText,
  sanitizeRichTextDoc,
  tokenizePlainTextWithMath,
} from "@/lib/richtext";
import { RichContentRenderer } from "@/components/richtext/RichContentRenderer";

describe("V3 Canonical Rich Text AST v1, Safe KaTeX & Renderer", () => {
  it("sanitizes AST strictly: strips script/iframe nodes, event attrs, javascript:/data: links, and SVG images", () => {
    const malicious = {
      version: 1,
      type: "doc",
      content: [
        { type: "script", content: [{ type: "text", text: "alert(1)" }] },
        { type: "iframe", attrs: { src: "https://evil.example" } },
        {
          type: "paragraph",
          attrs: { onclick: "alert(1)", style: "color:red" },
          content: [
            {
              type: "text",
              text: "Click me",
              marks: [
                { type: "bold" },
                { type: "link", attrs: { href: "javascript:alert(1)" } },
              ],
            },
            {
              type: "text",
              text: " or safe docs",
              marks: [
                { type: "link", attrs: { href: "https://example.org/docs" } },
              ],
            },
            {
              type: "text",
              text: " bad data",
              marks: [
                { type: "link", attrs: { href: "data:text/html,<script>alert(1)</script>" } },
              ],
            },
          ],
        },
        {
          type: "image",
          attrs: { src: "https://example.org/evil.svg", alt: "svg" },
        },
        {
          type: "image",
          attrs: { src: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", alt: "svg-data" },
        },
        {
          type: "image",
          attrs: { src: "/api/uploads/signed-url?path=u/s/a.png&redirect=1", alt: "Diagram A" },
        },
      ],
    };

    const sanitized = sanitizeRichTextDoc(malicious);
    expect(sanitized).not.toBeNull();
    expect(sanitized?.version).toBe(1);
    // Only paragraph + safe raster signed-url image survive
    expect(sanitized?.content).toHaveLength(2);
    expect(sanitized?.content[0]?.type).toBe("paragraph");
    expect(sanitized?.content[0]?.attrs).toBeUndefined();

    const paraChildren = sanitized?.content[0]?.content ?? [];
    // javascript: link mark stripped while preserving bold mark & text
    expect(paraChildren[0]?.marks).toEqual([{ type: "bold" }]);
    // Safe https link preserved with strict noopener noreferrer
    expect(paraChildren[1]?.marks).toEqual([
      {
        type: "link",
        attrs: {
          href: "https://example.org/docs",
          target: "_blank",
          rel: "noopener noreferrer",
        },
      },
    ]);
    // data:text/html link mark stripped
    expect(paraChildren[2]?.marks).toBeUndefined();

    // Only safe raster image kept
    expect(sanitized?.content[1]).toEqual({
      type: "image",
      attrs: {
        src: "/api/uploads/signed-url?path=u/s/a.png&redirect=1",
        alt: "Diagram A",
        title: null,
        mediaId: null,
      },
    });
  });

  it("blocks unsafe URL schemes and allows safe internal/https/mailto links", () => {
    expect(isSafeRichUrl("https://studyhub.edu.vn/guide")).toBe(true);
    expect(isSafeRichUrl("/api/uploads/signed-url?path=a/b.png")).toBe(true);
    expect(isSafeRichUrl("mailto:student@example.edu")).toBe(true);
    expect(isSafeRichUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeRichUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeRichUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(isSafeRichUrl("//evil.example/phish")).toBe(false);

    expect(isSafeRichImageUrl("https://cdn.example.org/photo.png")).toBe(true);
    expect(isSafeRichImageUrl("https://cdn.example.org/icon.svg")).toBe(false);
    expect(isSafeRichImageUrl("data:image/png;base64,iVBORw0KGgo=", false)).toBe(false);
    expect(isSafeRichImageUrl("data:image/png;base64,iVBORw0KGgo=", true)).toBe(true);
    expect(isSafeRichImageUrl("data:image/svg+xml;base64,PHN2Zz4=", true)).toBe(false);
  });

  it("renders KaTeX safely with trust:false neutralizing \\href javascript payloads and handling invalid syntax", () => {
    const valid = renderSafeKatexHtml("\\frac{1}{2}mv^2", false);
    expect(valid.valid).toBe(true);
    expect(valid.html).toContain("katex");

    // KaTeX trust:false blocks \href{javascript:...}
    const dangerous = renderSafeKatexHtml("\\href{javascript:alert(1)}{click}", false);
    expect(dangerous.html.toLowerCase()).not.toContain("javascript:");
    expect(dangerous.html.toLowerCase()).not.toContain("<a ");

    // Broken syntax degrades gracefully without throwing
    const malformed = renderSafeKatexHtml("\\frac{1}{", false);
    expect(malformed.valid).toBe(false);
    expect(malformed.html.length).toBeGreaterThan(0);
  });

  it("tokenizes inline/block math accurately while preserving currency amounts like $5 and $10", () => {
    const mathTokens = tokenizePlainTextWithMath("Energy is $E = mc^2$ and $$F = ma$$.");
    expect(mathTokens).toEqual([
      { type: "text", value: "Energy is " },
      { type: "inlineMath", value: "E = mc^2" },
      { type: "text", value: " and " },
      { type: "blockMath", value: "F = ma" },
      { type: "text", value: "." },
    ]);

    const currencyTokens = tokenizePlainTextWithMath("Tickets cost $5 and $10 respectively.");
    expect(currencyTokens).toEqual([
      { type: "text", value: "Tickets cost $5 and $10 respectively." },
    ]);
  });

  it("projects canonical RichTextDoc to plain text and renders both AST and plain-text fallback cleanly", () => {
    const doc = plainTextToRichTextDoc("Nhiệt độ giảm theo độ cao: $T = T_0 - 6.5h$\n\n$$P = \\rho R T$$");
    expect(doc.version).toBe(1);
    const projected = richTextToPlainText(doc);
    expect(projected).toContain("Nhiệt độ giảm theo độ cao");
    expect(projected).toContain("$T = T_0 - 6.5h$");
    expect(projected).toContain("$$P = \\rho R T$$");

    const astHtml = renderToStaticMarkup(
      React.createElement(RichContentRenderer, { richDoc: doc }),
    );
    expect(astHtml).toContain('data-rich-renderer="ast-v1"');
    expect(astHtml).toContain("katex");

    const fallbackHtml = renderToStaticMarkup(
      React.createElement(RichContentRenderer, {
        richDoc: null,
        plainText: "Áp suất tiêu chuẩn: $1013.25\\text{ hPa}$",
      }),
    );
    expect(fallbackHtml).toContain('data-rich-renderer="plain-fallback"');
    expect(fallbackHtml).toContain("katex");

    // V3-UX-04: Typed `$...$` inside a TipTap RichTextDoc text node also renders cleanly via KaTeX,
    // while inline code (`$HOME$`) and codeBlock (`$E=mc^2$`) remain raw literal code.
    const typedMathInRichDoc = renderToStaticMarkup(
      React.createElement(RichContentRenderer, {
        richDoc: {
          version: 1,
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Giá trị trung bình $x = \\frac{a+b}{2}$ và " },
                { type: "text", text: "$HOME$", marks: [{ type: "code" }] },
              ],
            },
            {
              type: "codeBlock",
              content: [{ type: "text", text: "$RAW_CODE$" }],
            },
          ],
        },
      }),
    );
    expect(typedMathInRichDoc).toContain('data-rich-renderer="ast-v1"');
    expect(typedMathInRichDoc).toContain('data-math-mode="inline"');
    expect(typedMathInRichDoc).toContain("katex");
    expect(typedMathInRichDoc).toContain(">$HOME$</code>");
    expect(typedMathInRichDoc).toContain("<code>$RAW_CODE$</code>");
  });
});
