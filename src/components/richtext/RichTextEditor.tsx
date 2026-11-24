"use client";

import * as React from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Underline } from "@tiptap/extension-underline";
import { Superscript } from "@tiptap/extension-superscript";
import { Subscript } from "@tiptap/extension-subscript";
import { Link } from "@tiptap/extension-link";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import "katex/dist/katex.min.css";
import {
  Bold,
  Code,
  Code2,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Sigma,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table as TableIcon,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ACADEMIC_SYMBOL_PALETTE,
  isSafeRichUrl,
  plainTextToRichTextDoc,
  renderSafeKatexHtml,
  richTextToPlainText,
  sanitizeRichTextDoc,
} from "@/lib/richtext";
import { cn } from "@/lib/utils";
import type { Locale } from "@/types/domain";
import type { RichTextDoc } from "@/types/v3";

export interface RichTextEditorProps {
  value?: RichTextDoc | null;
  fallbackPlainText?: string;
  onChange: (doc: RichTextDoc, plainText: string) => void;
  placeholder?: string;
  locale?: Locale;
  compact?: boolean;
  disabled?: boolean;
  minHeightClass?: string;
  className?: string;
  "aria-label"?: string;
}

function MathNodeView({ node, selected, extension }: NodeViewProps): React.ReactElement {
  const latex = typeof node.attrs.latex === "string" ? node.attrs.latex : "";
  const isBlock = extension.name === "blockMath";
  const rendered = renderSafeKatexHtml(latex, isBlock);

  if (isBlock) {
    return (
      <NodeViewWrapper
        as="div"
        className={cn(
          "my-2 flex cursor-pointer items-center justify-center rounded-md border border-border/70 bg-muted/30 px-3 py-2",
          selected && "ring-2 ring-primary",
        )}
        contentEditable={false}
        title={latex}
      >
        {rendered.html ? (
          <span dangerouslySetInnerHTML={{ __html: rendered.html }} />
        ) : (
          <code className="font-mono text-xs text-muted-foreground">{latex || "$$...$$"}</code>
        )}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      className={cn(
        "mx-0.5 inline-flex cursor-pointer items-center rounded bg-muted/50 px-1 py-0.5 align-baseline",
        selected && "ring-2 ring-primary",
      )}
      contentEditable={false}
      title={latex}
    >
      {rendered.html ? (
        <span dangerouslySetInnerHTML={{ __html: rendered.html }} />
      ) : (
        <code className="font-mono text-xs text-muted-foreground">{latex || "$...$"}</code>
      )}
    </NodeViewWrapper>
  );
}

const InlineMathNode = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      latex: {
        default: "",
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="inline-math"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-type": "inline-math" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView);
  },
});

const BlockMathNode = Node.create({
  name: "blockMath",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      latex: {
        default: "",
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="block-math"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "block-math" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView);
  },
});

function ToolbarButton({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({
  value,
  fallbackPlainText = "",
  onChange,
  placeholder,
  locale = "vi",
  compact = false,
  disabled = false,
  minHeightClass,
  className,
  "aria-label": ariaLabel,
}: RichTextEditorProps): React.ReactElement {
  const isVi = locale === "vi";
  const initialDoc = React.useMemo<RichTextDoc>(() => {
    const sanitized = value ? sanitizeRichTextDoc(value, { allowEmptyDoc: true }) : null;
    if (sanitized && sanitized.content.length > 0) return sanitized;
    return plainTextToRichTextDoc(fallbackPlainText);
  }, [value, fallbackPlainText]);

  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const lastSerializedRef = React.useRef<string>(JSON.stringify(initialDoc));

  const [mathDialogOpen, setMathDialogOpen] = React.useState(false);
  const [mathMode, setMathMode] = React.useState<"inline" | "block">("inline");
  const [mathLatex, setMathLatex] = React.useState("");

  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false);
  const [linkUrl, setLinkUrl] = React.useState("");
  const [linkError, setLinkError] = React.useState<string | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        link: false,
        underline: false,
        horizontalRule: false,
        heading: { levels: [2, 3, 4] },
      }),
      Underline,
      Superscript,
      Subscript,
      Link.configure({
        openOnClick: false,
        autolink: true,
        validate: (url) => isSafeRichUrl(url),
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
          class: "text-primary underline underline-offset-2",
        },
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      InlineMathNode,
      BlockMathNode,
    ],
    content: initialDoc,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel ?? (isVi ? "Trình soạn thảo nội dung" : "Rich text editor"),
        class: cn(
          "prose-sm max-w-none px-3 py-2.5 text-sm text-foreground focus:outline-none",
          "[&_p]:my-1 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/50 [&_blockquote]:pl-3 [&_blockquote]:italic",
          "[&_pre]:my-2 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2.5 [&_pre]:font-mono [&_pre]:text-xs",
          "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:bg-muted/60 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
          minHeightClass ?? (compact ? "min-h-[76px]" : "min-h-[120px]"),
        ),
      },
      handleKeyDown: (_view, event) => {
        // IME-safe guard for Vietnamese Telex/VNI/CJK composition
        if (event.isComposing || event.keyCode === 229) {
          return false;
        }
        return false;
      },
    },
    onUpdate: ({ editor: instance }) => {
      const rawJson = instance.getJSON();
      const sanitized = sanitizeRichTextDoc(rawJson, { allowEmptyDoc: true }) ?? {
        version: 1 as const,
        type: "doc" as const,
        content: [{ type: "paragraph" as const }],
      };
      const serialized = JSON.stringify(sanitized);
      if (serialized === lastSerializedRef.current) return;
      lastSerializedRef.current = serialized;
      const plain = richTextToPlainText(sanitized);
      onChangeRef.current(sanitized, plain);
    },
  });

  // Sync external editable state cleanly
  React.useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  // Sync external value changes only if actually different from current doc
  React.useEffect(() => {
    if (!editor) return;
    const serialized = JSON.stringify(initialDoc);
    if (serialized === lastSerializedRef.current) return;
    lastSerializedRef.current = serialized;
    editor.commands.setContent(initialDoc, { emitUpdate: false });
  }, [editor, initialDoc]);

  const mathPreview = React.useMemo(
    () => (mathLatex.trim() ? renderSafeKatexHtml(mathLatex, mathMode === "block") : null),
    [mathLatex, mathMode],
  );

  const openMathModal = (mode: "inline" | "block"): void => {
    setMathMode(mode);
    setMathLatex("");
    setMathDialogOpen(true);
  };

  const handleInsertMath = (): void => {
    if (!editor || !mathLatex.trim()) return;
    const nodeType = mathMode === "block" ? "blockMath" : "inlineMath";
    editor
      .chain()
      .focus()
      .insertContent({
        type: nodeType,
        attrs: { latex: mathLatex.trim() },
      })
      .run();
    setMathDialogOpen(false);
    setMathLatex("");
  };

  const openLinkModal = (): void => {
    if (!editor) return;
    const existingHref = editor.getAttributes("link").href;
    setLinkUrl(typeof existingHref === "string" ? existingHref : "https://");
    setLinkError(null);
    setLinkDialogOpen(true);
  };

  const handleSaveLink = (): void => {
    if (!editor) return;
    const trimmed = linkUrl.trim();
    if (!trimmed) {
      editor.chain().focus().unsetLink().run();
      setLinkDialogOpen(false);
      return;
    }
    if (!isSafeRichUrl(trimmed)) {
      setLinkError(
        isVi
          ? "URL không hợp lệ. Chỉ chấp nhận https://, đường dẫn nội bộ /..., hoặc mailto:."
          : "Invalid URL. Only https://, internal /... paths, or mailto: links are allowed.",
      );
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: trimmed })
      .run();
    setLinkDialogOpen(false);
  };

  const isEmpty = !editor || editor.isEmpty;

  return (
    <div
      className={cn(
        "rounded-lg border border-input bg-background transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      {/* Toolbar */}
      <div
        role="toolbar"
        aria-label={isVi ? "Thanh công cụ định dạng" : "Formatting toolbar"}
        className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/30 px-1.5 py-1"
      >
        <ToolbarButton
          title={isVi ? "In đậm" : "Bold"}
          active={editor?.isActive("bold")}
          disabled={!editor || disabled}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title={isVi ? "In nghiêng" : "Italic"}
          active={editor?.isActive("italic")}
          disabled={!editor || disabled}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title={isVi ? "Gạch chân" : "Underline"}
          active={editor?.isActive("underline")}
          disabled={!editor || disabled}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title={isVi ? "Gạch ngang" : "Strikethrough"}
          active={editor?.isActive("strike")}
          disabled={!editor || disabled}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title={isVi ? "Chỉ số trên (x²)" : "Superscript"}
          active={editor?.isActive("superscript")}
          disabled={!editor || disabled}
          onClick={() => editor?.chain().focus().toggleSuperscript().run()}
        >
          <SuperscriptIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title={isVi ? "Chỉ số dưới (H₂O)" : "Subscript"}
          active={editor?.isActive("subscript")}
          disabled={!editor || disabled}
          onClick={() => editor?.chain().focus().toggleSubscript().run()}
        >
          <SubscriptIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title={isVi ? "Mã nội tuyến" : "Inline code"}
          active={editor?.isActive("code")}
          disabled={!editor || disabled}
          onClick={() => editor?.chain().focus().toggleCode().run()}
        >
          <Code className="h-3.5 w-3.5" />
        </ToolbarButton>

        <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

        {!compact && (
          <>
            <ToolbarButton
              title={isVi ? "Tiêu đề 2" : "Heading 2"}
              active={editor?.isActive("heading", { level: 2 })}
              disabled={!editor || disabled}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            >
              <Heading2 className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
              title={isVi ? "Tiêu đề 3" : "Heading 3"}
              active={editor?.isActive("heading", { level: 3 })}
              disabled={!editor || disabled}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
            >
              <Heading3 className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
              title={isVi ? "Danh sách dấu chấm" : "Bullet list"}
              active={editor?.isActive("bulletList")}
              disabled={!editor || disabled}
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
            >
              <List className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
              title={isVi ? "Danh sách đánh số" : "Numbered list"}
              active={editor?.isActive("orderedList")}
              disabled={!editor || disabled}
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            >
              <ListOrdered className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
              title={isVi ? "Trích dẫn" : "Blockquote"}
              active={editor?.isActive("blockquote")}
              disabled={!editor || disabled}
              onClick={() => editor?.chain().focus().toggleBlockquote().run()}
            >
              <Quote className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
              title={isVi ? "Khối mã" : "Code block"}
              active={editor?.isActive("codeBlock")}
              disabled={!editor || disabled}
              onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
            >
              <Code2 className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
              title={isVi ? "Chèn bảng 3x3" : "Insert 3x3 table"}
              active={editor?.isActive("table")}
              disabled={!editor || disabled}
              onClick={() =>
                editor
                  ?.chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                  .run()
              }
            >
              <TableIcon className="h-3.5 w-3.5" />
            </ToolbarButton>
            {editor?.isActive("table") && (
              <ToolbarButton
                title={isVi ? "Xóa bảng" : "Delete table"}
                disabled={disabled}
                onClick={() => editor.chain().focus().deleteTable().run()}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </ToolbarButton>
            )}
            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          </>
        )}

        <ToolbarButton
          title={isVi ? "Chèn liên kết" : "Insert link"}
          active={editor?.isActive("link")}
          disabled={!editor || disabled}
          onClick={openLinkModal}
        >
          <Link2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        {editor?.isActive("link") && (
          <ToolbarButton
            title={isVi ? "Gỡ liên kết" : "Remove link"}
            disabled={disabled}
            onClick={() => editor.chain().focus().unsetLink().run()}
          >
            <Unlink className="h-3.5 w-3.5" />
          </ToolbarButton>
        )}

        <ToolbarButton
          title={isVi ? "Chèn công thức toán (nội tuyến)" : "Insert inline math formula"}
          disabled={!editor || disabled}
          onClick={() => openMathModal("inline")}
        >
          <Sigma className="h-3.5 w-3.5" />
        </ToolbarButton>
        {!compact && (
          <ToolbarButton
            title={isVi ? "Chèn khối công thức ($$...$$)" : "Insert block math formula"}
            disabled={!editor || disabled}
            onClick={() => openMathModal("block")}
          >
            <span className="font-mono text-[11px] font-semibold">f(x)</span>
          </ToolbarButton>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          <ToolbarButton
            title={isVi ? "Hoàn tác" : "Undo"}
            disabled={!editor?.can().undo() || disabled}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            title={isVi ? "Làm lại" : "Redo"}
            disabled={!editor?.can().redo() || disabled}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 className="h-3.5 w-3.5" />
          </ToolbarButton>
        </div>
      </div>

      {/* Editor Surface */}
      <div className="relative">
        {placeholder && isEmpty && (
          <div className="pointer-events-none absolute top-2.5 left-3 text-sm text-muted-foreground">
            {placeholder}
          </div>
        )}
        <EditorContent editor={editor} />
      </div>

      {/* Safe Formula Modal */}
      <Dialog open={mathDialogOpen} onOpenChange={setMathDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {mathMode === "block"
                ? isVi
                  ? "Chèn khối công thức LaTeX"
                  : "Insert Block LaTeX Formula"
                : isVi
                  ? "Chèn công thức toán nội tuyến"
                  : "Insert Inline Math Formula"}
            </DialogTitle>
            <DialogDescription>
              {isVi
                ? "Nhập cú pháp LaTeX hoặc chọn ký hiệu học thuật bên dưới. Hiển thị an toàn bằng KaTeX."
                : "Enter LaTeX syntax or pick from the academic symbol palette below. Rendered safely via KaTeX."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={mathMode === "inline" ? "default" : "outline"}
                onClick={() => setMathMode("inline")}
              >
                {isVi ? "Nội tuyến ($...$)" : "Inline ($...$)"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mathMode === "block" ? "default" : "outline"}
                onClick={() => setMathMode("block")}
              >
                {isVi ? "Khối độc lập ($$...$$)" : "Display block ($$...$$)"}
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="richtext-math-input">LaTeX</Label>
              <Textarea
                id="richtext-math-input"
                rows={3}
                value={mathLatex}
                onChange={(e) => setMathLatex(e.target.value)}
                placeholder={isVi ? "Ví dụ: \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}" : "e.g. \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}"}
                className="font-mono text-xs"
              />
            </div>

            {/* Academic Symbol Palette */}
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-2.5">
              {ACADEMIC_SYMBOL_PALETTE.map((group) => (
                <div key={group.id} className="space-y-1">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    {isVi ? group.labelVi : group.labelEn}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {group.items.map((item) => (
                      <button
                        key={item.latex}
                        type="button"
                        title={`${item.description} (${item.latex})`}
                        onClick={() =>
                          setMathLatex((prev) =>
                            prev ? `${prev} ${item.latex}` : item.latex,
                          )
                        }
                        className="rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Live KaTeX Preview */}
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                {isVi ? "Xem trước" : "Preview"}
              </div>
              {mathPreview?.html ? (
                <div
                  className={cn(
                    "overflow-x-auto py-1",
                    mathMode === "block" && "text-center",
                  )}
                  dangerouslySetInnerHTML={{ __html: mathPreview.html }}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {isVi ? "Nhập công thức để xem trước..." : "Type a formula to preview..."}
                </p>
              )}
              {mathPreview && !mathPreview.valid && mathPreview.error && (
                <p className="mt-1 text-xs text-destructive">{mathPreview.error}</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setMathDialogOpen(false)}
            >
              {isVi ? "Hủy" : "Cancel"}
            </Button>
            <Button
              type="button"
              disabled={!mathLatex.trim()}
              onClick={handleInsertMath}
            >
              {isVi ? "Chèn công thức" : "Insert Formula"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Safe Link Modal */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isVi ? "Chèn liên kết" : "Insert Link"}</DialogTitle>
            <DialogDescription>
              {isVi
                ? "Chỉ hỗ trợ đường dẫn an toàn (https://, đường dẫn nội bộ /..., hoặc mailto:)."
                : "Only safe URLs (https://, internal /... paths, or mailto:) are permitted."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="richtext-link-url">URL</Label>
            <Input
              id="richtext-link-url"
              type="url"
              value={linkUrl}
              onChange={(e) => {
                setLinkUrl(e.target.value);
                setLinkError(null);
              }}
              placeholder="https://example.org/reference"
            />
            {linkError && <p className="text-xs text-destructive">{linkError}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLinkDialogOpen(false)}
            >
              {isVi ? "Hủy" : "Cancel"}
            </Button>
            <Button type="button" onClick={handleSaveLink}>
              {isVi ? "Lưu liên kết" : "Save Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
