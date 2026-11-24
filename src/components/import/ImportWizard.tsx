"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import {
  buildVercelSafeCommitChunks,
} from "@/lib/import/commit-chunker";
import {
  computeImportSummary,
  validateImportBatch,
  validateParsedQuestion,
} from "@/lib/import/validator-client";
import {
  uploadFileToTempStorage,
  VERCEL_SAFE_DIRECT_PAYLOAD_BYTES,
} from "@/lib/media/direct-upload";
import { cn } from "@/lib/utils";
import type {
  AnswerRule,
  ColumnMapping,
  ImportFormat,
  ImportOptions,
  ImportPreviewSummary,
  ParsedQuestion,
} from "@/types/import";
import { getImportStepLabels } from "./import-copy";
import { StepAnswerRule, StepFormatConfig } from "./StepFormatAndRules";
import {
  ImportOptionsPanel,
  StepCommit,
  type CommitProgressState,
  type DuplicatePolicy,
} from "./StepImportOptionsAndCommit";
import { StepSourceInput } from "./StepSourceInput";
import { VirtualizedPreviewList } from "./VirtualizedPreviewList";

interface ParseApiResponse {
  data?: {
    format: ImportFormat;
    fileName?: string;
    fileSizeBytes?: number;
    sheetNames?: string[];
    selectedSheet?: string;
    headerRowCount?: 1 | 2;
    detectedColumns?: string[];
    sampleRows?: string[][];
    suggestedMapping?: ColumnMapping;
    isScannedPdf?: boolean;
    pdfPageCount?: number;
    pdfExtractedPages?: number;
    questions: ParsedQuestion[];
    summary: ImportPreviewSummary;
    ruleUsed: AnswerRule;
    detectedChapters?: string[];
  };
  error?: { code: string; message: string };
}

interface CommitApiResponse {
  data?: {
    importJobId: string | null;
    importedCount: number;
    skippedCount: number;
    replacedCount: number;
    totalSetQuestions: number;
    idempotentReplay: boolean;
  };
  error?: { code: string; message: string };
}

export interface ImportWizardProps {
  studySetId: string;
  studySetTitle: string;
  existingQuestionCount?: number;
}

const EMPTY_MAPPING: ColumnMapping = {
  prompt: null,
  correctAnswer: null,
};

function hasAnyMapping(mapping: ColumnMapping | undefined): boolean {
  if (!mapping) return false;
  return Boolean(
    mapping.prompt ||
      mapping.correctAnswer ||
      mapping.optionA ||
      mapping.optionB ||
      mapping.backText,
  );
}

function buildParseCacheKey(
  sourceVersion: number,
  opts: ImportOptions,
): string {
  return JSON.stringify({
    v: sourceVersion,
    fmt: opts.formatOverride ?? null,
    sheet: opts.sheetName ?? null,
    hdr: opts.hasHeaderRow ?? true,
    hdrRows: opts.headerRowCount ?? null,
    rule: opts.answerRule ?? { mode: "auto" },
    map: opts.columnMapping ?? null,
    csv: opts.csvDelimiter ?? "",
    term: opts.termDelimiter ?? "\\t",
    card: opts.cardDelimiter ?? "\\n",
    pdfRange: opts.pdfPageRange ?? "",
    pdf2Col: opts.pdfTwoColumn ?? false,
  });
}

const BATCH_REVALIDATE_DEBOUNCE_MS = 300;

export function ImportWizard({
  studySetId,
  studySetTitle,
  existingQuestionCount = 0,
}: ImportWizardProps) {
  const { locale } = useI18n();
  const steps = React.useMemo(() => getImportStepLabels(locale), [locale]);

  const [step, setStep] = React.useState<number>(1);
  const [sourceMode, setSourceMode] = React.useState<"file" | "paste">("file");
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [rawText, setRawText] = React.useState("");
  const [sourceVersion, setSourceVersion] = React.useState<number>(0);

  // Parse configuration state
  const [detectedFormat, setDetectedFormat] = React.useState<ImportFormat>("eduquiz_txt");
  const [formatOverride, setFormatOverride] = React.useState<ImportFormat | undefined>(undefined);
  const [sheetNames, setSheetNames] = React.useState<string[] | undefined>(undefined);
  const [selectedSheet, setSelectedSheet] = React.useState<string | undefined>(undefined);
  const [hasHeaderRow, setHasHeaderRow] = React.useState<boolean>(true);
  const [headerRowCount, setHeaderRowCount] = React.useState<1 | 2 | undefined>(undefined);
  const [detectedColumns, setDetectedColumns] = React.useState<string[] | undefined>(undefined);
  const [sampleRows, setSampleRows] = React.useState<string[][] | undefined>(undefined);
  const [columnMapping, setColumnMapping] = React.useState<ColumnMapping>(EMPTY_MAPPING);
  const [termDelimiter, setTermDelimiter] = React.useState<string>("\\t");
  const [cardDelimiter, setCardDelimiter] = React.useState<string>("\\n");
  const [csvDelimiter, setCsvDelimiter] = React.useState<string>("");
  const [pdfPageRange, setPdfPageRange] = React.useState<string>("");
  const [pdfTwoColumn, setPdfTwoColumn] = React.useState<boolean>(false);
  const [isScannedPdf, setIsScannedPdf] = React.useState<boolean>(false);
  const [pdfPageCount, setPdfPageCount] = React.useState<number | undefined>(undefined);
  const [answerRule, setAnswerRule] = React.useState<AnswerRule>({ mode: "auto" });

  // Parsed preview state
  const [questions, setQuestions] = React.useState<ParsedQuestion[]>([]);
  const [summary, setSummary] = React.useState<ImportPreviewSummary>({
    totalDetected: 0,
    validCount: 0,
    warningCount: 0,
    errorCount: 0,
    duplicateCount: 0,
    missingAnswerCount: 0,
    conflictCount: 0,
  });
  const [detectedChapters, setDetectedChapters] = React.useState<string[]>([]);
  const [fileSizeBytes, setFileSizeBytes] = React.useState<number>(0);
  const [parsedFileName, setParsedFileName] = React.useState<string>("import.txt");

  // Import options state (Step 5)
  const [mode, setMode] = React.useState<"append" | "replace">("append");
  const [duplicatePolicy, setDuplicatePolicy] = React.useState<DuplicatePolicy>("skip");
  const [skipInvalidRows, setSkipInvalidRows] = React.useState<boolean>(false);
  const [defaultChapter, setDefaultChapter] = React.useState<string>("");
  const [defaultTagsText, setDefaultTagsText] = React.useState<string>("");

  // Loading & Error states
  const [isParsing, setIsParsing] = React.useState(false);
  const [parseError, setParseError] = React.useState<string | null>(null);

  // Commit progress state (Step 6)
  const [commitProgress, setCommitProgress] = React.useState<CommitProgressState>({
    status: "idle",
    completedChunks: 0,
    totalChunks: 0,
    importedCount: 0,
    skippedCount: 0,
    replacedCount: 0,
    totalSetQuestions: 0,
    errorMessage: null,
  });

  // Stable session seed for idempotency keys across retries of the same import
  const commitBatchIdRef = React.useRef<string>(crypto.randomUUID());
  // Parse cache key to eliminate 3x redundant re-parses across Steps 1 -> 4 (SH-038)
  const lastParsedKeyRef = React.useRef<string | null>(null);
  const hasParsedQuestionsRef = React.useRef<boolean>(false);
  // Debounced cross-batch revalidation timer for Step-5 edits (SH-038)
  const revalidateTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQuestionsRef = React.useRef<ParsedQuestion[]>(questions);
  // Step-transition focus management: skips initial mount, moves focus to the newly mounted step <h2> (I-02)
  const previousStepRef = React.useRef<number>(step);
  const pendingFocusStepRef = React.useRef<number | null>(null);
  const stepHeadingElRef = React.useRef<HTMLHeadingElement | null>(null);
  const stepHeadingStepRef = React.useRef<number>(step);

  const handleStepHeadingMount = React.useCallback((el: HTMLHeadingElement | null) => {
    if (el) {
      const targetStep = Number(el.dataset.importStep ?? 0);
      stepHeadingElRef.current = el;
      stepHeadingStepRef.current = targetStep;
      if (pendingFocusStepRef.current === targetStep) {
        pendingFocusStepRef.current = null;
        requestAnimationFrame(() => {
          el.focus();
        });
      }
    } else {
      stepHeadingElRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    if (previousStepRef.current === step) {
      return;
    }
    previousStepRef.current = step;
    if (stepHeadingElRef.current && stepHeadingStepRef.current === step) {
      pendingFocusStepRef.current = null;
      const el = stepHeadingElRef.current;
      const rafId = requestAnimationFrame(() => el.focus());
      return () => cancelAnimationFrame(rafId);
    }
    pendingFocusStepRef.current = step;
  }, [step]);

  React.useEffect(() => {
    latestQuestionsRef.current = questions;
    hasParsedQuestionsRef.current = questions.length > 0;
  }, [questions]);

  React.useEffect(() => {
    return () => {
      if (revalidateTimerRef.current) {
        clearTimeout(revalidateTimerRef.current);
      }
    };
  }, []);

  const flushBatchRevalidation = React.useCallback(() => {
    if (revalidateTimerRef.current) {
      clearTimeout(revalidateTimerRef.current);
      revalidateTimerRef.current = null;
      const revalidated = validateImportBatch(latestQuestionsRef.current);
      setQuestions(revalidated.questions);
      setSummary(revalidated.summary);
      setDetectedChapters(revalidated.detectedChapters);
    }
  }, []);

  const runServerParse = React.useCallback(
    async (
      overrideOpts?: Partial<ImportOptions>,
      control?: { force?: boolean; resetMapping?: boolean },
    ): Promise<boolean> => {
      const effectiveFormatOverride =
        overrideOpts && "formatOverride" in overrideOpts
          ? overrideOpts.formatOverride
          : formatOverride;
      const effectiveSheetName =
        overrideOpts && "sheetName" in overrideOpts
          ? overrideOpts.sheetName
          : selectedSheet;
      const effectiveHasHeaderRow =
        overrideOpts && "hasHeaderRow" in overrideOpts
          ? overrideOpts.hasHeaderRow
          : hasHeaderRow;
      const effectiveHeaderRowCount =
        overrideOpts && "headerRowCount" in overrideOpts
          ? overrideOpts.headerRowCount
          : headerRowCount;
      const effectiveAnswerRule =
        overrideOpts && "answerRule" in overrideOpts
          ? overrideOpts.answerRule
          : answerRule;
      const effectiveMapping = control?.resetMapping
        ? undefined
        : overrideOpts && "columnMapping" in overrideOpts
          ? overrideOpts.columnMapping
          : hasAnyMapping(columnMapping)
            ? columnMapping
            : undefined;
      const effectiveCsvDelim =
        overrideOpts && "csvDelimiter" in overrideOpts
          ? overrideOpts.csvDelimiter
          : csvDelimiter || undefined;
      const effectiveTermDelim =
        overrideOpts && "termDelimiter" in overrideOpts
          ? overrideOpts.termDelimiter
          : termDelimiter;
      const effectiveCardDelim =
        overrideOpts && "cardDelimiter" in overrideOpts
          ? overrideOpts.cardDelimiter
          : cardDelimiter;
      const effectivePdfPageRange =
        overrideOpts && "pdfPageRange" in overrideOpts
          ? overrideOpts.pdfPageRange
          : pdfPageRange.trim() || undefined;
      const effectivePdfTwoColumn =
        overrideOpts && "pdfTwoColumn" in overrideOpts
          ? overrideOpts.pdfTwoColumn
          : pdfTwoColumn;

      const effectiveOptions: ImportOptions = {
        formatOverride: effectiveFormatOverride,
        sheetName: effectiveSheetName,
        hasHeaderRow: effectiveHasHeaderRow,
        headerRowCount: effectiveHeaderRowCount,
        answerRule: effectiveAnswerRule,
        columnMapping: effectiveMapping,
        csvDelimiter: effectiveCsvDelim,
        termDelimiter: effectiveTermDelim,
        cardDelimiter: effectiveCardDelim,
        pdfPageRange: effectivePdfPageRange,
        pdfTwoColumn: effectivePdfTwoColumn,
        preserveMediaPreviews: true,
      };

      const requestKey = buildParseCacheKey(sourceVersion, effectiveOptions);
      if (
        !control?.force &&
        lastParsedKeyRef.current === requestKey &&
        hasParsedQuestionsRef.current
      ) {
        return true;
      }

      setIsParsing(true);
      setParseError(null);

      try {
        let response: Response;
        if (sourceMode === "file" && selectedFile) {
          if (selectedFile.size > VERCEL_SAFE_DIRECT_PAYLOAD_BYTES) {
            const staged = await uploadFileToTempStorage({
              file: selectedFile,
              fileName: selectedFile.name,
              purpose: "import",
              contentType: selectedFile.type || undefined,
              studySetId,
            });
            response = await fetch("/api/import/parse", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                storagePath: staged.storagePath,
                fileName: staged.fileName,
                fileSizeBytes: selectedFile.size,
                studySetId,
                options: effectiveOptions,
              }),
            });
          } else {
            const form = new FormData();
            form.append("file", selectedFile);
            form.append("studySetId", studySetId);
            form.append("options", JSON.stringify(effectiveOptions));
            response = await fetch("/api/import/parse", {
              method: "POST",
              body: form,
            });
          }
        } else {
          const textBytes = new TextEncoder().encode(rawText);
          if (textBytes.byteLength > VERCEL_SAFE_DIRECT_PAYLOAD_BYTES) {
            const textBlob = new Blob([textBytes], { type: "text/plain;charset=utf-8" });
            const staged = await uploadFileToTempStorage({
              file: textBlob,
              fileName: "pasted-input.txt",
              purpose: "import",
              contentType: "text/plain",
              studySetId,
            });
            response = await fetch("/api/import/parse", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                storagePath: staged.storagePath,
                fileName: staged.fileName,
                fileSizeBytes: textBytes.byteLength,
                studySetId,
                options: effectiveOptions,
              }),
            });
          } else {
            response = await fetch("/api/import/parse", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                rawText,
                fileName: "pasted-input.txt",
                studySetId,
                options: effectiveOptions,
              }),
            });
          }
        }

        const payload = (await response.json()) as ParseApiResponse;
        if (!response.ok || !payload.data) {
          const msg =
            payload.error?.message ??
            (locale === "en"
              ? "Failed to parse input. Please check file format."
              : "Không thể phân tích dữ liệu. Vui lòng kiểm tra định dạng tệp.");
          setParseError(msg);
          toast.error(msg);
          return false;
        }

        const data = payload.data;
        const resolvedMapping =
          control?.resetMapping || !hasAnyMapping(columnMapping)
            ? (data.suggestedMapping ?? EMPTY_MAPPING)
            : (effectiveMapping ?? columnMapping);

        setDetectedFormat(data.format);
        setSheetNames(data.sheetNames);
        setSelectedSheet(data.selectedSheet);
        setHeaderRowCount(data.headerRowCount);
        setDetectedColumns(data.detectedColumns);
        setSampleRows(data.sampleRows);
        setColumnMapping(resolvedMapping);
        setIsScannedPdf(Boolean(data.isScannedPdf));
        setPdfPageCount(data.pdfPageCount);
        setQuestions(data.questions);
        setSummary(data.summary);
        setDetectedChapters(data.detectedChapters ?? []);
        setFileSizeBytes(data.fileSizeBytes ?? 0);
        setParsedFileName(data.fileName ?? selectedFile?.name ?? "pasted-input.txt");
        commitBatchIdRef.current = crypto.randomUUID();

        // Store cache key matching the resolved state so unchanged Next clicks skip re-parsing
        lastParsedKeyRef.current = buildParseCacheKey(sourceVersion, {
          ...effectiveOptions,
          sheetName: data.selectedSheet ?? effectiveSheetName,
          headerRowCount: data.headerRowCount ?? effectiveHeaderRowCount,
          columnMapping: hasAnyMapping(resolvedMapping)
            ? resolvedMapping
            : undefined,
        });
        return true;
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : locale === "en"
              ? "Network error while parsing."
              : "Lỗi kết nối khi phân tích tệp.";
        setParseError(msg);
        toast.error(msg);
        return false;
      } finally {
        setIsParsing(false);
      }
    },
    [
      answerRule,
      cardDelimiter,
      columnMapping,
      csvDelimiter,
      formatOverride,
      hasHeaderRow,
      headerRowCount,
      locale,
      pdfPageRange,
      pdfTwoColumn,
      rawText,
      selectedFile,
      selectedSheet,
      sourceMode,
      sourceVersion,
      studySetId,
      termDelimiter,
    ],
  );

  // O(1) immediate single-item validation + debounced batch duplicate revalidation (fixes 105ms freeze on 10k rows)
  const handleUpdateQuestion = React.useCallback(
    (tempId: string, updater: (q: ParsedQuestion) => ParsedQuestion) => {
      setQuestions((prev) => {
        const idx = prev.findIndex((q) => q.tempId === tempId);
        if (idx === -1) return prev;
        const nextList = prev.slice();
        const updated = updater(prev[idx]);
        nextList[idx] = validateParsedQuestion(updated, idx, {
          isDuplicate: updated.isDuplicate,
        });
        latestQuestionsRef.current = nextList;
        setSummary(computeImportSummary(nextList));
        return nextList;
      });

      if (revalidateTimerRef.current) {
        clearTimeout(revalidateTimerRef.current);
      }
      revalidateTimerRef.current = setTimeout(() => {
        revalidateTimerRef.current = null;
        const revalidated = validateImportBatch(latestQuestionsRef.current);
        setQuestions(revalidated.questions);
        setSummary(revalidated.summary);
        setDetectedChapters(revalidated.detectedChapters);
      }, BATCH_REVALIDATE_DEBOUNCE_MS);
    },
    [],
  );

  const handleMoveMediaToQuestion = React.useCallback(
    (
      sourceTempId: string,
      mediaId: string,
      sourceSlot: "prompt" | string,
      targetQuestionIndex: number,
    ) => {
      setQuestions((prev) => {
        const srcIdx = prev.findIndex((q) => q.tempId === sourceTempId);
        if (srcIdx === -1 || targetQuestionIndex < 0 || targetQuestionIndex >= prev.length) {
          return prev;
        }
        const srcQ = prev[srcIdx];
        const moved =
          sourceSlot === "prompt"
            ? (srcQ.promptMedia ?? []).find((m) => m.id === mediaId)
            : srcQ.options
                .find((o) => o.id === sourceSlot)
                ?.media?.find((m) => m.id === mediaId);
        if (!moved) return prev;

        const cleanMoved = { ...moved, ambiguous: false };
        const nextList = prev.slice();

        const nextSrcPromptMedia = (srcQ.promptMedia ?? []).filter((m) => m.id !== mediaId);
        const nextSrcOptions = srcQ.options.map((o) => {
          const rem = (o.media ?? []).filter((m) => m.id !== mediaId);
          return { ...o, media: rem.length > 0 ? rem : undefined };
        });
        const srcStillFloating =
          nextSrcPromptMedia.some((m) => m.ambiguous) ||
          nextSrcOptions.some((o) => (o.media ?? []).some((m) => m.ambiguous));

        nextList[srcIdx] = validateParsedQuestion(
          {
            ...srcQ,
            promptMedia: nextSrcPromptMedia.length > 0 ? nextSrcPromptMedia : undefined,
            options: nextSrcOptions,
            ambiguousMedia: srcStillFloating ? true : undefined,
            issues: srcStillFloating
              ? srcQ.issues
              : srcQ.issues.filter((i) => i.code !== "AMBIGUOUS_MEDIA_MAPPING"),
          },
          srcIdx,
          { isDuplicate: srcQ.isDuplicate },
        );

        const destQ = nextList[targetQuestionIndex];
        nextList[targetQuestionIndex] = validateParsedQuestion(
          {
            ...destQ,
            promptMedia: [...(destQ.promptMedia ?? []), cleanMoved],
          },
          targetQuestionIndex,
          { isDuplicate: destQ.isDuplicate },
        );

        latestQuestionsRef.current = nextList;
        setSummary(computeImportSummary(nextList));
        return nextList;
      });
    },
    [],
  );

  const readyToImportQuestions = React.useMemo(() => {
    return questions.filter((q) => {
      if (q.excluded) return false;
      if (skipInvalidRows && q.issues.some((i) => i.severity === "error")) {
        return false;
      }
      return true;
    });
  }, [questions, skipInvalidRows]);

  const handleStartCommit = React.useCallback(async () => {
    const activeRows = readyToImportQuestions;
    if (activeRows.length === 0) return;

    // Keep every JSON commit chunk <= 2.5 MB and <= 500 questions across ALL formats
    // so multi-chunk commits never exceed Vercel Hobby's 4.5 MB request body cap.
    const chunks: ParsedQuestion[][] = buildVercelSafeCommitChunks(activeRows);
    const defaultTags = defaultTagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    setCommitProgress({
      status: "committing",
      completedChunks: 0,
      totalChunks: chunks.length,
      importedCount: 0,
      skippedCount: 0,
      replacedCount: 0,
      totalSetQuestions: 0,
      errorMessage: null,
    });

    let importJobId: string | undefined;
    let totalImported = 0;
    let totalSkipped = 0;
    let totalReplaced = 0;
    let finalSetTotal = 0;

    try {
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        const idempotencyKey = `${commitBatchIdRef.current}-chunk-${i}`;

        const response = await fetch("/api/import/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studySetId,
            idempotencyKey,
            importJobId,
            isFirstChunk: i === 0,
            isFinalChunk: i === chunks.length - 1,
            sourceFormat: formatOverride ?? detectedFormat,
            fileName: parsedFileName,
            fileSizeBytes,
            answerRule,
            mode,
            duplicatePolicy,
            skipInvalidRows,
            defaultChapter: defaultChapter.trim() || undefined,
            defaultTags: defaultTags.length > 0 ? defaultTags : undefined,
            totalDetectedOverall: questions.length,
            questions: chunk,
          }),
        });

        const payload = (await response.json()) as CommitApiResponse;
        if (!response.ok || !payload.data) {
          throw new Error(
            payload.error?.message ??
              (locale === "en"
                ? `Chunk ${i + 1} failed to save.`
                : `Lỗi khi lưu lô dữ liệu thứ ${i + 1}.`),
          );
        }

        if (payload.data.importJobId) {
          importJobId = payload.data.importJobId;
        }
        totalImported += payload.data.importedCount;
        totalSkipped += payload.data.skippedCount;
        totalReplaced += payload.data.replacedCount;
        finalSetTotal = payload.data.totalSetQuestions;

        setCommitProgress({
          status: i === chunks.length - 1 ? "completed" : "committing",
          completedChunks: i + 1,
          totalChunks: chunks.length,
          importedCount: totalImported,
          skippedCount: totalSkipped,
          replacedCount: totalReplaced,
          totalSetQuestions: finalSetTotal,
          errorMessage: null,
        });
      }

      toast.success(
        locale === "en"
          ? `Imported ${totalImported.toLocaleString()} question(s) successfully.`
          : `Đã nhập thành công ${totalImported.toLocaleString()} câu hỏi.`,
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : locale === "en"
            ? "Import commit failed."
            : "Quá trình nhập dữ liệu gặp lỗi.";
      setCommitProgress((prev) => ({
        ...prev,
        status: "error",
        errorMessage: msg,
      }));
      toast.error(msg);
    }
  }, [
    answerRule,
    defaultChapter,
    defaultTagsText,
    detectedFormat,
    duplicatePolicy,
    fileSizeBytes,
    formatOverride,
    locale,
    mode,
    parsedFileName,
    questions.length,
    readyToImportQuestions,
    skipInvalidRows,
    studySetId,
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      {/* Top Breadcrumb & Heading */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={`/sets/${studySetId}`}
            className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {studySetTitle}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {locale === "en"
              ? "Bulk Question Import Wizard"
              : "Trình nhập ngân hàng câu hỏi"}
          </h1>
        </div>
      </div>

      {/* 6-Step Progress Stepper */}
      <nav
        aria-label={locale === "en" ? "Import wizard progress" : "Tiến trình nhập dữ liệu"}
        className="overflow-x-auto pb-1"
      >
        <ol className="flex min-w-[540px] items-center justify-between gap-2">
          {steps.map((s) => {
            const isActive = step === s.step;
            const isCompleted = step > s.step;
            return (
              <li key={s.step} className="flex flex-1 items-center gap-2">
                <button
                  type="button"
                  aria-current={isActive ? "step" : undefined}
                  disabled={s.step > step || commitProgress.status === "committing"}
                  onClick={() => s.step < step && setStep(s.step)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive && "font-semibold text-foreground",
                    isCompleted && "text-primary hover:bg-muted",
                    !isActive && !isCompleted && "cursor-not-allowed text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                      isCompleted && "border-primary bg-primary text-primary-foreground",
                      isActive && "border-primary bg-primary/10 text-primary",
                      !isActive && !isCompleted && "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {isCompleted ? (
                      <Check className="size-3.5" aria-hidden="true" />
                    ) : (
                      s.step
                    )}
                  </span>
                  <span className="sr-only md:not-sr-only md:whitespace-nowrap">
                    {s.short}
                  </span>
                </button>
                {s.step < steps.length && (
                  <div
                    className={cn(
                      "h-px flex-1",
                      isCompleted ? "bg-primary" : "bg-border",
                    )}
                    aria-hidden="true"
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Step Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16 }}
        >
          {step === 1 && (
            <StepSourceInput
              locale={locale}
              sourceMode={sourceMode}
              onSourceModeChange={(m) => {
                setSourceMode(m);
                setSourceVersion((v) => v + 1);
                lastParsedKeyRef.current = null;
              }}
              selectedFile={selectedFile}
              onSelectFile={(f) => {
                setSelectedFile(f);
                setFormatOverride(undefined);
                setSelectedSheet(undefined);
                setHeaderRowCount(undefined);
                setColumnMapping(EMPTY_MAPPING);
                setSourceVersion((v) => v + 1);
                lastParsedKeyRef.current = null;
              }}
              rawText={rawText}
              onRawTextChange={(txt) => {
                setRawText(txt);
                setSourceVersion((v) => v + 1);
                lastParsedKeyRef.current = null;
              }}
              isParsing={isParsing}
              errorMessage={parseError}
              headingRef={handleStepHeadingMount}
              onContinue={async () => {
                const ok = await runServerParse(undefined, { resetMapping: true });
                if (ok) setStep(2);
              }}
            />
          )}

          {step === 2 && (
            <StepFormatConfig
              locale={locale}
              detectedFormat={detectedFormat}
              formatOverride={formatOverride}
              onFormatOverrideChange={(fmt) => {
                setFormatOverride(fmt);
                setColumnMapping(EMPTY_MAPPING);
                lastParsedKeyRef.current = null;
              }}
              sheetNames={sheetNames}
              selectedSheet={selectedSheet}
              onSheetChange={async (sheet) => {
                setSelectedSheet(sheet);
                setHeaderRowCount(undefined);
                setColumnMapping(EMPTY_MAPPING);
                await runServerParse(
                  { sheetName: sheet, headerRowCount: undefined },
                  { force: true, resetMapping: true },
                );
              }}
              hasHeaderRow={hasHeaderRow}
              onHasHeaderRowChange={async (val) => {
                setHasHeaderRow(val);
                setHeaderRowCount(undefined);
                setColumnMapping(EMPTY_MAPPING);
                await runServerParse(
                  { hasHeaderRow: val, headerRowCount: undefined },
                  { force: true, resetMapping: true },
                );
              }}
              headerRowCount={headerRowCount ?? 1}
              onHeaderRowCountChange={async (rows) => {
                setHeaderRowCount(rows);
                setColumnMapping(EMPTY_MAPPING);
                await runServerParse(
                  { headerRowCount: rows },
                  { force: true, resetMapping: true },
                );
              }}
              detectedColumns={detectedColumns}
              sampleRows={sampleRows}
              columnMapping={columnMapping}
              onColumnMappingChange={setColumnMapping}
              termDelimiter={termDelimiter}
              onTermDelimiterChange={setTermDelimiter}
              cardDelimiter={cardDelimiter}
              onCardDelimiterChange={setCardDelimiter}
              csvDelimiter={csvDelimiter}
              onCsvDelimiterChange={setCsvDelimiter}
              pdfPageRange={pdfPageRange}
              onPdfPageRangeChange={setPdfPageRange}
              pdfTwoColumn={pdfTwoColumn}
              onPdfTwoColumnChange={setPdfTwoColumn}
              isScannedPdf={isScannedPdf}
              pdfPageCount={pdfPageCount}
              isParsing={isParsing}
              headingRef={handleStepHeadingMount}
              onBack={() => setStep(1)}
              onNext={async () => {
                const ok = await runServerParse();
                if (ok) setStep(3);
              }}
            />
          )}

          {step === 3 && (
            <StepAnswerRule
              locale={locale}
              activeFormat={formatOverride ?? detectedFormat}
              answerRule={answerRule}
              onAnswerRuleChange={setAnswerRule}
              isParsing={isParsing}
              headingRef={handleStepHeadingMount}
              onBack={() => setStep(2)}
              onNext={async () => {
                const ok = await runServerParse({ answerRule });
                if (ok) setStep(4);
              }}
            />
          )}

          {step === 4 && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2
                    ref={handleStepHeadingMount}
                    data-import-step="4"
                    tabIndex={-1}
                    className="rounded-sm text-lg font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {locale === "en"
                      ? "Step 4: Parse & Preview Questions"
                      : "Bước 4: Xem trước kết quả phân tích"}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {locale === "en"
                      ? "Inspect stems, options, highlighted correct answers, and detection sources."
                      : "Kiểm tra nội dung câu hỏi, đáp án đúng được đánh dấu và nguồn nhận diện."}
                  </p>
                </div>
              </div>

              <VirtualizedPreviewList
                locale={locale}
                questions={questions}
                summary={summary}
                detectedChapters={detectedChapters}
                allowInlineEdit={false}
                onUpdateQuestion={handleUpdateQuestion}
                onMoveMediaToQuestion={handleMoveMediaToQuestion}
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[44px]"
                  onClick={() => setStep(3)}
                >
                  <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
                  {locale === "en" ? "Adjust Answer Rules" : "Đổi quy tắc đáp án"}
                </Button>
                <Button
                  type="button"
                  className="min-h-[44px]"
                  onClick={() => setStep(5)}
                >
                  {locale === "en"
                    ? "Next: Fix Issues & Import Options"
                    : "Tiếp: Chỉnh sửa & Tùy chọn nhập"}
                  <ArrowRight className="ml-2 size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-5">
              <div>
                <h2
                  ref={handleStepHeadingMount}
                  data-import-step="5"
                  tabIndex={-1}
                  className="rounded-sm text-lg font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {locale === "en"
                    ? "Step 5: Inline Validation, Editing & Options"
                    : "Bước 5: Kiểm tra, chỉnh sửa trực tiếp & Tùy chọn"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {locale === "en"
                    ? "Click any option to toggle the correct answer or click Edit to fix prompts, options, and explanations inline."
                    : "Bấm trực tiếp vào lựa chọn để đổi đáp án đúng hoặc bấm Sửa để chỉnh nội dung câu hỏi và giải thích."}
                </p>
              </div>

              <VirtualizedPreviewList
                locale={locale}
                questions={questions}
                summary={summary}
                detectedChapters={detectedChapters}
                allowInlineEdit={true}
                onUpdateQuestion={handleUpdateQuestion}
                onMoveMediaToQuestion={handleMoveMediaToQuestion}
              />

              <ImportOptionsPanel
                locale={locale}
                mode={mode}
                onModeChange={setMode}
                duplicatePolicy={duplicatePolicy}
                onDuplicatePolicyChange={setDuplicatePolicy}
                skipInvalidRows={skipInvalidRows}
                onSkipInvalidRowsChange={setSkipInvalidRows}
                defaultChapter={defaultChapter}
                onDefaultChapterChange={setDefaultChapter}
                defaultTagsText={defaultTagsText}
                onDefaultTagsTextChange={setDefaultTagsText}
                summary={summary}
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[44px]"
                  onClick={() => setStep(4)}
                >
                  <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
                  {locale === "en" ? "Back to Preview" : "Quay lại xem trước"}
                </Button>
                <Button
                  type="button"
                  className="min-h-[44px]"
                  onClick={() => {
                    flushBatchRevalidation();
                    setCommitProgress({
                      status: "idle",
                      completedChunks: 0,
                      totalChunks: 0,
                      importedCount: 0,
                      skippedCount: 0,
                      replacedCount: 0,
                      totalSetQuestions: 0,
                      errorMessage: null,
                    });
                    setStep(6);
                  }}
                >
                  {locale === "en" ? "Next: Confirm & Import" : "Tiếp: Xác nhận nhập"}
                  <ArrowRight className="ml-2 size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}

          {step === 6 && (
            <StepCommit
              locale={locale}
              studySetId={studySetId}
              studySetTitle={studySetTitle}
              existingQuestionCount={existingQuestionCount}
              readyCount={readyToImportQuestions.length}
              errorCount={summary.errorCount}
              skipInvalidRows={skipInvalidRows}
              mode={mode}
              duplicatePolicy={duplicatePolicy}
              progress={commitProgress}
              headingRef={handleStepHeadingMount}
              onBack={() => setStep(5)}
              onStartCommit={handleStartCommit}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
