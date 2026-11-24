"use client";

import * as React from "react";
import {
  AlertCircle,
  Download,
  FileSpreadsheet,
  FileText,
  FileType,
  FileUp,
  Braces,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Locale } from "@/types/domain";

const ACCEPTED_EXTENSIONS = [".docx", ".xlsx", ".csv", ".tsv", ".txt", ".json"];
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
          ? "Unsupported file format. Supported: .docx, .xlsx, .csv, .tsv, .txt, .json."
          : "Định dạng tệp không được hỗ trợ. Chỉ chấp nhận: .docx, .xlsx, .csv, .tsv, .txt, .json.",
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
    validateAndPickFile(e.dataTransfer.files?.[0]);
  };

  const canProceed =
    sourceMode === "file" ? Boolean(selectedFile) : rawText.trim().length > 0;

  const combinedError = localError ?? errorMessage;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2
              ref={headingRef}
              data-import-step="1"
              tabIndex={-1}
              className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {locale === "en"
                ? "Step 1: Choose File or Paste Content"
                : "Bước 1: Chọn tệp tải lên hoặc dán văn bản"}
            </h2>
          </CardTitle>
          <CardDescription>
            {locale === "en"
              ? "100% deterministic parsing for Word (.docx), Excel (.xlsx), CSV, Quizlet TSV, EduQuiz TXT, and StudyHub JSON. Up to 15 MB and 50,000 questions."
              : "Phân tích xác định 100% cho Word (.docx), Excel (.xlsx), CSV, Quizlet TSV, EduQuiz TXT và JSON. Hỗ trợ tối đa 15 MB và 50.000 câu hỏi."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Tabs
            value={sourceMode}
            onValueChange={(v) => onSourceModeChange(v as "file" | "paste")}
          >
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="file">
                <FileUp className="mr-2 size-4" aria-hidden="true" />
                {locale === "en" ? "Upload File" : "Tải tệp lên"}
              </TabsTrigger>
              <TabsTrigger value="paste">
                <FileText className="mr-2 size-4" aria-hidden="true" />
                {locale === "en" ? "Paste Text" : "Dán văn bản"}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="file" className="mt-4 space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={cn(
                  "flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors",
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-border bg-muted/30 hover:border-primary/50",
                )}
              >
                <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <FileUp className="size-6" aria-hidden="true" />
                </div>
                <p className="text-base font-medium text-foreground">
                  {locale === "en"
                    ? "Drag & drop your study file here, or browse"
                    : "Kéo thả tệp đề thi vào đây hoặc bấm để chọn tệp"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {locale === "en"
                    ? "Supports .docx, .xlsx, .csv, .tsv, .txt, .json (max 15 MB)"
                    : "Hỗ trợ .docx, .xlsx, .csv, .tsv, .txt, .json (tối đa 15 MB)"}
                </p>

                <input
                  ref={fileInputRef}
                  id="import-file-input"
                  type="file"
                  accept=".docx,.xlsx,.csv,.tsv,.txt,.json"
                  className="sr-only"
                  onChange={(e) => validateAndPickFile(e.target.files?.[0])}
                />

                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 min-h-[44px]"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {locale === "en" ? "Choose File" : "Chọn tệp từ máy"}
                </Button>
              </div>

              {selectedFile && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    {selectedFile.name.endsWith(".xlsx") ||
                    selectedFile.name.endsWith(".csv") ? (
                      <FileSpreadsheet
                        className="size-5 shrink-0 text-success"
                        aria-hidden="true"
                      />
                    ) : selectedFile.name.endsWith(".json") ? (
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
                        {(selectedFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
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

            <TabsContent value="paste" className="mt-4 space-y-2">
              <Label htmlFor="import-raw-textarea">
                {locale === "en"
                  ? "Paste questions, EduQuiz text, Answer-Key text, Quizlet TSV, CSV, or JSON"
                  : "Dán nội dung câu hỏi (EduQuiz *B., Đáp án cuối, Quizlet Tab, CSV hoặc JSON)"}
              </Label>
              <Textarea
                id="import-raw-textarea"
                value={rawText}
                onChange={(e) => onRawTextChange(e.target.value)}
                rows={12}
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
              className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{combinedError}</span>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="button"
              size="lg"
              className="min-h-[44px]"
              disabled={!canProceed || isParsing}
              onClick={onContinue}
            >
              {isParsing
                ? locale === "en"
                  ? "Analyzing file…"
                  : "Đang phân tích…"
                : locale === "en"
                  ? "Analyze & Continue"
                  : "Phân tích & Tiếp tục"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Downloadable Templates Strip */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {locale === "en"
              ? "Download Sample Templates"
              : "Tải tệp mẫu chuẩn StudyHub"}
          </CardTitle>
          <CardDescription>
            {locale === "en"
              ? "Use any verified template below to prepare your question bank cleanly."
              : "Tải tệp mẫu có sẵn để chuẩn bị ngân hàng câu hỏi nhanh và chính xác."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {TEMPLATE_LINKS.map((tpl) => (
              <a
                key={tpl.format}
                href={`/api/import/templates/${tpl.format}`}
                download
                className="flex min-h-[44px] items-center justify-between gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="truncate">
                  {locale === "en" ? tpl.labelEn : tpl.labelVi}{" "}
                  <span className="text-xs text-muted-foreground">({tpl.ext})</span>
                </span>
                <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </a>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
