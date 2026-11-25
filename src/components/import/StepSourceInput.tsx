"use client";

import * as React from "react";
import {
  AlertCircle,
  Braces,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  FileType,
  FileUp,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Locale } from "@/types/domain";

const ACCEPTED_EXTENSIONS = [
  ".docx",
  ".xlsx",
  ".pdf",
  ".csv",
  ".tsv",
  ".txt",
  ".json",
];
const MAX_CLIENT_FILE_BYTES = 15 * 1024 * 1024;

export interface StepSourceInputProps {
  locale: Locale;
  sourceMode: "file" | "paste";
  onSourceModeChange: (mode: "file" | "paste") => void;
  selectedFile: File | null;
  onSelectFile: (file: File | null) => void;
  rawText: string;
  onRawTextChange: (text: string) => void;
  isParsing: boolean;
  errorMessage: string | null;
  onContinue: () => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
}

const TEMPLATE_LINKS: Array<{
  format: string;
  labelVi: string;
  labelEn: string;
  ext: string;
}> = [
  { format: "eduquiz_txt", labelVi: "Mẫu EduQuiz", labelEn: "EduQuiz Template", ext: ".txt" },
  { format: "word_answer_key", labelVi: "Mẫu Đáp án cuối", labelEn: "Answer Key Template", ext: ".txt" },
  { format: "xlsx_wayground", labelVi: "Mẫu Excel Wayground", labelEn: "Wayground Excel", ext: ".xlsx" },
  { format: "quizlet_tsv", labelVi: "Mẫu Quizlet", labelEn: "Quizlet TSV", ext: ".tsv" },
  { format: "csv", labelVi: "Mẫu CSV chuẩn", labelEn: "Standard CSV", ext: ".csv" },
  { format: "json", labelVi: "Mẫu StudyHub JSON", labelEn: "StudyHub JSON", ext: ".json" },
];

export function StepSourceInput({
  locale,
  sourceMode,
  onSourceModeChange,
  selectedFile,
  onSelectFile,
  rawText,
  onRawTextChange,
  isParsing,
  errorMessage,
  onContinue,
  headingRef,
}: StepSourceInputProps) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);

  const validateAndPickFile = (file: File | undefined) => {
    setLocalError(null);
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith(".docm") || lowerName.endsWith(".xlsm")) {
      setLocalError(
        locale === "en"
          ? "Macro-enabled files (.docm, .xlsm) are rejected for security. Save as .docx or .xlsx."
          : "Không hỗ trợ tệp chứa macro (.docm, .xlsm) vì lý do bảo mật. Vui lòng lưu dưới dạng .docx hoặc .xlsx.",
      );
      return;
    }

    const hasValidExt = ACCEPTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
    if (!hasValidExt) {
      setLocalError(
        locale === "en"
          ? "Unsupported file format. Supported: .docx, .xlsx, .pdf, .csv, .tsv, .txt, .json."
          : "Định dạng tệp không được hỗ trợ. Chỉ chấp nhận: .docx, .xlsx, .pdf, .csv, .tsv, .txt, .json.",
      );
      return;
    }

    if (file.size > MAX_CLIENT_FILE_BYTES) {
      setLocalError(
        locale === "en"
          ? "File exceeds the 15 MB limit."
          : "Tệp vượt quá giới hạn tối đa 15 MB.",
      );
      return;
    }

    onSelectFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (isParsing) return;
    validateAndPickFile(e.dataTransfer.files?.[0]);
  };

  const canProceed =
    sourceMode === "file" ? Boolean(selectedFile) : rawText.trim().length > 0;

  const combinedError = localError ?? errorMessage;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader className="p-4 pb-3 sm:p-6 sm:pb-4">
          <CardTitle>
            <h2
              ref={headingRef}
              data-import-step="1"
              tabIndex={-1}
              className="rounded-sm text-base font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-lg"
            >
              {locale === "en"
                ? "Choose a File or Paste Questions"
                : "Chọn tệp tải lên hoặc dán nội dung"}
            </h2>
          </CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            {locale === "en"
              ? "Automatically detects questions and answers from Word (.docx), Excel (.xlsx), PDF, Quizlet, CSV, or pasted text (up to 15 MB)."
              : "Tự động nhận diện câu hỏi & đáp án từ Word (.docx), Excel (.xlsx), PDF, Quizlet, CSV hoặc văn bản dán vào (tối đa 15 MB)."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0 sm:space-y-5 sm:p-6 sm:pt-0">
          <Tabs
            value={sourceMode}
            onValueChange={(v) => onSourceModeChange(v as "file" | "paste")}
          >
            <TabsList className="grid w-full grid-cols-2 sm:max-w-sm">
              <TabsTrigger value="file" className="min-h-[40px] gap-1.5 text-xs sm:text-sm">
                <FileUp className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {locale === "en" ? "Upload File" : "Tải tệp lên"}
                </span>
              </TabsTrigger>
              <TabsTrigger value="paste" className="min-h-[40px] gap-1.5 text-xs sm:text-sm">
                <FileText className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {locale === "en" ? "Paste Text" : "Dán văn bản"}
                </span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="file" className="mt-4 space-y-3">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!isParsing) setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={cn(
                  "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors sm:px-6 sm:py-8",
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-border bg-muted/30 hover:border-primary/50",
                )}
              >
                {isParsing && selectedFile ? (
                  <div className="flex flex-col items-center gap-2.5 py-2" aria-live="polite">
                    <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                    </div>
                    <p className="max-w-full break-words text-sm font-medium text-foreground">
                      {locale === "en"
                        ? `Reading "${selectedFile.name}"…`
                        : `Đang đọc tệp "${selectedFile.name}"…`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {locale === "en"
                        ? "Detecting questions, answers, and images…"
                        : "Đang nhận diện câu hỏi, đáp án và hình ảnh…"}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-1 min-h-9"
                      onClick={() => {
                        onSelectFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                    >
                      {locale === "en"
                        ? "Cancel & choose another file"
                        : "Hủy & chọn tệp khác"}
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="mb-2.5 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <FileUp className="size-5" aria-hidden="true" />
                    </div>
                    <p className="text-sm font-medium text-foreground sm:text-base">
                      {locale === "en"
                        ? "Drag & drop your file here, or choose from device"
                        : "Kéo thả tệp đề thi vào đây hoặc chọn từ máy"}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                      {locale === "en"
                        ? "Word (.docx with images), Excel (.xlsx), PDF, CSV, Quizlet, TXT, JSON — max 15 MB"
                        : "Word (.docx có ảnh), Excel (.xlsx), PDF, CSV, Quizlet, TXT, JSON — tối đa 15 MB"}
                    </p>

                    <input
                      ref={fileInputRef}
                      id="import-file-input"
                      type="file"
                      accept=".docx,.xlsx,.pdf,.csv,.tsv,.txt,.json"
                      className="sr-only"
                      disabled={isParsing}
                      onChange={(e) => {
                        validateAndPickFile(e.target.files?.[0]);
                        e.currentTarget.value = "";
                      }}
                    />

                    <Button
                      type="button"
                      size="lg"
                      className="mt-4 min-h-[44px] w-full sm:w-auto"
                      disabled={isParsing}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <FileUp className="mr-2 size-4" aria-hidden="true" />
                      {locale === "en" ? "Choose File" : "Chọn tệp từ máy"}
                    </Button>
                  </>
                )}
              </div>

              {selectedFile && !isParsing && (
                <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    {selectedFile.name.toLowerCase().endsWith(".xlsx") ||
                    selectedFile.name.toLowerCase().endsWith(".csv") ? (
                      <FileSpreadsheet
                        className="size-5 shrink-0 text-success"
                        aria-hidden="true"
                      />
                    ) : selectedFile.name.toLowerCase().endsWith(".json") ? (
                      <Braces
                        className="size-5 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                    ) : (
                      <FileType
                        className="size-5 shrink-0 text-accent-solid"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {selectedFile.name}
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {selectedFile.size >= 1024 * 1024
                          ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB`
                          : `${(selectedFile.size / 1024).toFixed(1)} KB`}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 shrink-0"
                    aria-label={locale === "en" ? "Remove file" : "Xóa tệp đã chọn"}
                    onClick={() => {
                      onSelectFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="paste" className="mt-4 space-y-2.5">
              <Label htmlFor="import-raw-textarea" className="block text-sm">
                {locale === "en"
                  ? "Paste questions (EduQuiz *B., Answer Key, Quizlet Tab, CSV, or JSON)"
                  : "Dán nội dung câu hỏi (EduQuiz *B., Đáp án cuối, Quizlet Tab, CSV hoặc JSON)"}
              </Label>
              <Textarea
                id="import-raw-textarea"
                value={rawText}
                onChange={(e) => onRawTextChange(e.target.value)}
                rows={9}
                placeholder={
                  locale === "en"
                    ? "Question 1: What is the capital of Vietnam?\nA. Ho Chi Minh City\n*B. Hanoi\nC. Da Nang\nD. Hue"
                    : "Câu 1: Thủ đô của Việt Nam là thành phố nào?\nA. Thành phố Hồ Chí Minh\n*B. Hà Nội\nC. Đà Nẵng\nD. Huế"
                }
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground tabular-nums">
                {locale === "en"
                  ? `${rawText.length.toLocaleString()} characters`
                  : `${rawText.length.toLocaleString()} ký tự`}
              </p>
            </TabsContent>
          </Tabs>

          {combinedError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{combinedError}</span>
            </div>
          )}

          {(sourceMode === "paste" || Boolean(selectedFile)) && (
            <div className="flex justify-end pt-1">
              <Button
                type="button"
                size="lg"
                className="min-h-[44px] w-full sm:w-auto"
                disabled={!canProceed || isParsing}
                onClick={onContinue}
              >
                {isParsing ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                    {locale === "en" ? "Analyzing…" : "Đang phân tích…"}
                  </>
                ) : locale === "en" ? (
                  "Analyze & Continue"
                ) : (
                  "Phân tích & Tiếp tục"
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Collapsible Sample Templates (native <details> for clean mobile above-the-fold) */}
      <details className="group rounded-xl border border-border bg-card">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
          <span className="inline-flex min-w-0 items-center gap-2">
            <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">
              {locale === "en"
                ? "Need a sample file? Download templates"
                : "Cần tệp mẫu? Tải mẫu Word, Excel, Quizlet…"}
            </span>
          </span>
          <ChevronDown
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="border-t border-border px-4 pb-4 pt-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {TEMPLATE_LINKS.map((tpl) => (
              <a
                key={tpl.format}
                href={`/api/import/templates/${tpl.format}`}
                download
                className="flex min-h-[44px] min-w-0 items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="truncate">
                  {locale === "en" ? tpl.labelEn : tpl.labelVi}{" "}
                  <span className="text-xs text-muted-foreground">({tpl.ext})</span>
                </span>
                <Download
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </a>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}
