"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, getFriendlyErrorMessage } from "@/components/layout/api-client";
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
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Folder } from "@/types/domain";

const FOLDER_COLORS = [
  { id: "indigo", className: "bg-indigo-600" },
  { id: "blue", className: "bg-blue-600" },
  { id: "green", className: "bg-green-600" },
  { id: "amber", className: "bg-amber-500" },
  { id: "red", className: "bg-red-600" },
  { id: "slate", className: "bg-slate-600" },
  { id: "purple", className: "bg-purple-600" },
  { id: "teal", className: "bg-teal-600" },
] as const;

export function getFolderDotClass(color: string | null | undefined): string {
  return (
    FOLDER_COLORS.find((c) => c.id === color)?.className ?? "bg-indigo-600"
  );
}

interface FolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder?: Folder | null;
  parentId?: string | null;
  onSaved?: (folder: Folder) => void;
}

function FolderDialogForm({
  onOpenChange,
  folder,
  parentId = null,
  onSaved,
}: Omit<FolderDialogProps, "open">) {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const queryClient = useQueryClient();

  const [name, setName] = React.useState(folder?.name ?? "");
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [description, setDescription] = React.useState(folder?.description ?? "");
  const [color, setColor] = React.useState(folder?.color ?? "indigo");
  const nameInputRef = React.useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        color,
        parent_id: folder ? folder.parent_id : parentId,
      };
      const url = folder ? `/api/folders/${folder.id}` : "/api/folders";
      const method = folder ? "PATCH" : "POST";
      const res = await apiFetch<Folder>(url, {
        method,
        body: JSON.stringify(payload),
      });
      return res.data;
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      if (folder) {
        queryClient.invalidateQueries({ queryKey: ["folder", folder.id] });
      }
      toast.success(
        folder
          ? vi
            ? "Đã cập nhật thư mục."
            : "Folder updated."
          : vi
            ? "Đã tạo thư mục mới."
            : "Folder created.",
      );
      onSaved?.(saved);
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      setNameError(
        vi ? "Vui lòng nhập tên thư mục." : "Please enter a folder name.",
      );
      nameInputRef.current?.focus();
      return;
    }
    setNameError(null);
    mutation.mutate();
  };

  return (
    <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {folder
              ? vi
                ? "Chỉnh sửa thư mục"
                : "Edit folder"
              : t("library.newFolder")}
          </DialogTitle>
          <DialogDescription>
            {vi
              ? "Nhóm các học phần theo môn học, học kỳ hoặc mục tiêu thi."
              : "Organize study sets by course, semester, or exam target."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="folder-name">
              {vi ? "Tên thư mục" : "Folder name"}
            </Label>
            <Input
              ref={nameInputRef}
              id="folder-name"
              required
              maxLength={120}
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? "folder-name-error" : undefined}
              placeholder={vi ? "VD: Giải tích 1, IELTS Reading..." : "e.g., Biology 101, Midterm Prep"}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError && e.target.value.trim()) {
                  setNameError(null);
                }
              }}
            />
            {nameError && (
              <p
                id="folder-name-error"
                role="alert"
                className="text-destructive text-xs font-medium"
              >
                {nameError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="folder-description">
              {vi ? "Mô tả (tùy chọn)" : "Description (optional)"}
            </Label>
            <Textarea
              id="folder-description"
              rows={2}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{vi ? "Màu nhận diện" : "Accent color"}</Label>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={vi ? "Chọn màu thư mục" : "Folder color"}>
              {FOLDER_COLORS.map((swatch) => (
                <button
                  key={swatch.id}
                  type="button"
                  role="radio"
                  aria-checked={color === swatch.id}
                  aria-label={swatch.id}
                  onClick={() => setColor(swatch.id)}
                  className="focus-visible:ring-ring inline-flex size-10 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none sm:size-9"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-6 rounded-full transition-transform",
                      swatch.className,
                      color === swatch.id && "ring-ring scale-110 ring-2 ring-offset-2",
                    )}
                  />
                </button>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              <span>{folder ? t("common.save") : t("common.create")}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
  );
}

export function FolderDialog({
  open,
  onOpenChange,
  folder,
  parentId = null,
  onSaved,
}: FolderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <FolderDialogForm
          key={folder?.id ?? "new-folder"}
          onOpenChange={onOpenChange}
          folder={folder}
          parentId={parentId}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  );
}
