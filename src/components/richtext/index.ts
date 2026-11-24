export {
  RichContentRenderer,
  type RichContentRendererProps,
} from "./RichContentRenderer";

// Keep `RichTextEditor` out of this barrel so read-only routes (Live Exam Runner,
// Flashcards, Study Set Hub) importing `RichContentRenderer` from `@/components/richtext`
// NEVER pull the ~466 KB TipTap WYSIWYG bundle (V3-PERF-02).
// Always lazy-load the editor directly via:
//   `dynamic(() => import("@/components/richtext/RichTextEditor").then((m) => m.RichTextEditor), { ssr: false })`
export type { RichTextEditorProps } from "./RichTextEditor";
