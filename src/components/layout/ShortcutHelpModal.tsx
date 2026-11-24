"use client";

import * as React from "react";
import { Keyboard, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import {
  DEFAULT_SHORTCUT_CATALOG,
  type ShortcutBinding,
  type ShortcutCatalogItem,
  type ShortcutScope,
} from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

interface ShortcutHelpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeScopes: readonly ShortcutScope[];
  registeredBindings: readonly ShortcutBinding[];
}

const SCOPE_ORDER: readonly ShortcutScope[] = [
  "global",
  "flashcards",
  "learn",
  "practice",
  "write",
  "spell",
  "diagram",
  "exam",
  "editor",
];

function formatComboKeys(combo: string): string[] {
  return combo
    .split("+")
    .map((part) => {
      const lower = part.trim().toLowerCase();
      if (lower === "mod") return "Ctrl / ⌘";
      if (lower === "escape") return "Esc";
      if (lower === "arrowleft") return "←";
      if (lower === "arrowright") return "→";
      if (lower === "arrowup") return "↑";
      if (lower === "arrowdown") return "↓";
      if (lower === "space") return "Space";
      return part.trim().toUpperCase();
    })
    .filter(Boolean);
}

function getScopeLabel(scope: ShortcutScope, vi: boolean): string {
  switch (scope) {
    case "global":
      return vi ? "Toàn ứng dụng" : "Global";
    case "modal":
      return vi ? "Hộp thoại" : "Dialogs";
    case "flashcards":
      return "Flashcards";
    case "learn":
      return vi ? "Học sâu" : "Learn";
    case "practice":
      return vi ? "Luyện trắc nghiệm" : "Practice";
    case "write":
      return vi ? "Gõ đáp án" : "Write";
    case "spell":
      return vi ? "Nghe & Gõ (Spell)" : "Spell";
    case "diagram":
      return vi ? "Sơ đồ (Diagram)" : "Diagram";
    case "exam":
      return vi ? "Phòng thi thử" : "Exam";
    case "editor":
      return vi ? "Trình soạn thảo" : "Editor";
  }
}

export function ShortcutHelpModal({
  open,
  onOpenChange,
  activeScopes,
  registeredBindings,
}: ShortcutHelpModalProps) {
  const { locale } = useI18n();
  const vi = locale === "vi";

  const primaryActiveScope = React.useMemo<ShortcutScope>(() => {
    const modeScope = activeScopes.find((s) => s !== "global" && s !== "modal");
    return modeScope ?? "global";
  }, [activeScopes]);

  const [selectedScope, setSelectedScope] = React.useState<"active" | ShortcutScope>(
    "active",
  );

  // Merge live registered bindings with static reference catalog (deduplicated by id)
  const mergedByScope = React.useMemo(() => {
    const map = new Map<ShortcutScope, ShortcutCatalogItem[]>();

    const upsert = (item: ShortcutCatalogItem) => {
      const list = map.get(item.scope) ?? [];
      const idx = list.findIndex((existing) => existing.id === item.id);
      if (idx >= 0) {
        list[idx] = item;
      } else {
        list.push(item);
      }
      map.set(item.scope, list);
    };

    for (const item of DEFAULT_SHORTCUT_CATALOG) {
      upsert(item);
    }

    for (const binding of registeredBindings) {
      if (binding.scope === "modal") continue;
      upsert({
        id: binding.id,
        scope: binding.scope,
        combo: binding.combo,
        keysDisplay: binding.keysDisplay ?? formatComboKeys(binding.combo),
        labelVi: binding.labelVi,
        labelEn: binding.labelEn,
      });
    }

    return map;
  }, [registeredBindings]);

  const visibleScopes = React.useMemo<ShortcutScope[]>(() => {
    if (selectedScope === "active") {
      const ordered = new Set<ShortcutScope>([primaryActiveScope, "global"]);
      return Array.from(ordered).filter((s) => (mergedByScope.get(s)?.length ?? 0) > 0);
    }
    return (mergedByScope.get(selectedScope)?.length ?? 0) > 0 ? [selectedScope] : [];
  }, [selectedScope, primaryActiveScope, mergedByScope]);

  const availableFilterScopes = React.useMemo(
    () => SCOPE_ORDER.filter((s) => (mergedByScope.get(s)?.length ?? 0) > 0),
    [mergedByScope],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-4 overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Keyboard className="text-primary size-5 shrink-0" aria-hidden="true" />
            <span>{vi ? "Phím tắt bàn phím" : "Keyboard Shortcuts"}</span>
          </DialogTitle>
          <DialogDescription>
            {vi
              ? "Điều khiển nhanh các chế độ học tập bằng bàn phím. Nhấn ? bất cứ lúc nào để mở bảng này."
              : "Navigate study modes quickly with the keyboard. Press ? anytime outside text fields to open this reference."}
          </DialogDescription>
        </DialogHeader>

        {/* Scope filter pills */}
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label={vi ? "Lọc nhóm phím tắt" : "Filter shortcut scopes"}
        >
          <button
            type="button"
            aria-pressed={selectedScope === "active"}
            onClick={() => setSelectedScope("active")}
            className={cn(
              "min-h-9 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              selectedScope === "active"
                ? "border-primary bg-primary-subtle text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {vi ? "Ngữ cảnh hiện tại" : "Current context"}
          </button>
          {availableFilterScopes.map((scope) => (
            <button
              key={scope}
              type="button"
              aria-pressed={selectedScope === scope}
              onClick={() => setSelectedScope(scope)}
              className={cn(
                "min-h-9 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                selectedScope === scope
                  ? "border-primary bg-primary-subtle text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {getScopeLabel(scope, vi)}
            </button>
          ))}
        </div>

        {/* Shortcut lists */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          {visibleScopes.map((scope) => {
            const items = mergedByScope.get(scope) ?? [];
            const isCurrentMode = scope === primaryActiveScope && scope !== "global";
            return (
              <section key={scope} className="space-y-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-foreground text-sm font-semibold">
                    {getScopeLabel(scope, vi)}
                  </h2>
                  {isCurrentMode && (
                    <Badge variant="secondary" className="text-[11px]">
                      {vi ? "Đang mở" : "Active"}
                    </Badge>
                  )}
                </div>
                <ul className="border-border divide-border divide-y rounded-lg border">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                    >
                      <span className="text-foreground leading-snug">
                        {vi ? item.labelVi : item.labelEn}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {item.keysDisplay.map((cap, idx) => (
                          <React.Fragment key={`${item.id}-${cap}-${idx}`}>
                            {idx > 0 && (
                              <span
                                className="text-muted-foreground text-xs"
                                aria-hidden="true"
                              >
                                +
                              </span>
                            )}
                            <kbd className="border-border bg-muted text-foreground inline-flex min-h-6 min-w-6 items-center justify-center rounded border px-1.5 py-0.5 font-mono text-xs font-medium shadow-2xs">
                              {cap}
                            </kbd>
                          </React.Fragment>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        {/* IME & Exam Safety note */}
        <div className="border-border bg-muted/50 text-muted-foreground flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs">
          <ShieldCheck
            className="text-success mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <p className="leading-relaxed">
            {vi
              ? "Phím tắt học tập tự động tạm dừng khi bạn đang gõ trong ô nhập liệu hoặc đang sử dụng bộ gõ tiếng Việt (IME). Tìm kiếm toàn cục (Ctrl+K) luôn bị tắt trong lúc đang thi thử."
              : "Study shortcuts automatically pause inside text fields and during IME composition. Global search (Ctrl+K) is strictly disabled during live exams."}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
