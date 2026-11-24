"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  CornerDownLeft,
  Folder,
  HelpCircle,
  Image as ImageIcon,
  Library,
  ListChecks,
  Loader2,
  Search,
  StickyNote,
  Tag,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { isActiveExamRoute, isImeComposingEvent } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import {
  apiFetch,
  getFriendlyErrorMessage,
  isSupabaseConfiguredClient,
} from "./api-client";

export type GlobalSearchEntityType =
  | "all"
  | "folder"
  | "study_set"
  | "question"
  | "option"
  | "tag"
  | "chapter"
  | "note"
  | "diagram";

export interface GlobalSearchResultItem {
  id: string;
  entity_type: Exclude<GlobalSearchEntityType, "all">;
  title: string;
  snippet?: string | null;
  subtitle?: string | null;
  study_set_id?: string | null;
  study_set_title?: string | null;
  folder_id?: string | null;
  chapter?: string | null;
  href?: string | null;
}

interface GlobalSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FILTER_TYPES: readonly GlobalSearchEntityType[] = [
  "all",
  "study_set",
  "folder",
  "question",
  "option",
  "chapter",
  "tag",
  "note",
  "diagram",
];

function subscribeOnlineStatus(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

function getOfflineSnapshot(): boolean {
  if (typeof navigator === "undefined") return false;
  return !navigator.onLine;
}

function getEntityMeta(
  entityType: GlobalSearchEntityType,
  vi: boolean,
): {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
} {
  switch (entityType) {
    case "all":
      return { label: vi ? "Tất cả" : "All", icon: Search };
    case "folder":
      return { label: vi ? "Thư mục" : "Folders", icon: Folder };
    case "study_set":
      return { label: vi ? "Học phần" : "Study Sets", icon: Library };
    case "question":
      return { label: vi ? "Câu hỏi" : "Questions", icon: HelpCircle };
    case "option":
      return { label: vi ? "Đáp án" : "Options", icon: ListChecks };
    case "tag":
      return { label: vi ? "Thẻ" : "Tags", icon: Tag };
    case "chapter":
      return { label: vi ? "Chương" : "Chapters", icon: BookOpen };
    case "note":
      return { label: vi ? "Ghi chú riêng" : "Personal Notes", icon: StickyNote };
    case "diagram":
      return { label: vi ? "Sơ đồ" : "Diagrams", icon: ImageIcon };
  }
}

function normalizeEntityType(
  raw: unknown,
): Exclude<GlobalSearchEntityType, "all"> {
  const s = String(raw ?? "").toLowerCase();
  if (s === "folder" || s === "folders") return "folder";
  if (s === "study_set" || s === "set" || s === "sets" || s === "study_sets") {
    return "study_set";
  }
  if (s === "option" || s === "options" || s === "question_option") return "option";
  if (s === "tag" || s === "tags") return "tag";
  if (s === "chapter" || s === "chapters") return "chapter";
  if (s === "note" || s === "notes" || s === "user_question_note") return "note";
  if (
    s === "diagram" ||
    s === "diagrams" ||
    s === "diagram_set" ||
    s === "diagram_hotspot"
  ) {
    return "diagram";
  }
  return "question";
}

function resolveResultHref(item: GlobalSearchResultItem): string {
  if (item.href && item.href.startsWith("/") && !item.href.startsWith("//")) {
    return item.href;
  }
  switch (item.entity_type) {
    case "folder":
      return `/folders/${item.folder_id ?? item.id}`;
    case "study_set":
      return `/sets/${item.study_set_id ?? item.id}`;
    case "diagram":
      return `/diagrams/${item.id}/study`;
    case "chapter":
      if (item.study_set_id) {
        return `/sets/${item.study_set_id}?chapter=${encodeURIComponent(
          item.chapter ?? item.title,
        )}`;
      }
      return "/library";
    case "tag":
      if (item.study_set_id) {
        return `/sets/${item.study_set_id}/edit`;
      }
      return "/library";
    case "question":
    case "option":
    case "note":
      if (item.study_set_id) {
        return `/sets/${item.study_set_id}/edit`;
      }
      return "/library";
  }
}

/**
 * Normalizes either flat `{ items | results }` arrays or grouped bucket payloads
 * returned by `GET /api/search` into a uniform list of `GlobalSearchResultItem`.
 */
export function normalizeSearchPayload(raw: unknown): GlobalSearchResultItem[] {
  if (!raw) return [];

  const coerceRecord = (
    rec: Record<string, unknown>,
    fallbackType?: Exclude<GlobalSearchEntityType, "all">,
  ): GlobalSearchResultItem | null => {
    const id = String(
      rec.id ?? rec.entity_id ?? rec.question_id ?? rec.study_set_id ?? "",
    ).trim();
    const title = String(
      rec.title ??
        rec.name ??
        rec.prompt ??
        rec.label ??
        rec.content ??
        rec.chapter ??
        rec.note_text ??
        "",
    ).trim();
    if (!id && !title) return null;

    const entityType =
      fallbackType ??
      normalizeEntityType(
        rec.result_type ?? rec.entity_type ?? rec.type ?? rec.kind,
      );

    return {
      id: id || `${entityType}-${title.slice(0, 32)}`,
      entity_type: entityType,
      title: title || id,
      snippet:
        typeof rec.snippet === "string"
          ? rec.snippet
          : typeof rec.description === "string"
            ? rec.description
            : typeof rec.note_text === "string" && rec.note_text !== title
              ? rec.note_text
              : null,
      subtitle:
        typeof rec.subtitle === "string"
          ? rec.subtitle
          : typeof rec.study_set_title === "string"
            ? rec.study_set_title
            : null,
      study_set_id:
        typeof rec.study_set_id === "string" ? rec.study_set_id : null,
      study_set_title:
        typeof rec.study_set_title === "string" ? rec.study_set_title : null,
      folder_id: typeof rec.folder_id === "string" ? rec.folder_id : null,
      chapter: typeof rec.chapter === "string" ? rec.chapter : null,
      href: typeof rec.href === "string" ? rec.href : null,
    };
  };

  if (Array.isArray(raw)) {
    return raw
      .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object"))
      .map((x) => coerceRecord(x))
      .filter((x): x is GlobalSearchResultItem => x !== null);
  }

  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const flatList = obj.results ?? obj.items;
    if (Array.isArray(flatList)) {
      return normalizeSearchPayload(flatList);
    }

    const groupedKeys: Array<[string, Exclude<GlobalSearchEntityType, "all">]> = [
      ["folders", "folder"],
      ["studySets", "study_set"],
      ["study_sets", "study_set"],
      ["sets", "study_set"],
      ["questions", "question"],
      ["options", "option"],
      ["chapters", "chapter"],
      ["tags", "tag"],
      ["notes", "note"],
      ["diagrams", "diagram"],
    ];

    const out: GlobalSearchResultItem[] = [];
    for (const [key, fallbackType] of groupedKeys) {
      const bucket = obj[key];
      if (!Array.isArray(bucket)) continue;
      for (const entry of bucket) {
        if (!entry || typeof entry !== "object") continue;
        const item = coerceRecord(entry as Record<string, unknown>, fallbackType);
        if (item) out.push(item);
      }
    }
    return out;
  }

  return [];
}

/**
 * Safe React highlighter — splits text cleanly without dangerouslySetInnerHTML.
 */
function HighlightMatch({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim();
  if (!trimmed) return <>{text}</>;
  const lowerText = text.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index < 0) return <>{text}</>;

  const before = text.slice(0, index);
  const match = text.slice(index, index + trimmed.length);
  const after = text.slice(index + trimmed.length);

  return (
    <>
      {before}
      <mark className="bg-primary-subtle text-primary rounded-xs px-0.5 font-semibold">
        {match}
      </mark>
      {after}
    </>
  );
}

export function GlobalSearchDialog({
  open,
  onOpenChange,
}: GlobalSearchDialogProps) {
  const { locale } = useI18n();
  const vi = locale === "vi";
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const configured = isSupabaseConfiguredClient();

  const examActive = isActiveExamRoute(pathname);
  const isOffline = React.useSyncExternalStore(
    subscribeOnlineStatus,
    getOfflineSnapshot,
    () => false,
  );

  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<GlobalSearchEntityType>("all");
  const [activeIndex, setActiveIndex] = React.useState(0);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const lastCompositionEndRef = React.useRef<number | null>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  // Async debounce callback (no synchronous setState inside effect body)
  React.useEffect(() => {
    const trimmed = query.trim();
    const timer = window.setTimeout(
      () => {
        setDebouncedQuery(trimmed);
        setActiveIndex(0);
      },
      trimmed ? 200 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [query]);

  const searchQuery = useQuery<GlobalSearchResultItem[]>({
    queryKey: ["global-search", debouncedQuery, typeFilter],
    enabled:
      open &&
      !examActive &&
      configured &&
      !isOffline &&
      debouncedQuery.length > 0,
    staleTime: 15_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      params.set("q", debouncedQuery);
      if (typeFilter !== "all") {
        params.set("type", typeFilter);
      }
      params.set("limit", "30");
      const res = await apiFetch<unknown>(`/api/search?${params.toString()}`, {
        signal,
      });
      return normalizeSearchPayload(res.data);
    },
  });

  const results = React.useMemo(
    () => (debouncedQuery ? (searchQuery.data ?? []) : []),
    [debouncedQuery, searchQuery.data],
  );
  const loading = Boolean(debouncedQuery && searchQuery.isFetching);
  const errorMessage =
    debouncedQuery && searchQuery.isError
      ? getFriendlyErrorMessage(searchQuery.error, locale)
      : null;

  const clampedIndex =
    results.length > 0 ? Math.min(activeIndex, results.length - 1) : 0;

  React.useEffect(() => {
    const node = optionRefs.current[clampedIndex];
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [clampedIndex]);

  const handleSelectItem = React.useCallback(
    (item: GlobalSearchResultItem) => {
      const targetHref = resolveResultHref(item);
      onOpenChange(false);
      setQuery("");
      setDebouncedQuery("");
      setActiveIndex(0);
      router.push(targetHref);
    },
    [onOpenChange, router],
  );

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposingEvent(event.nativeEvent, lastCompositionEndRef.current)) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (results.length > 0) {
        setActiveIndex((prev) => (prev + 1) % results.length);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length > 0) {
        setActiveIndex((prev) => (prev - 1 + results.length) % results.length);
      }
      return;
    }
    if (event.key === "Home" && results.length > 0) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End" && results.length > 0) {
      event.preventDefault();
      setActiveIndex(results.length - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = results[clampedIndex];
      if (target) {
        handleSelectItem(target);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
    }
  };

  // HARD EXAM GUARD: never mount dialog during active exam routes
  if (examActive) {
    return null;
  }

  const activeOptionId =
    results.length > 0 && results[clampedIndex]
      ? `global-search-option-${clampedIndex}`
      : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setActiveIndex(0);
        }
      }}
    >
      <DialogContent className="flex max-h-[82dvh] flex-col gap-3 overflow-hidden p-4 sm:max-w-2xl sm:p-5">
        <DialogHeader className="sr-only">
          <DialogTitle>
            {vi ? "Tìm kiếm toàn thư viện" : "Global Library Search"}
          </DialogTitle>
          <DialogDescription>
            {vi
              ? "Tìm nhanh thư mục, học phần, câu hỏi, đáp án, chương, thẻ, ghi chú cá nhân và sơ đồ."
              : "Search across folders, study sets, questions, options, chapters, tags, personal notes, and diagrams."}
          </DialogDescription>
        </DialogHeader>

        {/* Search Input */}
        <div className="relative pr-10">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            ref={inputRef}
            autoFocus
            type="search"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="global-search-listbox"
            aria-activedescendant={activeOptionId}
            aria-label={vi ? "Tìm kiếm toàn thư viện" : "Search your library"}
            placeholder={
              vi
                ? "Tìm học phần, câu hỏi, đáp án, chương, ghi chú riêng, sơ đồ..."
                : "Search sets, questions, options, chapters, notes, diagrams..."
            }
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onCompositionEnd={(e) => {
              lastCompositionEndRef.current = e.nativeEvent.timeStamp;
            }}
            onKeyDown={handleInputKeyDown}
            className="pl-9"
          />
          {loading && (
            <Loader2
              className="text-muted-foreground pointer-events-none absolute top-1/2 right-13 size-4 -translate-y-1/2 animate-spin"
              aria-hidden="true"
            />
          )}
        </div>

        {/* Entity Filter Chips */}
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label={vi ? "Lọc loại nội dung tìm kiếm" : "Filter search entity type"}
        >
          {FILTER_TYPES.map((typeKey) => {
            const meta = getEntityMeta(typeKey, vi);
            const active = typeFilter === typeKey;
            return (
              <button
                key={typeKey}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setTypeFilter(typeKey);
                  setActiveIndex(0);
                  inputRef.current?.focus();
                }}
                className={cn(
                  "min-h-8 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "border-primary bg-primary-subtle text-primary"
                    : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {meta.label}
              </button>
            );
          })}
        </div>

        {/* Results Panel */}
        <div className="border-border min-h-48 flex-1 overflow-y-auto rounded-lg border">
          {isOffline ? (
            <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 px-6 py-12 text-center text-sm">
              <WifiOff className="size-6" aria-hidden="true" />
              <p className="text-foreground font-medium">
                {vi
                  ? "Đang ngoại tuyến — không thể tìm kiếm máy chủ"
                  : "Offline — live library search unavailable"}
              </p>
              <p className="max-w-sm text-xs">
                {vi
                  ? "Kết nối lại mạng để tìm kiếm toàn bộ thư viện hoặc mở các bộ câu hỏi đã tải ngoại tuyến."
                  : "Reconnect to search your full cloud library, or open your downloaded offline study sets."}
              </p>
            </div>
          ) : !debouncedQuery ? (
            <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 px-6 py-12 text-center text-sm">
              <Search className="size-6 opacity-60" aria-hidden="true" />
              <p>
                {vi
                  ? "Nhập từ khóa để tìm trên toàn bộ thư mục, học phần, câu hỏi, ghi chú riêng và sơ đồ của bạn."
                  : "Type keywords to search across your folders, study sets, questions, personal notes, and diagrams."}
              </p>
            </div>
          ) : errorMessage ? (
            <div
              role="alert"
              className="text-destructive flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center text-sm"
            >
              <p className="font-medium">{errorMessage}</p>
            </div>
          ) : !loading && results.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center justify-center gap-1.5 px-6 py-12 text-center text-sm">
              <p className="text-foreground font-medium">
                {vi
                  ? `Không tìm thấy kết quả cho "${debouncedQuery}"`
                  : `No matches found for "${debouncedQuery}"`}
              </p>
              <p className="text-xs">
                {vi
                  ? "Thử đổi từ khóa ngắn hơn hoặc chuyển bộ lọc sang Tất cả."
                  : "Try a shorter keyword or switch the filter back to All."}
              </p>
            </div>
          ) : (
            <div
              id="global-search-listbox"
              role="listbox"
              aria-label={vi ? "Kết quả tìm kiếm" : "Search results"}
              className="divide-border divide-y"
            >
              {results.map((item, idx) => {
                const meta = getEntityMeta(item.entity_type, vi);
                const Icon = meta.icon;
                const isSelected = idx === clampedIndex;
                return (
                  <button
                    key={`${item.entity_type}-${item.id}-${idx}`}
                    ref={(el) => {
                      optionRefs.current[idx] = el;
                    }}
                    id={`global-search-option-${idx}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => handleSelectItem(item)}
                    className={cn(
                      "flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition-colors focus-visible:outline-none",
                      isSelected
                        ? "bg-primary-subtle/70 text-foreground"
                        : "hover:bg-muted/60 text-foreground",
                    )}
                  >
                    <span className="bg-muted text-muted-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md">
                      <Icon className="size-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          <HighlightMatch text={item.title} query={debouncedQuery} />
                        </span>
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {meta.label}
                        </Badge>
                      </span>
                      {item.snippet && (
                        <span className="text-muted-foreground line-clamp-1 block text-xs">
                          <HighlightMatch text={item.snippet} query={debouncedQuery} />
                        </span>
                      )}
                      {item.subtitle && (
                        <span className="text-muted-foreground block truncate text-[11px]">
                          {item.subtitle}
                        </span>
                      )}
                    </span>
                    {isSelected && (
                      <CornerDownLeft
                        className="text-primary mt-1.5 size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Keyboard Footer Hints */}
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <kbd className="border-border bg-muted rounded border px-1 py-0.5 font-mono text-[10px]">
                ↑↓
              </kbd>
              <span>{vi ? "Di chuyển" : "Navigate"}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="border-border bg-muted rounded border px-1 py-0.5 font-mono text-[10px]">
                Enter
              </kbd>
              <span>{vi ? "Mở" : "Open"}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="border-border bg-muted rounded border px-1 py-0.5 font-mono text-[10px]">
                Esc
              </kbd>
              <span>{vi ? "Đóng" : "Close"}</span>
            </span>
          </div>
          {results.length > 0 && (
            <span aria-live="polite">
              {vi ? `${results.length} kết quả` : `${results.length} results`}
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
