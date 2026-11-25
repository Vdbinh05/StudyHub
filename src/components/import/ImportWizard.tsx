"use client";

import * as React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  FileCheck2,
  SlidersHorizontal,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { buildVercelSafeCommitChunks } from "@/lib/import/commit-chunker";
import { consumePendingImportFile } from "@/lib/import/pending-file-handoff";
import {
  computeImportSummary,
  validateImportBatch,
  validateParsedQuestion,
} from "@/lib/import/validator-client";
import {
  uploadFileToTempStorage,
  VERCEL_SAFE_DIRECT_PAYLOAD_BYTES,
} from "@/lib/media/direct-upload";
import { invalidateStudySetCaches } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type {
  AnswerRule,
  ColumnMapping,
  ImportFormat,
  ImportOptions,
  ImportPreviewSummary,
  ParsedQuestion,
} from "@/types/import";
import { getFormatLabel, getImportStepLabels } from "./import-copy";
import { AnswerRuleSection, FormatConfigSection } from "./StepFormatAndRules";
import {
  ImportOptionsPanel,
  ReplaceConfirmDialog,
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

const EMPTY_SUMMARY: ImportPreviewSummary = {
  totalDetected: 0,
  validCount: 0,
  warningCount: 0,
  errorCount: 0,
  duplicateCount: 0,
  missingAnswerCount: 0,
  conflictCount: 0,
};

const IDLE_COMMIT_PROGRESS: CommitProgressState = {
  status: "idle",
  completedChunks: 0,
  totalChunks: 0,
  importedCount: 0,
  skippedCount: 0,
  replacedCount: 0,
  totalSetQuestions: 0,
  errorMessage: null,
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

function buildParseCacheKey(sourceVersion: number, opts: ImportOptions): string {
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
  const queryClient = useQueryClient();
  const steps = React.useMemo(() => getImportStepLabels(locale), [locale]);

  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [sourceMode, setSourceMode] = React.useState<"file" | "paste">("file");
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [rawText, setRawText] = React.useState("");
  const [sourceVersion, setSourceVersion] = React.useState<number>(0);

  // Parse configuration state (housed inside Step 2 collapsible Advanced Options)
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
  const [advancedOpen, setAdvancedOpen] = React.useState<boolean>(false);

  // Parsed preview state
  const [questions, setQuestions] = React.useState<ParsedQuestion[]>([]);
  const [summary, setSummary] = React.useState<ImportPreviewSummary>(EMPTY_SUMMARY);
  const [detectedChapters, setDetectedChapters] = React.useState<string[]>([]);
  const [fileSizeBytes, setFileSizeBytes] = React.useState<number>(0);
  const [parsedFileName, setParsedFileName] = React.useState<string>("import.txt");

  // Import save options (inside Step 2 collapsible Advanced Options)
  const [mode, setMode] = React.useState<"append" | "replace">("append");
  const [duplicatePolicy, setDuplicatePolicy] = React.useState<DuplicatePolicy>("skip");
  const [skipInvalidRows, setSkipInvalidRows] = React.useState<boolean>(false);
  const [defaultChapter, setDefaultChapter] = React.useState<string>("");
  const [defaultTagsText, setDefaultTagsText] = React.useState<string>("");
  const [confirmReplaceOpen, setConfirmReplaceOpen] = React.useState<boolean>(false);

  // Loading & Error states
  const [isParsing, setIsParsing] = React.useState(false);
  const [parseError, setParseError] = React.useState<string | null>(null);

  // Step 3 commit progress state
  const [commitProgress, setCommitProgress] =
    React.useState<CommitProgressState>(IDLE_COMMIT_PROGRESS);

  // Stable session seed for idempotency keys across retries of the same import
  const commitBatchIdRef = React.useRef<string>(crypto.randomUUID());
  const sourceVersionRef = React.useRef<number>(sourceVersion);
  // Race guards for async parse & commit loops (FUNC-13)
  const parseAbortControllerRef = React.useRef<AbortController | null>(null);
  const parseRequestIdRef = React.useRef<number>(0);
  const committingRef = React.useRef<boolean>(false);
  const commitSessionRef = React.useRef<{
    batchId: string;
    importJobId?: string;
    completedChunks: number;
    totalImported: number;
    totalSkipped: number;
    totalReplaced: number;
    finalSetTotal: number;
  } | null>(null);
  const handoffFileRef = React.useRef<File | null>(null);
  const handoffStartedRef = React.useRef<boolean>(false);
  // Parse cache key to avoid redundant re-parses when options haven't changed
  const lastParsedKeyRef = React.useRef<string | null>(null);
  const hasParsedQuestionsRef = React.useRef<boolean>(false);
  // Debounced cross-batch revalidation timer for inline edits
  const revalidateTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQuestionsRef = React.useRef<ParsedQuestion[]>(questions);
  // Step-transition focus management: moves focus cleanly to the mounted step <h2>
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
    sourceVersionRef.current = sourceVersion;
  }, [sourceVersion]);

  React.useEffect(() => {
    return () => {
      if (revalidateTimerRef.current) {
        clearTimeout(revalidateTimerRef.current);
      }
      parseAbortControllerRef.current?.abort();
    };
  }, []);

  const flushBatchRevalidation = React.useCallback((): ParsedQuestion[] => {
    if (revalidateTimerRef.current) {
      clearTimeout(revalidateTimerRef.current);
      revalidateTimerRef.current = null;
      const revalidated = validateImportBatch(latestQuestionsRef.current);
      latestQuestionsRef.current = revalidated.questions;
      setQuestions(revalidated.questions);
      setSummary(revalidated.summary);
      setDetectedChapters(revalidated.detectedChapters);
      return revalidated.questions;
    }
    return latestQuestionsRef.current;
  }, []);

  const runServerParse = React.useCallback(
    async (
      overrideOpts?: Partial<ImportOptions>,
      control?: {
        force?: boolean;
        resetMapping?: boolean;
        fileOverride?: File;
        nextSourceVersion?: number;
      },
    ): Promise<ParseApiResponse["data"] | null> => {
      const activeFile = control?.fileOverride ?? selectedFile;
      const activeSourceMode = control?.fileOverride ? "file" : sourceMode;
      const activeVersion = control?.nextSourceVersion ?? sourceVersionRef.current;

      const effectiveFormatOverride =
        overrideOpts && "formatOverride" in overrideOpts
          ? overrideOpts.formatOverride
          : control?.fileOverride
            ? undefined
            : formatOverride;
      const effectiveSheetName =
        overrideOpts && "sheetName" in overrideOpts
          ? overrideOpts.sheetName
          : control?.fileOverride
            ? undefined
            : selectedSheet;
      const effectiveHasHeaderRow =
        overrideOpts && "hasHeaderRow" in overrideOpts
          ? overrideOpts.hasHeaderRow
          : hasHeaderRow;
      const effectiveHeaderRowCount =
        overrideOpts && "headerRowCount" in overrideOpts
          ? overrideOpts.headerRowCount
          : control?.fileOverride
            ? undefined
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

      const requestKey = buildParseCacheKey(activeVersion, effectiveOptions);
      if (
        !control?.force &&
        lastParsedKeyRef.current === requestKey &&
        hasParsedQuestionsRef.current
      ) {
        return {
          format: detectedFormat,
          questions: latestQuestionsRef.current,
          summary,
          ruleUsed: answerRule,
          isScannedPdf,
        };
      }

      const requestId = ++parseRequestIdRef.current;
      parseAbortControllerRef.current?.abort();
      const controller = new AbortController();
      parseAbortControllerRef.current = controller;

      setIsParsing(true);
      setParseError(null);

      try {
        let response: Response;
        if (activeSourceMode === "file" && activeFile) {
          if (activeFile.size > VERCEL_SAFE_DIRECT_PAYLOAD_BYTES) {
            const staged = await uploadFileToTempStorage({
              file: activeFile,
              fileName: activeFile.name,
              purpose: "import",
              contentType: activeFile.type || undefined,
              studySetId,
            });
            if (controller.signal.aborted || parseRequestIdRef.current !== requestId) {
              return null;
            }
            response = await fetch("/api/import/parse", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({
                storagePath: staged.storagePath,
                fileName: staged.fileName,
                fileSizeBytes: activeFile.size,
                studySetId,
                options: effectiveOptions,
              }),
            });
          } else {
            const form = new FormData();
            form.append("file", activeFile);
            form.append("studySetId", studySetId);
            form.append("options", JSON.stringify(effectiveOptions));
            response = await fetch("/api/import/parse", {
              method: "POST",
              signal: controller.signal,
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
            if (controller.signal.aborted || parseRequestIdRef.current !== requestId) {
              return null;
            }
            response = await fetch("/api/import/parse", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
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
              signal: controller.signal,
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
        if (controller.signal.aborted || parseRequestIdRef.current !== requestId) {
          return null;
        }
        if (!response.ok || !payload.data) {
          const msg =
            payload.error?.message ??
            (locale === "en"
              ? "Failed to read input. Please check your file format."
              : "Không thể đọc dữ liệu. Vui lòng kiểm tra định dạng tệp.");
          setParseError(msg);
          toast.error(msg);
          return null;
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
        latestQuestionsRef.current = data.questions;
        setSummary(data.summary);
        setDetectedChapters(data.detectedChapters ?? []);
        setFileSizeBytes(data.fileSizeBytes ?? 0);
        setParsedFileName(data.fileName ?? activeFile?.name ?? "pasted-input.txt");
        commitBatchIdRef.current = crypto.randomUUID();
        commitSessionRef.current = null;

        lastParsedKeyRef.current = buildParseCacheKey(activeVersion, {
          ...effectiveOptions,
          sheetName: data.selectedSheet ?? effectiveSheetName,
          headerRowCount: data.headerRowCount ?? effectiveHeaderRowCount,
          columnMapping: hasAnyMapping(resolvedMapping)
            ? resolvedMapping
            : undefined,
        });
        return data;
      } catch (err) {
        if (
          controller.signal.aborted ||
          parseRequestIdRef.current !== requestId ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return null;
        }
        const msg =
          err instanceof Error
            ? err.message
            : locale === "en"
              ? "Network error while reading file."
              : "Lỗi kết nối khi đọc tệp.";
        setParseError(msg);
        toast.error(msg);
        return null;
      } finally {
        if (parseRequestIdRef.current === requestId) {
          setIsParsing(false);
        }
      }
    },
    [
      answerRule,
      cardDelimiter,
      columnMapping,
      csvDelimiter,
      detectedFormat,
      formatOverride,
      hasHeaderRow,
      headerRowCount,
      isScannedPdf,
      locale,
      pdfPageRange,
      pdfTwoColumn,
      rawText,
      selectedFile,
      selectedSheet,
      sourceMode,
      studySetId,
      summary,
      termDelimiter,
    ],
  );

  const openStep2WithResult = React.useCallback(
    (data: NonNullable<ParseApiResponse["data"]>) => {
      const needsAdvanced =
        Boolean(data.isScannedPdf) ||
        data.summary.totalDetected === 0 ||
        (data.summary.missingAnswerCount > 0 && data.summary.validCount === 0);
      setAdvancedOpen(needsAdvanced);
      setStep(2);
    },
    [],
  );

  // Instant file auto-parse on pick/drop -> drops student straight into Step 2!
  const handleSelectFile = React.useCallback(
    async (file: File | null) => {
      setSelectedFile(file);
      setFormatOverride(undefined);
      setSelectedSheet(undefined);
      setHeaderRowCount(undefined);
      setColumnMapping(EMPTY_MAPPING);
      setAnswerRule({ mode: "auto" });
      setParseError(null);
      const nextVer = sourceVersionRef.current + 1;
      sourceVersionRef.current = nextVer;
      setSourceVersion(nextVer);
      lastParsedKeyRef.current = null;
      commitSessionRef.current = null;

      if (!file) {
        parseRequestIdRef.current += 1;
        parseAbortControllerRef.current?.abort();
        setIsParsing(false);
        return;
      }

      const data = await runServerParse(
        {
          formatOverride: undefined,
          sheetName: undefined,
          headerRowCount: undefined,
          answerRule: { mode: "auto" },
        },
        {
          force: true,
          resetMapping: true,
          fileOverride: file,
          nextSourceVersion: nextVer,
        },
      );
      if (data) {
        openStep2WithResult(data);
      }
    },
    [openStep2WithResult, runServerParse],
  );

  // Auto-consume a pre-selected File handed off from `/import` (`V32-038` / `RU-13`)
  // eliminating the double file-picker friction (StrictMode remount-safe, zero dep loop).
  const handleSelectFileRef = React.useRef(handleSelectFile);
  React.useEffect(() => {
    handleSelectFileRef.current = handleSelectFile;
  }, [handleSelectFile]);

  React.useEffect(() => {
    if (!handoffFileRef.current) {
      const pending = consumePendingImportFile(studySetId);
      if (pending) {
        handoffFileRef.current = pending;
      }
    }
    const file = handoffFileRef.current;
    if (!file || handoffStartedRef.current) return;

    handoffStartedRef.current = true;
    let active = true;
    void handleSelectFileRef.current(file).then(() => {
      if (active) {
        handoffFileRef.current = null;
      }
    });

    return () => {
      active = false;
      if (handoffFileRef.current) {
        handoffStartedRef.current = false;
      }
    };
  }, [studySetId]);

  // O(1) immediate single-item validation + debounced batch duplicate revalidation
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
        latestQuestionsRef.current = revalidated.questions;
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
            : sourceSlot === "explanation"
              ? (srcQ.explanationMedia ?? []).find((m) => m.id === mediaId)
              : srcQ.options
                  .find((o) => o.id === sourceSlot)
                  ?.media?.find((m) => m.id === mediaId);
        if (!moved) return prev;

        const cleanMoved = { ...moved, ambiguous: false };
        const nextList = prev.slice();

        const nextSrcPromptMedia = (srcQ.promptMedia ?? []).filter((m) => m.id !== mediaId);
        const nextSrcExplanationMedia = (srcQ.explanationMedia ?? []).filter(
          (m) => m.id !== mediaId,
        );
        const nextSrcOptions = srcQ.options.map((o) => {
          const rem = (o.media ?? []).filter((m) => m.id !== mediaId);
          return { ...o, media: rem.length > 0 ? rem : undefined };
        });
        const srcStillFloating =
          nextSrcPromptMedia.some((m) => m.ambiguous) ||
          nextSrcExplanationMedia.some((m) => m.ambiguous) ||
          nextSrcOptions.some((o) => (o.media ?? []).some((m) => m.ambiguous));

        nextList[srcIdx] = validateParsedQuestion(
          {
            ...srcQ,
            promptMedia: nextSrcPromptMedia.length > 0 ? nextSrcPromptMedia : undefined,
            explanationMedia:
              nextSrcExplanationMedia.length > 0 ? nextSrcExplanationMedia : undefined,
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

  const filterReadyQuestions = React.useCallback(
    (list: ParsedQuestion[]): ParsedQuestion[] => {
      return list.filter((q) => {
        if (q.excluded) return false;
        if (skipInvalidRows && q.issues.some((i) => i.severity === "error")) {
          return false;
        }
        return true;
      });
    },
    [skipInvalidRows],
  );

  const readyToImportQuestions = React.useMemo(
    () => filterReadyQuestions(questions),
    [filterReadyQuestions, questions],
  );

  const blockedByErrors = summary.errorCount > 0 && !skipInvalidRows;

  const executeCommit = React.useCallback(
    async (overrideRows?: ParsedQuestion[]) => {
      if (committingRef.current) return;
      const latestAll = overrideRows ? overrideRows : filterReadyQuestions(flushBatchRevalidation());
      if (latestAll.length === 0) return;

      committingRef.current = true;

      // Strip transient signed previewUrl before chunking/committing (commit reads tempStoragePath/dataUrl)
      const stripPreviewUrl = <T extends { previewUrl?: string }>(m: T): Omit<T, "previewUrl"> => {
        const { previewUrl: _unused, ...rest } = m;
        void _unused;
        return rest;
      };
      const commitPayloadQuestions: ParsedQuestion[] = latestAll.map((q) => ({
        ...q,
        promptMedia: q.promptMedia?.map((m) =>
          stripPreviewUrl(m as typeof m & { previewUrl?: string }),
        ),
        explanationMedia: q.explanationMedia?.map((m) =>
          stripPreviewUrl(m as typeof m & { previewUrl?: string }),
        ),
        options: q.options.map((o) => ({
          ...o,
          media: o.media?.map((m) =>
            stripPreviewUrl(m as typeof m & { previewUrl?: string }),
          ),
        })),
      }));

      // Collect all unique staged `tempStoragePath` values across ALL chunks so the final
      // chunk cleans them cleanly once all earlier chunks have finished reading them (SEC-12).
      const allTempMediaPaths = Array.from(
        new Set(
          commitPayloadQuestions.flatMap((q) => [
            ...(q.promptMedia ?? [])
              .map((m) => m.tempStoragePath)
              .filter((p): p is string => Boolean(p)),
            ...(q.explanationMedia ?? [])
              .map((m) => m.tempStoragePath)
              .filter((p): p is string => Boolean(p)),
            ...q.options.flatMap((o) =>
              (o.media ?? [])
                .map((m) => m.tempStoragePath)
                .filter((p): p is string => Boolean(p)),
            ),
          ]),
        ),
      );

      // Keep every JSON commit chunk <= 2.5 MB and <= 500 questions across ALL formats
      // so multi-chunk commits never exceed Vercel Hobby's 4.5 MB request body cap.
      const chunks: ParsedQuestion[][] = buildVercelSafeCommitChunks(commitPayloadQuestions);
      const defaultTags = defaultTagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const batchId = commitBatchIdRef.current;
      const resumable =
        commitSessionRef.current?.batchId === batchId &&
        commitSessionRef.current.completedChunks < chunks.length
          ? commitSessionRef.current
          : null;

      const startChunkIndex = resumable ? resumable.completedChunks : 0;
      let importJobId = resumable?.importJobId;
      let totalImported = resumable?.totalImported ?? 0;
      let totalSkipped = resumable?.totalSkipped ?? 0;
      let totalReplaced = resumable?.totalReplaced ?? 0;
      let finalSetTotal = resumable?.finalSetTotal ?? 0;

      setStep(3);
      setCommitProgress({
        status: "committing",
        completedChunks: startChunkIndex,
        totalChunks: chunks.length,
        importedCount: totalImported,
        skippedCount: totalSkipped,
        replacedCount: totalReplaced,
        totalSetQuestions: finalSetTotal,
        errorMessage: null,
      });

      try {
        for (let i = startChunkIndex; i < chunks.length; i += 1) {
          const chunk = chunks[i];
          const idempotencyKey = `${batchId}-chunk-${i}`;
          const isFinalChunk = i === chunks.length - 1;

          const response = await fetch("/api/import/commit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              studySetId,
              idempotencyKey,
              importJobId,
              isFirstChunk: i === 0,
              isFinalChunk,
              tempMediaPathsToCleanup:
                isFinalChunk && allTempMediaPaths.length > 0
                  ? allTempMediaPaths
                  : undefined,
              sourceFormat: formatOverride ?? detectedFormat,
              fileName: parsedFileName,
              fileSizeBytes,
              answerRule,
              mode,
              duplicatePolicy,
              skipInvalidRows,
              defaultChapter: defaultChapter.trim() || undefined,
              defaultTags: defaultTags.length > 0 ? defaultTags : undefined,
              totalDetectedOverall: latestQuestionsRef.current.length,
              questions: chunk,
            }),
          });

          const payload = (await response.json()) as CommitApiResponse;
          if (!response.ok || !payload.data) {
            throw new Error(
              payload.error?.message ??
                (locale === "en"
                  ? `Batch ${i + 1} failed to save.`
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

          commitSessionRef.current = {
            batchId,
            importJobId,
            completedChunks: i + 1,
            totalImported,
            totalSkipped,
            totalReplaced,
            finalSetTotal,
          };

          setCommitProgress({
            status: isFinalChunk ? "completed" : "committing",
            completedChunks: i + 1,
            totalChunks: chunks.length,
            importedCount: totalImported,
            skippedCount: totalSkipped,
            replacedCount: totalReplaced,
            totalSetQuestions: finalSetTotal,
            errorMessage: null,
          });
        }

        // Invalidate all study set, question list, bundle, library & dashboard caches immediately
        // so returning to `/sets/[id]` NEVER shows stale `0 câu hỏi` (FUNC-12 / SEC-08)!
        await invalidateStudySetCaches(queryClient, studySetId);

        toast.success(
          locale === "en"
            ? `Imported ${totalImported.toLocaleString()} question(s) successfully.`
            : `Đã nhập thành công ${totalImported.toLocaleString()} câu hỏi.`,
        );
      } catch (err) {
        if (totalImported > 0 || totalReplaced > 0) {
          void invalidateStudySetCaches(queryClient, studySetId);
        }
        const msg =
          err instanceof Error
            ? err.message
            : locale === "en"
              ? "Import failed while saving."
              : "Quá trình lưu dữ liệu gặp lỗi.";
        setCommitProgress((prev) => ({
          ...prev,
          status: "error",
          errorMessage: msg,
        }));
        toast.error(msg);
      } finally {
        committingRef.current = false;
      }
    },
    [
      answerRule,
      defaultChapter,
      defaultTagsText,
      detectedFormat,
      duplicatePolicy,
      fileSizeBytes,
      filterReadyQuestions,
      flushBatchRevalidation,
      formatOverride,
      locale,
      mode,
      parsedFileName,
      queryClient,
      skipInvalidRows,
      studySetId,
    ],
  );

  const handleRequestImport = React.useCallback(() => {
    if (committingRef.current) return;
    const flushed = flushBatchRevalidation();
    const activeRows = filterReadyQuestions(flushed);
    if (activeRows.length === 0) return;

    if (mode === "replace") {
      setConfirmReplaceOpen(true);
      return;
    }
    void executeCommit(activeRows);
  }, [executeCommit, filterReadyQuestions, flushBatchRevalidation, mode]);

  const handleImportAnother = React.useCallback(() => {
    parseRequestIdRef.current += 1;
    parseAbortControllerRef.current?.abort();
    setIsParsing(false);
    setSelectedFile(null);
    setRawText("");
    setQuestions([]);
    latestQuestionsRef.current = [];
    setSummary(EMPTY_SUMMARY);
    setDetectedChapters([]);
    setFormatOverride(undefined);
    setSelectedSheet(undefined);
    setHeaderRowCount(undefined);
    setColumnMapping(EMPTY_MAPPING);
    setAnswerRule({ mode: "auto" });
    setMode("append");
    setDuplicatePolicy("skip");
    setSkipInvalidRows(false);
    setIsScannedPdf(false);
    setParseError(null);
    setAdvancedOpen(false);
    setCommitProgress(IDLE_COMMIT_PROGRESS);
    const nextVer = sourceVersionRef.current + 1;
    sourceVersionRef.current = nextVer;
    setSourceVersion(nextVer);
    lastParsedKeyRef.current = null;
    commitBatchIdRef.current = crypto.randomUUID();
    commitSessionRef.current = null;
    setStep(1);
  }, []);

  const activeFormat = formatOverride ?? detectedFormat;
  const activeStepMeta = steps[step - 1] ?? steps[0];
  const progressPercent = Math.round((step / steps.length) * 100);

  const importButtonLabel =
    mode === "replace"
      ? locale === "en"
        ? `Replace & Import ${readyToImportQuestions.length.toLocaleString()} Question(s)`
        : `Thay thế & Nhập ${readyToImportQuestions.length.toLocaleString()} câu hỏi`
      : locale === "en"
        ? `Import ${readyToImportQuestions.length.toLocaleString()} Question(s)`
        : `Nhập ${readyToImportQuestions.length.toLocaleString()} câu hỏi`;

  return (
    <div className="mx-auto w-full max-w-5xl min-w-0 space-y-5">
      {/* Top Breadcrumb & Heading */}
      <div className="min-w-0">
        <Link
          href={`/sets/${studySetId}`}
          className="mb-1 inline-flex max-w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{studySetTitle}</span>
        </Link>
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {locale === "en" ? "Import Questions" : "Nhập câu hỏi vào học phần"}
        </h1>
      </div>

      {/* Responsive 3-Step Progress Indicator (0px horizontal overflow at 320px/360px/390px) */}
      <nav
        aria-label={locale === "en" ? "Import progress" : "Tiến trình nhập dữ liệu"}
        className="w-full min-w-0"
      >
        {/* Mobile compact progress bar (< sm) */}
        <div className="space-y-2 rounded-xl border border-border bg-card p-3 sm:hidden">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-primary tabular-nums">
              {locale === "en" ? `Step ${step} / 3` : `Bước ${step} / 3`}
            </span>
            <span className="min-w-0 truncate font-medium text-foreground">
              {activeStepMeta.title}
            </span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={step}
            aria-valuemin={1}
            aria-valuemax={3}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Desktop & Tablet 3-pill strip (sm+) */}
        <ol className="hidden grid-cols-3 gap-2 sm:grid">
          {steps.map((s) => {
            const isActive = step === s.step;
            const isCompleted = step > s.step;
            const canGoBack =
              s.step < step &&
              commitProgress.status !== "committing" &&
              !(step === 3 && commitProgress.status === "completed");

            return (
              <li key={s.step} className="min-w-0">
                <button
                  type="button"
                  aria-current={isActive ? "step" : undefined}
                  disabled={!canGoBack}
                  onClick={() => canGoBack && setStep(s.step)}
                  className={cn(
                    "flex min-h-[44px] w-full min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive &&
                      "border-primary/50 bg-primary/5 font-semibold text-foreground",
                    isCompleted &&
                      canGoBack &&
                      "border-border bg-card text-primary hover:bg-muted/60",
                    isCompleted &&
                      !canGoBack &&
                      "border-border bg-card text-muted-foreground",
                    !isActive &&
                      !isCompleted &&
                      "cursor-not-allowed border-border/60 bg-muted/20 text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                      isCompleted && "border-primary bg-primary text-primary-foreground",
                      isActive && "border-primary bg-primary/10 text-primary",
                      !isActive &&
                        !isCompleted &&
                        "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {isCompleted ? (
                      <Check className="size-3.5" aria-hidden="true" />
                    ) : (
                      s.step
                    )}
                  </span>
                  <span className="min-w-0 truncate">{s.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Step 1: Choose File or Paste Content */}
      {step === 1 && (
        <StepSourceInput
          locale={locale}
          sourceMode={sourceMode}
          onSourceModeChange={(m) => {
            setSourceMode(m);
            const nextVer = sourceVersionRef.current + 1;
            sourceVersionRef.current = nextVer;
            setSourceVersion(nextVer);
            lastParsedKeyRef.current = null;
          }}
          selectedFile={selectedFile}
          onSelectFile={(f) => {
            void handleSelectFile(f);
          }}
          rawText={rawText}
          onRawTextChange={(txt) => {
            setRawText(txt);
            const nextVer = sourceVersionRef.current + 1;
            sourceVersionRef.current = nextVer;
            setSourceVersion(nextVer);
            lastParsedKeyRef.current = null;
          }}
          isParsing={isParsing}
          errorMessage={parseError}
          headingRef={handleStepHeadingMount}
          onContinue={async () => {
            const data = await runServerParse(undefined, { resetMapping: true });
            if (data) {
              openStep2WithResult(data);
            }
          }}
        />
      )}

      {/* Step 2: Preview & Confirm (Target Set + Ready CTA + Collapsible Advanced Options + Inline Edit) */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Compact Top Readiness & Action Banner */}
          <Card>
            <CardContent className="space-y-3.5 p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <h2
                    ref={handleStepHeadingMount}
                    data-import-step="2"
                    tabIndex={-1}
                    className="rounded-sm text-base font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-lg"
                  >
                    {locale === "en" ? "Preview & Confirm" : "Xem trước & Xác nhận nhập"}
                  </h2>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="inline-flex max-w-full items-center gap-1 font-medium text-foreground">
                      <FileCheck2 className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                      <span className="truncate">{parsedFileName}</span>
                    </span>
                    <span aria-hidden="true">·</span>
                    <Badge variant="secondary" className="max-w-full truncate text-[11px] font-normal">
                      {getFormatLabel(activeFormat, locale)}
                    </Badge>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">
                      {locale === "en" ? `Into: ${studySetTitle}` : `Vào: ${studySetTitle}`}
                    </span>
                  </div>
                </div>

                {/* Top Primary Import CTA for instant 2-click happy path */}
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
                  <Button
                    type="button"
                    size="lg"
                    variant={mode === "replace" ? "destructive" : "default"}
                    className="min-h-[44px] w-full sm:w-auto"
                    disabled={
                      isParsing ||
                      blockedByErrors ||
                      readyToImportQuestions.length === 0
                    }
                    onClick={handleRequestImport}
                  >
                    <UploadCloud className="mr-2 size-4" aria-hidden="true" />
                    {importButtonLabel}
                  </Button>
                </div>
              </div>

              {/* Scanned PDF Honest Alert */}
              {isScannedPdf && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-warning/50 bg-warning-subtle p-3 text-xs text-warning-subtle-foreground sm:text-sm"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">
                    {locale === "en"
                      ? "This PDF appears to be scanned / image-only with no selectable text layer. StudyHub does not run AI OCR — please convert it to a text-layer PDF or Word (.docx) before importing."
                      : "Tệp PDF này là bản quét (chỉ gồm hình ảnh), không có văn bản để trích xuất. StudyHub không sử dụng AI OCR — vui lòng chuyển sang tệp Word (.docx) hoặc PDF có văn bản rồi tải lại."}
                  </span>
                </div>
              )}

              {/* Ready vs Attention Banner */}
              {!isScannedPdf && summary.errorCount === 0 && readyToImportQuestions.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success-subtle px-3 py-2 text-xs text-success-subtle-foreground sm:text-sm">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    {locale === "en"
                      ? `${readyToImportQuestions.length.toLocaleString()} question(s) detected cleanly with 0 errors. Tap any option below to adjust answers, or import right away.`
                      : `Đã nhận diện ${readyToImportQuestions.length.toLocaleString()} câu hỏi hợp lệ, không có lỗi. Bạn có thể bấm trực tiếp vào đáp án bên dưới để chỉnh nhanh hoặc nhập ngay.`}
                  </span>
                </div>
              )}

              {!isScannedPdf && blockedByErrors && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive sm:text-sm"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">
                    {locale === "en"
                      ? `${summary.errorCount.toLocaleString()} question(s) need attention. Click any option below to mark the correct answer, open "Advanced Options" to switch detection rules, or enable "Skip invalid rows".`
                      : `Có ${summary.errorCount.toLocaleString()} câu cần kiểm tra. Bấm vào lựa chọn bên dưới để chọn đáp án đúng, mở "Tùy chọn nâng cao" để đổi quy tắc nhận diện hoặc bật "Bỏ qua câu còn lỗi".`}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Collapsible Native <details> Advanced Options (Format, Columns, Answer Rules, Duplicate Policy) */}
          <details
            open={advancedOpen}
            onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
            className="group rounded-xl border border-border bg-card"
          >
            <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
              <span className="inline-flex min-w-0 items-center gap-2">
                <SlidersHorizontal
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="truncate">
                  {locale === "en"
                    ? "Advanced options (Format, Columns, Answer Rules & Save Mode)"
                    : "Tùy chọn nâng cao (Định dạng, Cột, Quy tắc đáp án & Trùng lặp)"}
                </span>
              </span>
              <ChevronDown
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="space-y-6 border-t border-border p-4 sm:p-5">
              <FormatConfigSection
                locale={locale}
                detectedFormat={detectedFormat}
                formatOverride={formatOverride}
                onFormatOverrideChange={(fmt) => {
                  setFormatOverride(fmt);
                  setColumnMapping(EMPTY_MAPPING);
                  lastParsedKeyRef.current = null;
                  void runServerParse(
                    { formatOverride: fmt },
                    { force: true, resetMapping: true },
                  );
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
                onApplyReparse={() => {
                  void runServerParse(undefined, { force: true });
                }}
              />

              <div className="border-t border-border pt-5">
                <AnswerRuleSection
                  locale={locale}
                  activeFormat={activeFormat}
                  answerRule={answerRule}
                  onAnswerRuleChange={(nextRule) => {
                    setAnswerRule(nextRule);
                    void runServerParse({ answerRule: nextRule }, { force: true });
                  }}
                  isParsing={isParsing}
                />
              </div>

              <div className="border-t border-border pt-5">
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
                  embedded={true}
                />
              </div>
            </div>
          </details>

          {/* Unified Virtualized Preview & Inline Editing (with DOCX multimedia reassignment) */}
          <VirtualizedPreviewList
            locale={locale}
            questions={questions}
            summary={summary}
            detectedChapters={detectedChapters}
            allowInlineEdit={true}
            onUpdateQuestion={handleUpdateQuestion}
            onMoveMediaToQuestion={handleMoveMediaToQuestion}
          />

          {/* Bottom Action Bar */}
          <div className="flex flex-col-reverse gap-2.5 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px] w-full sm:w-auto"
              disabled={isParsing}
              onClick={() => setStep(1)}
            >
              <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
              {locale === "en" ? "Choose Another Source" : "Chọn tệp / nội dung khác"}
            </Button>
            <Button
              type="button"
              size="lg"
              variant={mode === "replace" ? "destructive" : "default"}
              className="min-h-[44px] w-full sm:w-auto"
              disabled={
                isParsing ||
                blockedByErrors ||
                readyToImportQuestions.length === 0
              }
              onClick={handleRequestImport}
            >
              <UploadCloud className="mr-2 size-4" aria-hidden="true" />
              {importButtonLabel}
            </Button>
          </div>

          <ReplaceConfirmDialog
            open={confirmReplaceOpen}
            onOpenChange={setConfirmReplaceOpen}
            locale={locale}
            studySetTitle={studySetTitle}
            existingQuestionCount={existingQuestionCount}
            readyCount={readyToImportQuestions.length}
            onConfirm={() => {
              void executeCommit();
            }}
          />
        </div>
      )}

      {/* Step 3: Saving Progress & Completion */}
      {step === 3 && (
        <StepCommit
          locale={locale}
          studySetId={studySetId}
          studySetTitle={studySetTitle}
          progress={commitProgress}
          headingRef={handleStepHeadingMount}
          onBack={() => setStep(2)}
          onRetryCommit={() => {
            void executeCommit();
          }}
          onImportAnother={handleImportAnother}
        />
      )}
    </div>
  );
}
