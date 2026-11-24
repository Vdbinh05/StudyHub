"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Folder as FolderIcon,
  Layers,
  Loader2,
  Play,
  Scale,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { lText } from "@/components/learning/learning-copy";
import { useI18n } from "@/lib/i18n";
import { useUserPreferences } from "@/lib/preferences";
import {
  createCoverageCycleApi,
  createExamAttempt,
  createExamPreset,
  fetchAccessibleFolders,
  fetchAccessibleSets,
  fetchExamAttempt,
  fetchExamEligiblePool,
  fetchExamPreset,
  previewExamConfig,
} from "@/lib/learning/api-client";
import {
  computeExamAllocation,
  suggestCustomCounts,
  suggestEqualWeights,
  validateQuestionCount,
  type AllocationSubjectInput,
} from "@/lib/learning/exam-allocator";
import { planCoverageSeries } from "@/lib/learning/coverage-engine";
import type {
  AllocationStrategy,
  DifficultyLevel,
  ExamEligiblePool,
  ExamFilterConfig,
  ExamPreset,
  ExamPreviewResult,
  ExamQuestionType,
  ExamSourceInput,
  Folder,
  SelectionPolicy,
  StudySet,
} from "@/types/domain";
import { cn } from "@/lib/utils";
import { CoverageCyclesSection } from "./CoverageCyclesSection";
import {
  ExamPresetsSection,
  getAllocationLabel,
  getPolicyLabel,
} from "./ExamPresetsSection";

const QUESTION_COUNT_PRESETS = [20, 50, 100, 250] as const;
const DURATION_PRESETS = [15, 30, 45, 60, 90, 120, 180] as const;
const COVERAGE_BATCH_PRESETS = [50, 100, 120, 200, 250] as const;

const ALL_EXAM_TYPES: ExamQuestionType[] = [
  "single_choice",
  "multiple_choice",
  "true_false",
  "short_answer",
  "fill_in_blank",
  "numerical",
  "image_choice",
  "ordering",
  "matching",
  "image_hotspot",
  "reading_passage",
  "listening",
];

const EXAM_TYPE_LABELS: Record<ExamQuestionType, { vi: string; en: string }> = {
  single_choice: { vi: "1 đáp án", en: "Single Choice" },
  multiple_choice: { vi: "Nhiều đáp án", en: "Multi-Select" },
  true_false: { vi: "Đúng / Sai", en: "True / False" },
  short_answer: { vi: "Trả lời ngắn", en: "Short Answer" },
  fill_in_blank: { vi: "Điền chỗ trống", en: "Fill in Blank" },
  numerical: { vi: "Tính toán số", en: "Numerical" },
  image_choice: { vi: "Chọn hình ảnh", en: "Image Choice" },
  ordering: { vi: "Sắp xếp thứ tự", en: "Ordering" },
  matching: { vi: "Ghép cặp", en: "Matching" },
  image_hotspot: { vi: "Điểm trên ảnh", en: "Image Hotspot" },
  reading_passage: { vi: "Đọc hiểu", en: "Reading Passage" },
  listening: { vi: "Nghe hiểu", en: "Listening" },
};
const ALL_DIFFICULTIES: DifficultyLevel[] = ["easy", "medium", "hard"];

const ALLOCATION_STRATEGIES: AllocationStrategy[] = [
  "proportional",
  "equal",
  "global_random",
  "custom",
  "weighted",
];

const SELECTION_POLICIES: SelectionPolicy[] = [
  "random",
  "unseen_first",
  "mistakes_first",
  "weak_topics_first",
  "due_for_review",
  "starred_only",
  "incorrect_only",
  "anti_repeat",
];

function getDescendantFolderIds(
  rootId: string,
  folders: readonly Folder[],
): Set<string> {
  const visited = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const f of folders) {
      if (f.parent_id === curr && !visited.has(f.id)) {
        visited.add(f.id);
        queue.push(f.id);
      }
    }
  }
  return visited;
}

export interface CustomExamBuilderClientProps {
  initialSetId?: string;
  /** True when embedded inside FocusModeShell (e.g. /sets/[id]/test) so heading renders as h2 and mobile sticky bar anchors at bottom-0 */
  embedded?: boolean;
}

export function CustomExamBuilderClient({
  initialSetId,
  embedded = false,
}: CustomExamBuilderClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { locale } = useI18n();
  const { preferences } = useUserPreferences();

  const urlTab = searchParams.get("tab");
  const urlSetId = initialSetId ?? searchParams.get("setId");
  const urlSetIds = searchParams.get("setIds");
  const urlFolderId = searchParams.get("folderId");
  const urlPresetId = searchParams.get("presetId");
  const urlMode = searchParams.get("mode");
  const urlPolicy = searchParams.get("policy") as SelectionPolicy | null;
  const urlCoverage = searchParams.get("coverage") === "1";
  const urlSourceAttemptId =
    searchParams.get("sourceAttemptId") ?? searchParams.get("cloneAttemptId");

  const [activeTab, setActiveTab] = React.useState<string>(() => {
    if (urlTab === "presets" || urlTab === "coverage") return urlTab;
    return "builder";
  });

  // Sources
  const [selectedFolderIds, setSelectedFolderIds] = React.useState<string[]>(() =>
    urlFolderId ? [urlFolderId] : [],
  );
  const [selectedSetIds, setSelectedSetIds] = React.useState<string[]>(() => {
    const ids: string[] = [];
    if (urlSetId) ids.push(urlSetId);
    if (urlSetIds) {
      for (const id of urlSetIds.split(",").map((s) => s.trim()).filter(Boolean)) {
        if (!ids.includes(id)) ids.push(id);
      }
    }
    return ids;
  });
  const [expandedFolderIds, setExpandedFolderIds] = React.useState<Set<string>>(
    new Set(),
  );
  const [sourceSearch, setSourceSearch] = React.useState("");

  // Fine filters
  const [selectedChapters, setSelectedChapters] = React.useState<string[]>([]);
  const [selectedTagIds, setSelectedTagIds] = React.useState<string[]>([]);
  const [selectedDifficulties, setSelectedDifficulties] =
    React.useState<DifficultyLevel[]>([]);
  const [selectedQuestionTypes, setSelectedQuestionTypes] =
    React.useState<ExamQuestionType[]>([]);

  // Exam sizing, allocation, selection policy, coverage
  const [examTitle, setExamTitle] = React.useState("");
  const [useAllQuestions, setUseAllQuestions] = React.useState(false);
  const [questionCountInput, setQuestionCountInput] = React.useState("50");
  const [countEditedAtPool, setCountEditedAtPool] = React.useState<
    number | null
  >(null);
  const [allocationStrategy, setAllocationStrategy] =
    React.useState<AllocationStrategy>("proportional");
  const [customCounts, setCustomCounts] = React.useState<Record<string, string>>(
    {},
  );
  const [weightInputs, setWeightInputs] = React.useState<Record<string, string>>(
    {},
  );
  const [confirmedRedistributionKey, setConfirmedRedistributionKey] =
    React.useState<string | null>(null);

  const [selectionPolicy, setSelectionPolicy] = React.useState<SelectionPolicy>(
    () => {
      if (urlMode === "mistakes") return "incorrect_only";
      if (urlMode === "starred") return "starred_only";
      if (urlPolicy && SELECTION_POLICIES.includes(urlPolicy)) return urlPolicy;
      return "random";
    },
  );

  // Full Coverage Mode
  const [fullCoverageMode, setFullCoverageMode] =
    React.useState<boolean>(urlCoverage);
  const [coverageBatchInput, setCoverageBatchInput] = React.useState("250");
  const [coverageTitle, setCoverageTitle] = React.useState("");

  // Time & behavior
  const [isTimed, setIsTimed] = React.useState(true);
  const [durationMinutesInput, setDurationMinutesInput] = React.useState("45");
  const [passScoreInput, setPassScoreInput] = React.useState("70");
  const [shuffleQuestions, setShuffleQuestions] = React.useState<boolean>(
    () => preferences.default_shuffle_questions,
  );
  const [shuffleOptions, setShuffleOptions] = React.useState<boolean>(
    () => preferences.default_shuffle_options,
  );
  const [showSubjectNames, setShowSubjectNames] = React.useState(true);
  const [showChapterNames, setShowChapterNames] = React.useState(true);
  const [allowNavigation, setAllowNavigation] = React.useState(true);
  const [allowMarkForReview, setAllowMarkForReview] = React.useState(true);
  const [autoSubmitOnExpire, setAutoSubmitOnExpire] = React.useState(true);
  const [showReviewAfterSubmit, setShowReviewAfterSubmit] = React.useState(true);

  // Preset Save Modal
  const [savePresetOpen, setSavePresetOpen] = React.useState(false);
  const [presetNameDraft, setPresetNameDraft] = React.useState("");
  const [presetDescDraft, setPresetDescDraft] = React.useState("");
  const [presetFavoriteDraft, setPresetFavoriteDraft] = React.useState(false);
  const [isSavingPreset, setIsSavingPreset] = React.useState(false);

  // Launch states
  const [isLaunching, setIsLaunching] = React.useState(false);
  const [loadedPresetId, setLoadedPresetId] = React.useState<string | null>(
    urlPresetId,
  );

  const hydratedExternalRef = React.useRef(false);

  // Sync user preferences defaults once loaded if user hasn't modified
  const syncedPrefsRef = React.useRef(false);
  React.useEffect(() => {
    if (syncedPrefsRef.current) return;
    syncedPrefsRef.current = true;
    setShuffleQuestions(preferences.default_shuffle_questions);
    setShuffleOptions(preferences.default_shuffle_options);
  }, [preferences.default_shuffle_options, preferences.default_shuffle_questions]);

  // Fetch accessible study sets and folders
  const setsQuery = useQuery({
    queryKey: ["accessible-sets-all"],
    queryFn: () => fetchAccessibleSets(),
    staleTime: 60_000,
  });

  const foldersQuery = useQuery({
    queryKey: ["accessible-folders-all"],
    queryFn: fetchAccessibleFolders,
    staleTime: 60_000,
  });

  const allSets = React.useMemo(
    () => (setsQuery.data ?? []).filter((s) => !s.is_archived),
    [setsQuery.data],
  );
  const totalLibraryQuestions = React.useMemo(
    () => allSets.reduce((sum, s) => sum + (s.question_count ?? 0), 0),
    [allSets],
  );
  const allFolders = React.useMemo(
    () => foldersQuery.data ?? [],
    [foldersQuery.data],
  );

  const hydrateFromPreset = React.useCallback((preset: ExamPreset) => {
    setLoadedPresetId(preset.id);
    setExamTitle(preset.name);
    const fIds: string[] = [];
    const sIds: string[] = [];
    const nextCustom: Record<string, string> = {};
    const nextWeight: Record<string, string> = {};

    for (const src of preset.sources ?? []) {
      if (src.source_type === "folder" && src.folder_id) {
        fIds.push(src.folder_id);
      } else if (src.source_type === "study_set" && src.study_set_id) {
        sIds.push(src.study_set_id);
        if (src.custom_count !== null && src.custom_count !== undefined) {
          nextCustom[src.study_set_id] = String(src.custom_count);
        }
        if (src.custom_percentage !== null && src.custom_percentage !== undefined) {
          nextWeight[src.study_set_id] = String(src.custom_percentage);
        }
      }
    }

    setSelectedFolderIds(fIds);
    setSelectedSetIds(sIds);
    setCustomCounts(nextCustom);
    setWeightInputs(nextWeight);
    setAllocationStrategy(preset.allocation_strategy);
    setSelectionPolicy(preset.selection_policy);
    setFullCoverageMode(Boolean(preset.full_coverage_mode));

    if (preset.requested_question_count === null) {
      setUseAllQuestions(true);
    } else {
      setUseAllQuestions(false);
      setQuestionCountInput(String(preset.requested_question_count));
      setCountEditedAtPool(null);
    }

    if (preset.duration_limit_seconds === null) {
      setIsTimed(false);
    } else {
      setIsTimed(true);
      setDurationMinutesInput(
        String(Math.max(1, Math.round(preset.duration_limit_seconds / 60))),
      );
    }

    setPassScoreInput(String(preset.pass_threshold));
    setShuffleQuestions(preset.shuffle_questions);
    setShuffleOptions(preset.shuffle_options);
    setShowSubjectNames(preset.show_subject_names);
    setShowChapterNames(preset.show_chapter_names);
    setAllowNavigation(preset.allow_navigation);
    setAllowMarkForReview(preset.allow_mark_for_review);
    setAutoSubmitOnExpire(preset.auto_submit_on_expire);
    setShowReviewAfterSubmit(preset.show_review_after_submit);
    setSelectedChapters(preset.filters?.chapters ?? []);
    setSelectedTagIds(preset.filters?.tag_ids ?? []);
    setSelectedDifficulties(preset.filters?.difficulties ?? []);
    setSelectedQuestionTypes(preset.filters?.question_types ?? []);
    setActiveTab("builder");
  }, []);

  // Hydrate from ?presetId= or ?sourceAttemptId= / ?cloneAttemptId=
  React.useEffect(() => {
    if (hydratedExternalRef.current) return;
    if (urlPresetId) {
      hydratedExternalRef.current = true;
      fetchExamPreset(urlPresetId)
        .then((preset) => hydrateFromPreset(preset))
        .catch(() => {});
      return;
    }
    if (urlSourceAttemptId) {
      hydratedExternalRef.current = true;
      fetchExamAttempt(urlSourceAttemptId)
        .then((payload) => {
          const sourceIds = new Set<string>();
          for (const s of payload.sources ?? []) {
            if (s.study_set_id) sourceIds.add(s.study_set_id);
          }
          for (const q of payload.questions ?? []) {
            if (q.source_study_set_id) sourceIds.add(q.source_study_set_id);
          }
          if (payload.attempt.study_set_id) {
            sourceIds.add(payload.attempt.study_set_id);
          }
          for (const extra of payload.attempt.config?.additional_study_set_ids ?? []) {
            sourceIds.add(extra);
          }
          if (sourceIds.size > 0) {
            setSelectedSetIds(Array.from(sourceIds));
          }
          if (payload.attempt.allocation_strategy) {
            setAllocationStrategy(payload.attempt.allocation_strategy);
          }
          if (!urlMode && !urlPolicy && payload.attempt.selection_policy) {
            setSelectionPolicy(payload.attempt.selection_policy);
          }
          if (payload.attempt.duration_limit_seconds === null) {
            setIsTimed(false);
          } else if (payload.attempt.duration_limit_seconds) {
            setIsTimed(true);
            setDurationMinutesInput(
              String(Math.round(payload.attempt.duration_limit_seconds / 60)),
            );
          }
          setPassScoreInput(String(payload.attempt.pass_threshold));
        })
        .catch(() => {});
    }
  }, [hydrateFromPreset, urlMode, urlPolicy, urlPresetId, urlSourceAttemptId]);

  // Compute sets implicitly included via selected folders (for visual deduplication clarity!)
  const setsCoveredBySelectedFolders = React.useMemo(() => {
    const covered = new Set<string>();
    for (const fId of selectedFolderIds) {
      const desc = getDescendantFolderIds(fId, allFolders);
      for (const s of allSets) {
        if (s.folder_id && desc.has(s.folder_id)) {
          covered.add(s.id);
        }
      }
    }
    return covered;
  }, [allFolders, allSets, selectedFolderIds]);

  // Effective deduplicated set IDs (folder expansion + direct selection)
  const effectiveSelectedSetIds = React.useMemo(() => {
    const merged = new Set<string>(selectedSetIds);
    for (const id of setsCoveredBySelectedFolders) {
      merged.add(id);
    }
    return Array.from(merged);
  }, [selectedSetIds, setsCoveredBySelectedFolders]);

  const overlapCountLocal = React.useMemo(() => {
    let count = 0;
    for (const id of selectedSetIds) {
      if (setsCoveredBySelectedFolders.has(id)) count += 1;
    }
    return count;
  }, [selectedSetIds, setsCoveredBySelectedFolders]);

  const filtersPayload = React.useMemo<ExamFilterConfig>(() => {
    const f: ExamFilterConfig = {};
    if (selectedChapters.length > 0) f.chapters = selectedChapters;
    if (selectedTagIds.length > 0) f.tag_ids = selectedTagIds;
    if (selectedDifficulties.length > 0) f.difficulties = selectedDifficulties;
    if (selectedQuestionTypes.length > 0) f.question_types = selectedQuestionTypes;
    return f;
  }, [
    selectedChapters,
    selectedDifficulties,
    selectedQuestionTypes,
    selectedTagIds,
  ]);

  // Build sources payload for eligible/preview/create endpoints
  const sourcesPayload = React.useMemo<ExamSourceInput[]>(() => {
    const list: ExamSourceInput[] = [];
    for (const fId of selectedFolderIds) {
      list.push({
        source_type: "folder",
        id: fId,
        include_subfolders: true,
      });
    }
    // Include explicit study sets (plus per-set custom_count / custom_percentage overrides)
    const setIdsToInclude = new Set<string>(selectedSetIds);
    if (allocationStrategy === "custom" || allocationStrategy === "weighted") {
      for (const id of effectiveSelectedSetIds) {
        setIdsToInclude.add(id);
      }
    }

    for (const sId of setIdsToInclude) {
      const cVal = Number(customCounts[sId]);
      const wVal = Number(weightInputs[sId]);
      list.push({
        source_type: "study_set",
        id: sId,
        custom_count:
          allocationStrategy === "custom" &&
          customCounts[sId] !== undefined &&
          customCounts[sId].trim() !== "" &&
          Number.isFinite(cVal)
            ? cVal
            : null,
        custom_percentage:
          allocationStrategy === "weighted" &&
          weightInputs[sId] !== undefined &&
          weightInputs[sId].trim() !== "" &&
          Number.isFinite(wVal)
            ? wVal
            : null,
      });
    }
    return list;
  }, [
    allocationStrategy,
    customCounts,
    effectiveSelectedSetIds,
    selectedFolderIds,
    selectedSetIds,
    weightInputs,
  ]);

  // Debounced signature for server eligible pool & preview queries
  const [debouncedQueryKey, setDebouncedQueryKey] = React.useState("");
  const liveSignature = React.useMemo(
    () =>
      JSON.stringify({
        f: selectedFolderIds,
        s: selectedSetIds,
        p: selectionPolicy,
        flt: filtersPayload,
      }),
    [filtersPayload, selectedFolderIds, selectedSetIds, selectionPolicy],
  );

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedQueryKey(liveSignature), 200);
    return () => clearTimeout(timer);
  }, [liveSignature]);

  const hasAnySource =
    selectedFolderIds.length > 0 || selectedSetIds.length > 0;

  // Live server eligible pool (`POST /api/exams/eligible`)
  const eligibleQuery = useQuery<ExamEligiblePool>({
    queryKey: ["exam-eligible", debouncedQueryKey],
    queryFn: () =>
      fetchExamEligiblePool({
        folder_ids: selectedFolderIds,
        study_set_ids: selectedSetIds,
        include_subfolders: true,
        selection_policy: selectionPolicy,
        filters: filtersPayload,
      }),
    enabled: hasAnySource && debouncedQueryKey === liveSignature,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });

  const eligibleSubjects = eligibleQuery.data?.subjects;

  // Fallback subject summary from accessible sets before eligible endpoint responds
  const effectiveSubjects = React.useMemo<AllocationSubjectInput[]>(() => {
    if (eligibleSubjects) {
      return eligibleSubjects.map((sub) => {
        const rawC = customCounts[sub.study_set_id];
        const rawW = weightInputs[sub.study_set_id];
        return {
          subjectId: sub.study_set_id,
          title: sub.title,
          availableCount: sub.eligible_count,
          customCount:
            rawC !== undefined && rawC.trim() !== "" ? Number(rawC) : 0,
          weightPercent:
            rawW !== undefined && rawW.trim() !== "" ? Number(rawW) : 0,
        };
      });
    }

    const setMap = new Map<string, StudySet>();
    for (const s of allSets) setMap.set(s.id, s);

    return effectiveSelectedSetIds
      .map((id) => setMap.get(id))
      .filter((s): s is StudySet => Boolean(s))
      .map((s) => {
        const rawC = customCounts[s.id];
        const rawW = weightInputs[s.id];
        return {
          subjectId: s.id,
          title: s.title,
          availableCount: s.question_count,
          customCount:
            rawC !== undefined && rawC.trim() !== "" ? Number(rawC) : 0,
          weightPercent:
            rawW !== undefined && rawW.trim() !== "" ? Number(rawW) : 0,
        };
      });
  }, [
    allSets,
    customCounts,
    effectiveSelectedSetIds,
    eligibleSubjects,
    weightInputs,
  ]);

  const totalEligible =
    eligibleQuery.data?.total_eligible ??
    effectiveSubjects.reduce((sum, s) => sum + s.availableCount, 0);

  // UX-12: Auto-clamp untouched/stale positive integer question count when the eligible pool
  // loads or shrinks below it (e.g., selecting only a 24Q set while default is 50), while still
  // strictly rejecting explicit out-of-range edits typed against the current pool size.
  const resolvedQuestionCountInput = React.useMemo(() => {
    if (useAllQuestions || totalEligible <= 0) return questionCountInput;
    if (countEditedAtPool === totalEligible) return questionCountInput;
    const trimmed = questionCountInput.trim();
    if (/^\d+$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isSafeInteger(parsed) && parsed > totalEligible) {
        return String(totalEligible);
      }
    }
    return questionCountInput;
  }, [countEditedAtPool, questionCountInput, totalEligible, useAllQuestions]);

  const requestedCountRaw: unknown = useAllQuestions
    ? totalEligible
    : resolvedQuestionCountInput;

  const countValidation = React.useMemo(
    () => validateQuestionCount(requestedCountRaw, totalEligible, 1000),
    [requestedCountRaw, totalEligible],
  );

  // Local instant deterministic allocation computation (always in sync with 5 strategies A-E)
  const localAllocation = React.useMemo(
    () =>
      computeExamAllocation({
        strategy: allocationStrategy,
        subjects: effectiveSubjects,
        requestedCount: requestedCountRaw,
        maxTechnicalLimit: 1000,
      }),
    [allocationStrategy, effectiveSubjects, requestedCountRaw],
  );

  // Derive redistribution confirmation from signature so changing strategy/quotas auto-invalidates without effect setState
  const redistributionKey = React.useMemo(
    () =>
      `${allocationStrategy}:${JSON.stringify(
        localAllocation.allocations.map((a) => [a.subjectId, a.allocatedCount]),
      )}`,
    [allocationStrategy, localAllocation.allocations],
  );
  const redistributionConfirmed =
    confirmedRedistributionKey === redistributionKey;

  // Seed default custom counts / equal 100% weights when user switches to Custom or Weighted
  const handleStrategyChange = (next: AllocationStrategy) => {
    setAllocationStrategy(next);
    const subjectIds = effectiveSubjects.map((s) => s.subjectId);
    if (next === "custom" && subjectIds.length > 0) {
      const target = countValidation.value ?? Math.min(50, totalEligible);
      const suggested = suggestCustomCounts(effectiveSubjects, target);
      const draft: Record<string, string> = {};
      for (const [id, c] of Object.entries(suggested)) draft[id] = String(c);
      setCustomCounts(draft);
    } else if (next === "weighted" && subjectIds.length > 0) {
      const equalW = suggestEqualWeights(subjectIds);
      const draft: Record<string, string> = {};
      for (const [id, w] of Object.entries(equalW)) draft[id] = String(w);
      setWeightInputs(draft);
    }
  };

  // Parsed duration & pass threshold
  const parsedDurationMinutes = React.useMemo(() => {
    if (!isTimed) return null;
    const n = Number(durationMinutesInput.trim());
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.min(1440, Math.round(n));
  }, [durationMinutesInput, isTimed]);

  const parsedDurationSeconds =
    parsedDurationMinutes !== null ? parsedDurationMinutes * 60 : null;

  const parsedPassScore = React.useMemo(() => {
    const n = Number(passScoreInput.trim());
    if (!Number.isFinite(n) || !Number.isInteger(n)) return 70;
    return Math.min(100, Math.max(1, n));
  }, [passScoreInput]);

  const parsedCoverageBatch = React.useMemo(() => {
    const n = Number(coverageBatchInput.trim());
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
    return Math.min(2000, n);
  }, [coverageBatchInput]);

  const coveragePlan = React.useMemo(
    () =>
      fullCoverageMode && parsedCoverageBatch
        ? planCoverageSeries(totalEligible, parsedCoverageBatch)
        : null,
    [fullCoverageMode, parsedCoverageBatch, totalEligible],
  );

  // Server-validated preview (`POST /api/exams/preview`) — zero answer leakage!
  const previewSignature = React.useMemo(
    () =>
      JSON.stringify({
        sources: sourcesPayload,
        count: fullCoverageMode
          ? parsedCoverageBatch ?? 1
          : countValidation.value ?? 0,
        strategy: allocationStrategy,
        policy: selectionPolicy,
        cov: fullCoverageMode,
        dur: parsedDurationSeconds,
        pass: parsedPassScore,
        flt: filtersPayload,
      }),
    [
      allocationStrategy,
      countValidation.value,
      filtersPayload,
      fullCoverageMode,
      parsedCoverageBatch,
      parsedDurationSeconds,
      parsedPassScore,
      selectionPolicy,
      sourcesPayload,
    ],
  );

  const [debouncedPreviewSig, setDebouncedPreviewSig] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedPreviewSig(previewSignature), 250);
    return () => clearTimeout(t);
  }, [previewSignature]);

  const previewQuery = useQuery<ExamPreviewResult>({
    queryKey: ["exam-preview", debouncedPreviewSig],
    queryFn: () =>
      previewExamConfig({
        sources: sourcesPayload,
        requested_question_count: fullCoverageMode
          ? Math.min(totalEligible, parsedCoverageBatch ?? 1)
          : countValidation.value ?? 1,
        allocation_strategy: allocationStrategy,
        selection_policy: selectionPolicy,
        full_coverage_mode: fullCoverageMode,
        questions_per_exam: fullCoverageMode ? parsedCoverageBatch ?? undefined : undefined,
        duration_limit_seconds: parsedDurationSeconds,
        pass_threshold: parsedPassScore,
        filters: filtersPayload,
      }),
    enabled:
      hasAnySource &&
      totalEligible > 0 &&
      (fullCoverageMode
        ? parsedCoverageBatch !== null
        : localAllocation.valid) &&
      debouncedPreviewSig === previewSignature,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });

  // Average seconds / question pacing
  const effectiveExamSize = fullCoverageMode
    ? Math.min(totalEligible, parsedCoverageBatch ?? 0)
    : countValidation.value ?? 0;
  const avgSecondsPerQuestion =
    parsedDurationSeconds && effectiveExamSize > 0
      ? Math.round(parsedDurationSeconds / effectiveExamSize)
      : null;

  const needsRedistributionConfirm =
    !fullCoverageMode &&
    allocationStrategy === "weighted" &&
    (localAllocation.requiresConfirmation ||
      Boolean(previewQuery.data?.was_redistributed));

  const canLaunch =
    hasAnySource &&
    totalEligible > 0 &&
    !isLaunching &&
    (fullCoverageMode
      ? parsedCoverageBatch !== null && parsedCoverageBatch >= 1
      : countValidation.valid &&
        localAllocation.valid &&
        (!needsRedistributionConfirm || redistributionConfirmed));

  // Start Custom Exam OR Start Full Coverage Cycle
  const handleLaunch = async () => {
    if (!hasAnySource) {
      toast.error(
        lText(
          locale,
          "Hãy chọn ít nhất 1 học phần hoặc thư mục.",
          "Please select at least one study set or folder.",
        ),
      );
      return;
    }

    if (isTimed && parsedDurationSeconds === null) {
      toast.error(
        lText(
          locale,
          "Thời gian làm bài phải là số phút hợp lệ (>= 1 phút).",
          "Exam duration must be at least 1 minute.",
        ),
      );
      return;
    }

    if (fullCoverageMode) {
      if (!parsedCoverageBatch) {
        toast.error(
          lText(
            locale,
            "Số câu mỗi đề trong chu kỳ phủ phải >= 1.",
            "Questions per exam must be at least 1.",
          ),
        );
        return;
      }
      setIsLaunching(true);
      try {
        const res = await createCoverageCycleApi({
          title:
            coverageTitle.trim() ||
            examTitle.trim() ||
            lText(
              locale,
              `Chu kỳ phủ 100% (${totalEligible} câu)`,
              `Full Coverage (${totalEligible}Q)`,
            ),
          sources: sourcesPayload,
          filters: filtersPayload,
          allocation_strategy: allocationStrategy,
          questions_per_exam: parsedCoverageBatch,
          duration_limit_seconds: parsedDurationSeconds,
          pass_threshold: parsedPassScore,
          shuffle_options: shuffleOptions,
          show_subject_names: showSubjectNames,
          show_chapter_names: showChapterNames,
          allow_navigation: allowNavigation,
          allow_mark_for_review: allowMarkForReview,
          auto_submit_on_expire: autoSubmitOnExpire,
          show_review_after_submit: showReviewAfterSubmit,
          preset_id: loadedPresetId,
          start_first_exam: true,
        });
        await queryClient.invalidateQueries({ queryKey: ["coverage-cycles"] });
        if (res.first_exam?.attempt?.id) {
          router.push(`/exams/${res.first_exam.attempt.id}`);
        } else if (res.cycle?.active_attempt_id) {
          router.push(`/exams/${res.cycle.active_attempt_id}`);
        } else {
          setActiveTab("coverage");
          toast.success(
            lText(locale, "Đã tạo chu kỳ phủ 100%!", "Full Coverage cycle created!"),
          );
          setIsLaunching(false);
        }
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : lText(locale, "Không thể tạo chu kỳ phủ.", "Failed to create coverage cycle."),
        );
        setIsLaunching(false);
      }
      return;
    }

    if (!countValidation.valid || !countValidation.value) {
      toast.error(
        countValidation.message ??
          lText(locale, "Số câu hỏi không hợp lệ.", "Invalid question count."),
      );
      return;
    }

    if (!localAllocation.valid) {
      toast.error(
        localAllocation.errors[0]?.message ??
          lText(locale, "Cấu hình phân bổ chưa hợp lệ.", "Allocation configuration is invalid."),
      );
      return;
    }

    if (needsRedistributionConfirm && !redistributionConfirmed) {
      toast.error(
        lText(
          locale,
          "Vui lòng xác nhận phân bổ đã điều chỉnh do giới hạn số câu của từng môn.",
          "Please confirm the redistributed quotas before starting.",
        ),
      );
      return;
    }

    setIsLaunching(true);
    try {
      const created = await createExamAttempt({
        sources: sourcesPayload,
        preset_id: loadedPresetId,
        title:
          examTitle.trim() ||
          lText(
            locale,
            effectiveSubjects.length === 1
              ? `Thi thử — ${effectiveSubjects[0].title}`
              : `Đề thi tổng hợp (${effectiveSubjects.length} môn · ${countValidation.value} câu)`,
            effectiveSubjects.length === 1
              ? `Mock Exam — ${effectiveSubjects[0].title}`
              : `Custom Mixed Exam (${effectiveSubjects.length} subjects · ${countValidation.value}Q)`,
          ),
        question_count: countValidation.value,
        allocation_strategy: allocationStrategy,
        selection_policy: selectionPolicy,
        duration_limit_seconds: parsedDurationSeconds,
        pass_threshold: parsedPassScore,
        shuffle_questions: shuffleQuestions,
        shuffle_options: shuffleOptions,
        show_subject_names: showSubjectNames,
        show_chapter_names: showChapterNames,
        allow_navigation: allowNavigation,
        allow_mark_for_review: allowMarkForReview,
        auto_submit_on_expire: autoSubmitOnExpire,
        show_review_after_submit: showReviewAfterSubmit,
        filters: filtersPayload,
      });

      router.push(`/exams/${created.attempt.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : lText(locale, "Không thể tạo đề thi.", "Failed to generate exam."),
      );
      setIsLaunching(false);
    }
  };

  const handleSavePresetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!presetNameDraft.trim() || !hasAnySource) return;

    setIsSavingPreset(true);
    try {
      await createExamPreset({
        name: presetNameDraft.trim(),
        description: presetDescDraft.trim() || null,
        is_favorite: presetFavoriteDraft,
        sources: sourcesPayload,
        requested_question_count: useAllQuestions
          ? null
          : countValidation.value ?? 50,
        allocation_strategy: allocationStrategy,
        selection_policy: selectionPolicy,
        full_coverage_mode: fullCoverageMode,
        duration_limit_seconds: parsedDurationSeconds,
        pass_threshold: parsedPassScore,
        shuffle_questions: shuffleQuestions,
        shuffle_options: shuffleOptions,
        show_subject_names: showSubjectNames,
        show_chapter_names: showChapterNames,
        allow_navigation: allowNavigation,
        allow_mark_for_review: allowMarkForReview,
        auto_submit_on_expire: autoSubmitOnExpire,
        show_review_after_submit: showReviewAfterSubmit,
        filters: filtersPayload,
      });
      toast.success(
        lText(locale, "Đã lưu mẫu đề thi mới!", "Saved new exam preset!"),
      );
      setSavePresetOpen(false);
      setPresetNameDraft("");
      setPresetDescDraft("");
      setPresetFavoriteDraft(false);
      await queryClient.invalidateQueries({ queryKey: ["exam-presets"] });
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : lText(locale, "Không thể lưu mẫu đề.", "Could not save preset."),
      );
    } finally {
      setIsSavingPreset(false);
    }
  };

  // Filtered folders & sets by search
  const searchLower = sourceSearch.trim().toLowerCase();
  const visibleFolders = React.useMemo(
    () =>
      allFolders.filter((f) =>
        !searchLower ? true : f.name.toLowerCase().includes(searchLower),
      ),
    [allFolders, searchLower],
  );
  const visibleSets = React.useMemo(
    () =>
      allSets.filter((s) =>
        !searchLower
          ? true
          : s.title.toLowerCase().includes(searchLower) ||
            (s.subject?.toLowerCase().includes(searchLower) ?? false),
      ),
    [allSets, searchLower],
  );

  const toggleFolder = (folderId: string) => {
    setSelectedFolderIds((prev) =>
      prev.includes(folderId)
        ? prev.filter((id) => id !== folderId)
        : [...prev, folderId],
    );
  };

  const toggleSet = (setId: string) => {
    setSelectedSetIds((prev) =>
      prev.includes(setId) ? prev.filter((id) => id !== setId) : [...prev, setId],
    );
  };

  const toggleExpandFolder = (folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const handleSelectAllSets = () => {
    setSelectedSetIds(allSets.filter((s) => s.question_count > 0).map((s) => s.id));
  };

  const handleClearSources = () => {
    setSelectedFolderIds([]);
    setSelectedSetIds([]);
    setSelectedChapters([]);
    setSelectedTagIds([]);
  };

  const activeFineFilterCount =
    selectedChapters.length +
    selectedTagIds.length +
    selectedDifficulties.length +
    selectedQuestionTypes.length;

  const overlapSetsRemoved =
    eligibleQuery.data?.overlap_sets_removed ?? overlapCountLocal;

  const availableChapters = eligibleQuery.data?.chapters ?? [];
  const availableTags = eligibleQuery.data?.tags ?? [];

  const policyDescriptions: Record<SelectionPolicy, string> = {
    random: lText(
      locale,
      "Lấy ngẫu nhiên đồng đều không lặp lại từ toàn bộ ngân hàng khả dụng.",
      "Uniform random Fisher-Yates sampling without replacement.",
    ),
    unseen_first: lText(
      locale,
      "Ưu tiên tối đa câu chưa từng làm trước, phần thiếu mới bù câu đã làm.",
      "Prioritizes unanswered questions first; fills remainder randomly.",
    ),
    mistakes_first: lText(
      locale,
      "Ưu tiên câu sai chưa khắc phục, sai nhiều lần và sai gần nhất trước.",
      "Prioritizes unresolved mistakes, highest error count, and most recent misses.",
    ),
    weak_topics_first: lText(
      locale,
      "Xếp hạng chủ đề/chương có độ chính xác thấp nhất lên trước (thuật toán xác định).",
      "Deterministic ranking by lowest chapter/tag accuracy and mastery.",
    ),
    due_for_review: lText(
      locale,
      "Ưu tiên câu đã đến hạn ôn tập theo lịch lặp lại ngắt quãng SM-2.",
      "Prioritizes questions due for SM-2 spaced repetition review first.",
    ),
    starred_only: lText(
      locale,
      "Bộ lọc nghiêm ngặt: CHỈ lấy câu gắn sao (không bao giờ tự độn câu khác).",
      "Strict filter: ONLY starred questions — never silently pads.",
    ),
    incorrect_only: lText(
      locale,
      "Bộ lọc nghiêm ngặt: CHỈ lấy câu từng làm sai (không tự độn câu khác).",
      "Strict filter: ONLY previously missed questions — never silently pads.",
    ),
    anti_repeat: lText(
      locale,
      "Loại trừ câu vừa làm ở các bài thi gần đây trước; báo rõ nếu buộc phải lặp.",
      "Excludes recently completed exam questions first; transparently discloses any required repeats.",
    ),
  };

  const strategyDescriptions: Record<AllocationStrategy, string> = {
    proportional: lText(
      locale,
      "Môn có nhiều câu hơn chiếm tỷ trọng tương ứng (Largest Remainder chính xác).",
      "Matches each subject's pool share using exact Largest Remainder math.",
    ),
    equal: lText(
      locale,
      "Chia số câu gần bằng nhau giữa các môn, tự bù nếu môn nhỏ thiếu câu.",
      "Splits questions evenly across subjects with capacity redistribution.",
    ),
    global_random: lText(
      locale,
      "Gộp chung thành 1 ngân hàng và rút ngẫu nhiên đồng đều khi bấm Bắt đầu.",
      "Samples uniformly across the combined pool at start (no fixed per-subject quotas).",
    ),
    custom: lText(
      locale,
      "Tự nhập chính xác số lượng câu hỏi mong muốn cho từng học phần.",
      "Specify exact integer question counts for every selected subject.",
    ),
    weighted: lText(
      locale,
      "Nhập tỷ trọng % cho từng môn (tổng phải bằng đúng 100%).",
      "Assign percentage weights totaling strictly 100% across subjects.",
    ),
  };

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-6xl space-y-6 lg:pb-8",
        embedded ? "pb-24" : "pb-36",
      )}
    >
      {/* Page Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          {embedded ? (
            <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {lText(locale, "Tạo đề thi thử", "Custom Exam Builder")}
            </h2>
          ) : (
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {lText(locale, "Tạo đề thi thử", "Custom Exam Builder")}
            </h1>
          )}
          <p className="text-sm text-muted-foreground">
            {lText(
              locale,
              "Chọn học phần, nhập số câu và bắt đầu thi thử ngay. Mọi tùy chọn chuyên sâu nằm gọn trong Cài đặt nâng cao.",
              "Pick study sets, choose question count, and start right away. All advanced controls live inside Advanced Settings.",
            )}
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="min-h-10 shrink-0"
          asChild
        >
          <Link href="/exams" prefetch={false}>
            <Layers className="size-4" aria-hidden="true" />
            {lText(locale, "Trung tâm Đề thi", "Exam Hub")}
          </Link>
        </Button>
      </div>

      {/* Zero-Clipping Responsive Sub-Navigation Tabs (fits cleanly on 360px/390px!) */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid h-auto w-full grid-cols-3 gap-1 p-1 sm:inline-flex sm:w-auto">
          <TabsTrigger
            value="builder"
            className="min-h-10 gap-1.5 whitespace-normal px-2 py-1.5 text-center text-xs leading-tight sm:whitespace-nowrap sm:px-3 sm:text-sm"
          >
            <SlidersHorizontal className="hidden size-4 shrink-0 sm:inline-block" aria-hidden="true" />
            {lText(locale, "Tạo đề tùy chỉnh", "Custom Builder")}
          </TabsTrigger>
          <TabsTrigger
            value="presets"
            className="min-h-10 gap-1.5 whitespace-normal px-2 py-1.5 text-center text-xs leading-tight sm:whitespace-nowrap sm:px-3 sm:text-sm"
          >
            <Bookmark className="hidden size-4 shrink-0 sm:inline-block" aria-hidden="true" />
            {lText(locale, "Mẫu đề đã lưu", "Saved Presets")}
          </TabsTrigger>
          <TabsTrigger
            value="coverage"
            className="min-h-10 gap-1.5 whitespace-normal px-2 py-1.5 text-center text-xs leading-tight sm:whitespace-nowrap sm:px-3 sm:text-sm"
          >
            <Layers className="hidden size-4 shrink-0 sm:inline-block" aria-hidden="true" />
            {lText(locale, "Phủ hết ngân hàng", "Full Coverage")}
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: 3-STEP CUSTOM BUILDER */}
        <TabsContent value="builder" className="mt-5">
          {/* Main 2-Column Builder Workspace */}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            {/* LEFT COLUMN: Clean 2-Card Core Flow + Collapsible Advanced Settings */}
            <div className="space-y-5">
              {/* STEP 1: Pick Study Sets & Folders */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">
                      {lText(
                        locale,
                        "Bước 1 · Chọn học phần",
                        "Step 1 · Select Study Sets",
                      )}
                    </CardTitle>
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-h-9 text-xs"
                        onClick={handleSelectAllSets}
                      >
                        {lText(locale, "Chọn tất cả", "Select all")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-h-9 text-xs"
                        disabled={!hasAnySource}
                        onClick={handleClearSources}
                      >
                        {lText(locale, "Bỏ chọn", "Clear")}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Search input inside semantic <search> */}
                  <search className="relative">
                    <Search
                      className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Input
                      value={sourceSearch}
                      onChange={(e) => setSourceSearch(e.target.value)}
                      placeholder={lText(
                        locale,
                        "Tìm theo tên thư mục, học phần hoặc môn học...",
                        "Filter folders, study sets, or subjects...",
                      )}
                      aria-label={lText(locale, "Tìm nguồn câu hỏi", "Filter question sources")}
                      className="pl-9 min-h-10"
                    />
                  </search>

                  {/* Deduplication Notice Badge */}
                  {overlapSetsRemoved > 0 ? (
                    <div
                      role="status"
                      className="flex items-center gap-2 rounded-lg border border-primary/30 bg-accent/60 px-3 py-2 text-xs text-accent-foreground"
                    >
                      <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                      <span>
                        {lText(
                          locale,
                          `Đã tự động khử trùng lặp ${overlapSetsRemoved} học phần nằm trong thư mục đã chọn — không bao giờ cộng đúp câu hỏi.`,
                          `Automatically deduplicated ${overlapSetsRemoved} study set(s) already covered by selected folders — zero double-counting.`,
                        )}
                      </span>
                    </div>
                  ) : null}

                  {/* Scrollable Folders + Study Sets List */}
                  {setsQuery.isLoading || foldersQuery.isLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  ) : allSets.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                      <p>
                        {lText(
                          locale,
                          "Bạn chưa có học phần nào. Hãy tạo hoặc nhập học phần trước khi tạo đề thi.",
                          "You have no study sets yet. Create or import a study set first.",
                        )}
                      </p>
                      <Button asChild size="sm" variant="outline" className="mt-3">
                        <Link href="/sets/new">
                          {lText(locale, "Tạo học phần mới", "Create Study Set")}
                        </Link>
                      </Button>
                    </div>
                  ) : (
                    <div className="max-h-[320px] space-y-4 overflow-y-auto rounded-lg border border-border p-3">
                      {/* Folders Section */}
                      {visibleFolders.length > 0 ? (
                        <div className="space-y-1.5">
                          <p className="px-1 text-xs font-semibold text-muted-foreground">
                            {lText(locale, "Thư mục", "Folders")} ({visibleFolders.length})
                          </p>
                          {visibleFolders.map((folder) => {
                            const isChecked = selectedFolderIds.includes(folder.id);
                            const descIds = getDescendantFolderIds(folder.id, allFolders);
                            const childSets = allSets.filter(
                              (s) => s.folder_id && descIds.has(s.folder_id),
                            );
                            const folderQCount = childSets.reduce(
                              (sum, s) => sum + s.question_count,
                              0,
                            );
                            const isExpanded = expandedFolderIds.has(folder.id);

                            return (
                              <div
                                key={folder.id}
                                className="rounded-md border border-transparent hover:bg-secondary/40"
                              >
                                <div className="flex items-center gap-2 px-2 py-1.5">
                                  <button
                                    type="button"
                                    className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary"
                                    aria-expanded={isExpanded}
                                    aria-label={lText(
                                      locale,
                                      `Mở rộng thư mục ${folder.name}`,
                                      `Expand folder ${folder.name}`,
                                    )}
                                    onClick={() => toggleExpandFolder(folder.id)}
                                  >
                                    {isExpanded ? (
                                      <ChevronDown className="size-4" aria-hidden="true" />
                                    ) : (
                                      <ChevronRight className="size-4" aria-hidden="true" />
                                    )}
                                  </button>
                                  <label className="flex flex-1 cursor-pointer items-center gap-2.5 text-sm">
                                    <Checkbox
                                      checked={isChecked}
                                      onCheckedChange={() => toggleFolder(folder.id)}
                                    />
                                    <FolderIcon
                                      className="size-4 shrink-0 text-primary"
                                      aria-hidden="true"
                                    />
                                    <span className="flex-1 truncate font-medium">
                                      {folder.name}
                                    </span>
                                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                      {childSets.length}{" "}
                                      {lText(locale, "môn", "sets")} · {folderQCount}{" "}
                                      {lText(locale, "câu", "Q")}
                                    </span>
                                  </label>
                                </div>

                                {isExpanded && childSets.length > 0 ? (
                                  <div className="ml-10 space-y-1 border-l border-border pb-2 pl-3">
                                    {childSets.map((cs) => (
                                      <div
                                        key={cs.id}
                                        className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                                      >
                                        <span className="truncate">{cs.title}</span>
                                        <span className="shrink-0 tabular-nums">
                                          {cs.question_count}{" "}
                                          {lText(locale, "câu", "Q")}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}

                      {/* Individual Study Sets Section */}
                      <div className="space-y-1.5">
                        <p className="px-1 text-xs font-semibold text-muted-foreground">
                          {lText(locale, "Học phần", "Study Sets")} ({visibleSets.length})
                        </p>
                        {visibleSets.map((s) => {
                          const directChecked = selectedSetIds.includes(s.id);
                          const coveredByFolder = setsCoveredBySelectedFolders.has(
                            s.id,
                          );
                          return (
                            <label
                              key={s.id}
                              className={cn(
                                "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-secondary/40",
                                (directChecked || coveredByFolder) && "bg-accent/30",
                              )}
                            >
                              <Checkbox
                                checked={directChecked || coveredByFolder}
                                onCheckedChange={() => toggleSet(s.id)}
                              />
                              <span className="flex-1 truncate font-medium">
                                {s.title}
                              </span>
                              {coveredByFolder ? (
                                <Badge
                                  variant="secondary"
                                  className="shrink-0 text-[10px]"
                                >
                                  {lText(
                                    locale,
                                    "Đã gồm qua thư mục",
                                    "Via folder",
                                  )}
                                </Badge>
                              ) : null}
                              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                {s.question_count} {lText(locale, "câu", "Q")}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Selected Subject Removable Chips */}
                  {effectiveSelectedSetIds.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {effectiveSubjects.slice(0, 8).map((sub) => (
                        <Badge
                          key={sub.subjectId}
                          variant="secondary"
                          className="gap-1 pr-1 text-xs"
                        >
                          <span className="max-w-[160px] truncate">
                            {sub.title}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            ({sub.availableCount})
                          </span>
                          {selectedSetIds.includes(sub.subjectId) ? (
                            <button
                              type="button"
                              aria-label={lText(
                                locale,
                                `Bỏ chọn ${sub.title}`,
                                `Remove ${sub.title}`,
                              )}
                              onClick={() => toggleSet(sub.subjectId)}
                              className="ml-0.5 rounded-full p-0.5 hover:bg-secondary"
                            >
                              <X className="size-3" aria-hidden="true" />
                            </button>
                          ) : null}
                        </Badge>
                      ))}
                      {effectiveSubjects.length > 8 ? (
                        <Badge variant="outline" className="text-xs tabular-nums">
                          +{effectiveSubjects.length - 8}
                        </Badge>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              {/* STEP 2: Question Count, Full Coverage Toggle & Contextual Multi-Subject Allocation */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {lText(
                      locale,
                      "Bước 2 · Chọn số câu hỏi",
                      "Step 2 · Choose Question Count",
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Full Coverage Mode Switch */}
                  <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-accent/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-0.5">
                      <Label
                        htmlFor="builder-full-coverage"
                        className="flex items-center gap-2 text-sm font-semibold cursor-pointer"
                      >
                        <Layers className="size-4 text-primary" aria-hidden="true" />
                        {lText(
                          locale,
                          "Chế độ Phủ hết ngân hàng 100% (Full Coverage)",
                          "Full Coverage Mode (Zero-Overlap Series)",
                        )}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {lText(
                          locale,
                          "Chia toàn bộ ngân hàng thành chuỗi đề liên tiếp không lặp câu nào (ví dụ 500 câu = 250 + 250 hoặc 120 × 4 + 20).",
                          "Divides the full bank into sequential non-overlapping exams (e.g. 500Q = 250 + 250 or 120 × 4 + 20).",
                        )}
                      </p>
                    </div>
                    <Switch
                      id="builder-full-coverage"
                      checked={fullCoverageMode}
                      onCheckedChange={setFullCoverageMode}
                    />
                  </div>

                  {/* Either Full Coverage Batch Size OR Single Exam Question Count */}
                  {fullCoverageMode ? (
                    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
                      <div className="space-y-2">
                        <Label htmlFor="coverage-cycle-title">
                          {lText(locale, "Tên chu kỳ phủ", "Coverage Cycle Name")}
                        </Label>
                        <Input
                          id="coverage-cycle-title"
                          value={coverageTitle}
                          onChange={(e) => setCoverageTitle(e.target.value)}
                          maxLength={200}
                          placeholder={lText(
                            locale,
                            "Ví dụ: Phủ 100% ngân hàng Khí tượng hàng không...",
                            "e.g., Full Coverage ATPL Meteorology Bank...",
                          )}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="coverage-batch-size">
                          {lText(locale, "Số câu mỗi đề trong chu kỳ", "Questions per Exam")}
                        </Label>
                        <div className="flex flex-wrap items-center gap-2">
                          {COVERAGE_BATCH_PRESETS.map((n) => (
                            <Button
                              key={n}
                              type="button"
                              size="sm"
                              variant={
                                coverageBatchInput === String(n)
                                  ? "default"
                                  : "outline"
                              }
                              className="min-h-10 tabular-nums"
                              aria-pressed={coverageBatchInput === String(n)}
                              onClick={() => setCoverageBatchInput(String(n))}
                            >
                              {n}
                            </Button>
                          ))}
                          <Input
                            id="coverage-batch-size"
                            type="text"
                            inputMode="numeric"
                            value={coverageBatchInput}
                            onChange={(e) => setCoverageBatchInput(e.target.value)}
                            aria-invalid={parsedCoverageBatch === null ? "true" : "false"}
                            className="h-10 w-28 tabular-nums"
                            placeholder="120"
                          />
                        </div>
                        {coveragePlan && totalEligible > 0 ? (
                          <div className="rounded-md bg-secondary/50 px-3 py-2 text-xs text-foreground tabular-nums">
                            <strong>
                              {lText(locale, "Kế hoạch chuỗi đề:", "Planned Series:")}
                            </strong>{" "}
                            {totalEligible} {lText(locale, "câu", "Q")} →{" "}
                            <span className="font-semibold text-primary">
                              {coveragePlan.examCount}{" "}
                              {lText(locale, "đề", "exams")} ({coveragePlan.formattedPlan})
                            </span>
                            {coveragePlan.hasSmallerFinalExam
                              ? ` · ${lText(
                                  locale,
                                  "Đề cuối giữ nguyên phần dư, không bỏ sót câu nào.",
                                  "Final exam keeps remaining questions with zero discards.",
                                )}`
                              : ""}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label htmlFor="builder-question-count">
                          {lText(locale, "Số lượng câu hỏi", "Question Count")}
                        </Label>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {lText(locale, "Khả dụng:", "Available:")}{" "}
                          <strong className="text-foreground">{totalEligible}</strong>
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {QUESTION_COUNT_PRESETS.map((n) => {
                          const active =
                            !useAllQuestions &&
                            resolvedQuestionCountInput === String(n);
                          return (
                            <Button
                              key={n}
                              type="button"
                              size="sm"
                              variant={active ? "default" : "outline"}
                              className="min-h-10 tabular-nums"
                              aria-pressed={active}
                              onClick={() => {
                                setUseAllQuestions(false);
                                setQuestionCountInput(String(n));
                                setCountEditedAtPool(
                                  totalEligible > 0 ? totalEligible : null,
                                );
                              }}
                            >
                              {n}
                            </Button>
                          );
                        })}
                        <Button
                          type="button"
                          size="sm"
                          variant={useAllQuestions ? "default" : "outline"}
                          className="min-h-10 tabular-nums"
                          aria-pressed={useAllQuestions}
                          onClick={() => setUseAllQuestions(true)}
                        >
                          {lText(
                            locale,
                            `Tất cả (${totalEligible})`,
                            `All (${totalEligible})`,
                          )}
                        </Button>
                      </div>

                      {!useAllQuestions ? (
                        <div className="flex items-center gap-2 pt-1">
                          <Input
                            id="builder-question-count"
                            type="text"
                            inputMode="numeric"
                            value={resolvedQuestionCountInput}
                            onChange={(e) => {
                              setQuestionCountInput(e.target.value);
                              setCountEditedAtPool(
                                totalEligible > 0 ? totalEligible : null,
                              );
                            }}
                            aria-invalid={
                              hasAnySource && !countValidation.valid
                                ? "true"
                                : "false"
                            }
                            aria-describedby="builder-count-error"
                            className="h-10 w-36 tabular-nums"
                            placeholder="250"
                          />
                          <span className="text-xs text-muted-foreground">
                            {lText(
                              locale,
                              "Nhập bất kỳ số nguyên dương nào từ 1 đến số câu khả dụng (tối đa 1000).",
                              "Enter any positive integer from 1 up to available pool (max 1000).",
                            )}
                          </span>
                        </div>
                      ) : null}

                      {hasAnySource && !countValidation.valid ? (
                        <p
                          id="builder-count-error"
                          role="alert"
                          className="flex items-center gap-1.5 text-xs font-medium text-destructive"
                        >
                          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                          <span>{countValidation.message}</span>
                        </p>
                      ) : null}
                    </div>
                  )}

                  {/* Allocation Strategy A–E (contextually revealed when 2+ subjects selected) */}
                  {effectiveSubjects.length >= 2 ? (
                    <div className="space-y-3 border-t border-border pt-5">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="flex items-center gap-1.5 text-sm font-semibold">
                          <Scale className="size-4 text-primary" aria-hidden="true" />
                          {lText(
                            locale,
                            "Chiến lược phân bổ câu hỏi theo môn (A–E)",
                            "Multi-Subject Allocation Strategy (A–E)",
                          )}
                        </Label>
                      </div>

                    <div
                      role="radiogroup"
                      aria-label={lText(
                        locale,
                        "Chiến lược phân bổ",
                        "Allocation Strategy",
                      )}
                      className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
                    >
                      {ALLOCATION_STRATEGIES.map((strat) => {
                        const selected = allocationStrategy === strat;
                        return (
                          <button
                            key={strat}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => handleStrategyChange(strat)}
                            className={cn(
                              "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              selected
                                ? "border-primary bg-accent/60 text-accent-foreground"
                                : "border-border bg-card text-foreground hover:bg-secondary/50",
                            )}
                          >
                            <span className="text-xs font-semibold">
                              {getAllocationLabel(locale, strat)}
                            </span>
                            <span className="text-[11px] leading-snug text-muted-foreground">
                              {strategyDescriptions[strat]}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Strategy D: Custom Counts Inline Editor */}
                    {allocationStrategy === "custom" &&
                    effectiveSubjects.length > 0 &&
                    !fullCoverageMode ? (
                      <div className="space-y-3 rounded-lg border border-border bg-secondary/20 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold">
                            {lText(
                              locale,
                              "Nhập số câu cho từng học phần",
                              "Exact Question Count per Subject",
                            )}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => {
                              const target =
                                countValidation.value ??
                                Math.min(50, totalEligible);
                              const suggested = suggestCustomCounts(
                                effectiveSubjects,
                                target,
                              );
                              const draft: Record<string, string> = {};
                              for (const [id, c] of Object.entries(suggested)) {
                                draft[id] = String(c);
                              }
                              setCustomCounts(draft);
                            }}
                          >
                            {lText(locale, "Điền tự động khớp tổng", "Auto-Balance")}
                          </Button>
                        </div>

                        <div className="space-y-2">
                          {effectiveSubjects.map((sub) => {
                            const valStr = customCounts[sub.subjectId] ?? "0";
                            const hasErr = localAllocation.errors.some(
                              (e) => e.subjectId === sub.subjectId,
                            );
                            return (
                              <div
                                key={sub.subjectId}
                                className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-medium">
                                    {sub.title}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground tabular-nums">
                                    {lText(locale, "Tối đa:", "Max:")}{" "}
                                    {sub.availableCount}
                                  </p>
                                </div>
                                <Input
                                  type="text"
                                  inputMode="numeric"
                                  value={valStr}
                                  aria-label={`${sub.title} count`}
                                  aria-invalid={hasErr ? "true" : "false"}
                                  onChange={(e) =>
                                    setCustomCounts((prev) => ({
                                      ...prev,
                                      [sub.subjectId]: e.target.value,
                                    }))
                                  }
                                  className="h-9 w-24 text-right tabular-nums"
                                />
                              </div>
                            );
                          })}
                        </div>

                        <div className="flex items-center justify-between text-xs font-medium tabular-nums">
                          <span>
                            {lText(locale, "Tổng đã phân bổ:", "Allocated Sum:")}{" "}
                            {localAllocation.totalAllocated} /{" "}
                            {countValidation.value ?? 0}
                          </span>
                          {localAllocation.remainingUnallocated === 0 &&
                          localAllocation.valid ? (
                            <span className="text-success">
                              {lText(locale, "Khớp chính xác ✓", "Exact match ✓")}
                            </span>
                          ) : localAllocation.remainingUnallocated > 0 ? (
                            <span className="text-warning-subtle-foreground">
                              {lText(
                                locale,
                                `Còn thiếu ${localAllocation.remainingUnallocated} câu`,
                                `${localAllocation.remainingUnallocated} remaining unallocated`,
                              )}
                            </span>
                          ) : (
                            <span className="text-destructive">
                              {lText(
                                locale,
                                `Vượt quá ${Math.abs(localAllocation.remainingUnallocated)} câu`,
                                `Exceeds by ${Math.abs(localAllocation.remainingUnallocated)}`,
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : null}

                    {/* Strategy E: Weighted Percentage Inline Editor */}
                    {allocationStrategy === "weighted" &&
                    effectiveSubjects.length > 0 &&
                    !fullCoverageMode ? (
                      <div className="space-y-3 rounded-lg border border-border bg-secondary/20 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold">
                            {lText(
                              locale,
                              "Tỷ trọng % từng môn (tổng phải bằng 100%)",
                              "Subject Percentage Weights (must total 100%)",
                            )}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => {
                              const eq = suggestEqualWeights(
                                effectiveSubjects.map((s) => s.subjectId),
                              );
                              const draft: Record<string, string> = {};
                              for (const [id, w] of Object.entries(eq)) {
                                draft[id] = String(w);
                              }
                              setWeightInputs(draft);
                            }}
                          >
                            {lText(locale, "Chia đều 100%", "Split 100% Evenly")}
                          </Button>
                        </div>

                        <div className="space-y-2">
                          {effectiveSubjects.map((sub) => {
                            const valStr = weightInputs[sub.subjectId] ?? "0";
                            const previewRow = localAllocation.allocations.find(
                              (a) => a.subjectId === sub.subjectId,
                            );
                            return (
                              <div
                                key={sub.subjectId}
                                className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-medium">
                                    {sub.title}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground tabular-nums">
                                    {lText(locale, "Khả dụng:", "Avail:")}{" "}
                                    {sub.availableCount}
                                    {previewRow?.allocatedCount !== null &&
                                    previewRow?.allocatedCount !== undefined
                                      ? ` · → ${previewRow.allocatedCount} ${lText(locale, "câu", "Q")}`
                                      : ""}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Input
                                    type="text"
                                    inputMode="decimal"
                                    value={valStr}
                                    aria-label={`${sub.title} weight percent`}
                                    onChange={(e) =>
                                      setWeightInputs((prev) => ({
                                        ...prev,
                                        [sub.subjectId]: e.target.value,
                                      }))
                                    }
                                    className="h-9 w-20 text-right tabular-nums"
                                  />
                                  <span className="text-xs text-muted-foreground">%</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="flex items-center justify-between text-xs font-medium tabular-nums">
                          <span>
                            {lText(locale, "Tổng tỷ trọng:", "Total Weight:")}{" "}
                            {localAllocation.weightSumPercent ?? 0}%
                          </span>
                          {localAllocation.weightSumPercent === 100 ? (
                            <span className="text-success">100% ✓</span>
                          ) : (
                            <span className="text-destructive">
                              {lText(
                                locale,
                                "Phải bằng đúng 100%",
                                "Must total exactly 100%",
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  ) : null}
                </CardContent>
              </Card>

              {/* ADVANCED SETTINGS (Progressive disclosure via native <details>, closed by default — UX31-02) */}
              <details className="group rounded-xl border border-border bg-card shadow-2xs">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-semibold select-none [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-2">
                    <SlidersHorizontal
                      className="size-4 text-primary"
                      aria-hidden="true"
                    />
                    {lText(locale, "Cài đặt nâng cao", "Advanced Settings")}
                  </span>
                  <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                    <span className="hidden tabular-nums sm:inline">
                      {parsedDurationMinutes
                        ? `${parsedDurationMinutes}${lText(locale, "p", "m")}`
                        : lText(locale, "Không giờ", "Untimed")}{" "}
                      · {getPolicyLabel(locale, selectionPolicy)}
                    </span>
                    {activeFineFilterCount > 0 ? (
                      <Badge variant="secondary" className="tabular-nums">
                        +{activeFineFilterCount}
                      </Badge>
                    ) : null}
                    <ChevronDown
                      className="size-4 shrink-0 transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </span>
                </summary>

                <div className="space-y-6 border-t border-border p-4 sm:p-5">
                  {/* Fine Filters (Question Types, Difficulties, Chapters, Tags) */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-sm font-semibold">
                        {lText(
                          locale,
                          "Bộ lọc câu hỏi (Loại câu, Độ khó, Chương, Thẻ)",
                          "Question Filters (Types, Difficulty, Chapters, Tags)",
                        )}
                      </Label>
                      {activeFineFilterCount > 0 ? (
                        <Badge variant="default" className="tabular-nums">
                          {activeFineFilterCount}
                        </Badge>
                      ) : null}
                    </div>

                    {/* Question Types */}
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        {lText(locale, "Loại câu hỏi", "Question Types")}
                      </Label>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {ALL_EXAM_TYPES.map((qt) => {
                          const checked = selectedQuestionTypes.includes(qt);
                          const label = lText(
                            locale,
                            EXAM_TYPE_LABELS[qt].vi,
                            EXAM_TYPE_LABELS[qt].en,
                          );
                          return (
                            <label
                              key={qt}
                              className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border bg-secondary/20 px-2.5 py-2 text-xs"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() =>
                                  setSelectedQuestionTypes((prev) =>
                                    prev.includes(qt)
                                      ? prev.filter((x) => x !== qt)
                                      : [...prev, qt],
                                  )
                                }
                              />
                              <span>{label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* Difficulties */}
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        {lText(locale, "Độ khó", "Difficulty")}
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {ALL_DIFFICULTIES.map((diff) => {
                          const active = selectedDifficulties.includes(diff);
                          const label =
                            diff === "easy"
                              ? lText(locale, "Dễ", "Easy")
                              : diff === "medium"
                                ? lText(locale, "Trung bình", "Medium")
                                : lText(locale, "Khó", "Hard");
                          return (
                            <Button
                              key={diff}
                              type="button"
                              size="sm"
                              variant={active ? "default" : "outline"}
                              className="min-h-10"
                              aria-pressed={active}
                              onClick={() =>
                                setSelectedDifficulties((prev) =>
                                  prev.includes(diff)
                                    ? prev.filter((x) => x !== diff)
                                    : [...prev, diff],
                                )
                              }
                            >
                              {label}
                            </Button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Chapters */}
                    {availableChapters.length > 0 ? (
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">
                          {lText(locale, "Chương / Chủ đề", "Chapters / Topics")}
                        </Label>
                        <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                          {availableChapters.map((ch) => {
                            const active = selectedChapters.includes(ch.chapter);
                            return (
                              <Button
                                key={`${ch.study_set_id}-${ch.chapter}`}
                                type="button"
                                size="sm"
                                variant={active ? "secondary" : "outline"}
                                className="min-h-9 text-xs tabular-nums"
                                aria-pressed={active}
                                onClick={() =>
                                  setSelectedChapters((prev) =>
                                    prev.includes(ch.chapter)
                                      ? prev.filter((x) => x !== ch.chapter)
                                      : [...prev, ch.chapter],
                                  )
                                }
                              >
                                {ch.chapter} ({ch.count})
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {/* Tags */}
                    {availableTags.length > 0 ? (
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">
                          {lText(locale, "Thẻ (Tags)", "Tags")}
                        </Label>
                        <div className="flex flex-wrap gap-1.5">
                          {availableTags.map((tag) => {
                            const active = selectedTagIds.includes(tag.id);
                            return (
                              <Button
                                key={tag.id}
                                type="button"
                                size="sm"
                                variant={active ? "secondary" : "outline"}
                                className="min-h-9 text-xs tabular-nums"
                                aria-pressed={active}
                                onClick={() =>
                                  setSelectedTagIds((prev) =>
                                    prev.includes(tag.id)
                                      ? prev.filter((x) => x !== tag.id)
                                      : [...prev, tag.id],
                                  )
                                }
                              >
                                #{tag.name} ({tag.count})
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {/* All 8 Selection Policies (hidden only when Full Coverage takes ownership of queue) */}
                  {!fullCoverageMode ? (
                    <div className="space-y-3 border-t border-border pt-5">
                      <Label className="text-sm font-semibold">
                        {lText(
                          locale,
                          "Chính sách chọn câu hỏi",
                          "Question Selection Policy",
                        )}
                      </Label>
                      <div
                        role="radiogroup"
                        aria-label={lText(
                          locale,
                          "Chính sách chọn câu hỏi",
                          "Question Selection Policy",
                        )}
                        className="grid gap-2 sm:grid-cols-2"
                      >
                        {SELECTION_POLICIES.map((pol) => {
                          const selected = selectionPolicy === pol;
                          const isStrict =
                            pol === "starred_only" || pol === "incorrect_only";
                          return (
                            <button
                              key={pol}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => setSelectionPolicy(pol)}
                              className={cn(
                                "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                selected
                                  ? "border-primary bg-accent/60 text-accent-foreground"
                                  : "border-border bg-card text-foreground hover:bg-secondary/50",
                              )}
                            >
                              <div className="flex w-full items-center justify-between gap-2">
                                <span className="text-xs font-semibold">
                                  {getPolicyLabel(locale, pol)}
                                </span>
                                {isStrict ? (
                                  <Badge
                                    variant="outline"
                                    className="px-1.5 py-0 text-[10px]"
                                  >
                                    {lText(locale, "Nghiêm ngặt", "Strict")}
                                  </Badge>
                                ) : null}
                              </div>
                              <span className="text-[11px] leading-snug text-muted-foreground">
                                {policyDescriptions[pol]}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {/* Time Limit & Exam Room Behavior */}
                  <div className="space-y-5 border-t border-border pt-5">
                    <p className="text-sm font-semibold">
                      {lText(
                        locale,
                        "Thời gian & Thiết lập phòng thi",
                        "Time Limit & Exam Room Behavior",
                      )}
                    </p>
                  {/* Exam Title */}
                  {!fullCoverageMode ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="builder-exam-title">
                        {lText(locale, "Tên bài thi (tùy chọn)", "Exam Title (optional)")}
                      </Label>
                      <Input
                        id="builder-exam-title"
                        value={examTitle}
                        onChange={(e) => setExamTitle(e.target.value)}
                        maxLength={200}
                        placeholder={lText(
                          locale,
                          "Tự động tạo tên theo môn học nếu để trống...",
                          "Auto-generated from selected subjects if left blank...",
                        )}
                      />
                    </div>
                  ) : null}

                  {/* Duration */}
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label className="flex items-center gap-1.5">
                        <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
                        {lText(locale, "Thời gian làm bài", "Time Limit")}
                      </Label>
                      {avgSecondsPerQuestion !== null ? (
                        <Badge variant="outline" className="tabular-nums text-xs">
                          ~{avgSecondsPerQuestion}{" "}
                          {lText(locale, "giây / câu", "sec / question")}
                        </Badge>
                      ) : !isTimed ? (
                        <Badge variant="secondary" className="text-xs">
                          {lText(locale, "Không giới hạn thời gian", "Unlimited time")}
                        </Badge>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant={!isTimed ? "default" : "outline"}
                        className="min-h-10"
                        aria-pressed={!isTimed}
                        onClick={() => setIsTimed(false)}
                      >
                        {lText(locale, "Không giới hạn", "Unlimited")}
                      </Button>
                      {DURATION_PRESETS.map((m) => {
                        const active =
                          isTimed && durationMinutesInput === String(m);
                        return (
                          <Button
                            key={m}
                            type="button"
                            size="sm"
                            variant={active ? "default" : "outline"}
                            className="min-h-10 tabular-nums"
                            aria-pressed={active}
                            onClick={() => {
                              setIsTimed(true);
                              setDurationMinutesInput(String(m));
                            }}
                          >
                            {m}
                            {lText(locale, "p", "m")}
                          </Button>
                        );
                      })}
                      {isTimed ? (
                        <div className="flex items-center gap-1.5">
                          <Input
                            type="text"
                            inputMode="numeric"
                            value={durationMinutesInput}
                            onChange={(e) => setDurationMinutesInput(e.target.value)}
                            aria-label={lText(locale, "Số phút tùy chỉnh", "Custom minutes")}
                            className="h-10 w-20 text-right tabular-nums"
                          />
                          <span className="text-xs text-muted-foreground">
                            {lText(locale, "phút", "min")}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Behavior toggles + Passing score */}
                  <div className="grid gap-3 rounded-lg border border-border bg-secondary/20 p-4 sm:grid-cols-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="opt-shuffle-q" className="cursor-pointer text-xs">
                        {lText(locale, "Xáo trộn thứ tự câu hỏi", "Shuffle questions")}
                      </Label>
                      <Switch
                        id="opt-shuffle-q"
                        checked={shuffleQuestions}
                        onCheckedChange={setShuffleQuestions}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="opt-shuffle-a" className="cursor-pointer text-xs">
                        {lText(locale, "Xáo trộn thứ tự đáp án", "Shuffle options")}
                      </Label>
                      <Switch
                        id="opt-shuffle-a"
                        checked={shuffleOptions}
                        onCheckedChange={setShuffleOptions}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="opt-show-subject" className="cursor-pointer text-xs">
                        {lText(locale, "Hiện tên môn học khi thi", "Show subject names")}
                      </Label>
                      <Switch
                        id="opt-show-subject"
                        checked={showSubjectNames}
                        onCheckedChange={setShowSubjectNames}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="opt-show-chapter" className="cursor-pointer text-xs">
                        {lText(locale, "Hiện tên chương khi thi", "Show chapter names")}
                      </Label>
                      <Switch
                        id="opt-show-chapter"
                        checked={showChapterNames}
                        onCheckedChange={setShowChapterNames}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="opt-allow-nav" className="cursor-pointer text-xs">
                        {lText(locale, "Cho phép nhảy câu tự do", "Allow free navigation")}
                      </Label>
                      <Switch
                        id="opt-allow-nav"
                        checked={allowNavigation}
                        onCheckedChange={setAllowNavigation}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="opt-mark" className="cursor-pointer text-xs">
                        {lText(locale, "Cho phép đánh dấu xem lại", "Allow mark for review")}
                      </Label>
                      <Switch
                        id="opt-mark"
                        checked={allowMarkForReview}
                        onCheckedChange={setAllowMarkForReview}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="opt-autosubmit" className="cursor-pointer text-xs">
                        {lText(locale, "Tự động nộp khi hết giờ", "Auto-submit on timeout")}
                      </Label>
                      <Switch
                        id="opt-autosubmit"
                        checked={autoSubmitOnExpire}
                        onCheckedChange={setAutoSubmitOnExpire}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="opt-review-after" className="cursor-pointer text-xs">
                        {lText(locale, "Xem chi tiết đáp án sau khi nộp", "Review after submit")}
                      </Label>
                      <Switch
                        id="opt-review-after"
                        checked={showReviewAfterSubmit}
                        onCheckedChange={setShowReviewAfterSubmit}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 sm:col-span-2 border-t border-border pt-3">
                      <Label htmlFor="opt-pass-score" className="text-xs">
                        {lText(locale, "Điểm đạt (Pass threshold %)", "Passing Score (%)")}
                      </Label>
                      <div className="flex items-center gap-1.5">
                        <Input
                          id="opt-pass-score"
                          type="text"
                          inputMode="numeric"
                          value={passScoreInput}
                          onChange={(e) => setPassScoreInput(e.target.value)}
                          className="h-9 w-20 text-right tabular-nums"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                    </div>
                  </div>
                  </div>
                </div>
              </details>
            </div>

            {/* STEP 3 (RIGHT COLUMN): Sticky Live Blueprint & Launch CTA */}
            <aside className="space-y-4 lg:sticky lg:top-20">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">
                      {lText(
                        locale,
                        "Bước 3 · Bắt đầu thi thử",
                        "Step 3 · Review & Start",
                      )}
                    </CardTitle>
                    {eligibleQuery.isFetching || previewQuery.isFetching ? (
                      <Loader2
                        className="size-4 animate-spin text-muted-foreground"
                        aria-hidden="true"
                      />
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Pool KPI (honest when no set selected yet — fixes UX31-02) */}
                  <div className="rounded-lg border border-border bg-secondary/30 p-3.5 space-y-1">
                    {hasAnySource ? (
                      <>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            {lText(locale, "Ngân hàng khả dụng", "Eligible Pool")}
                          </span>
                          <span className="tabular-nums">
                            {effectiveSubjects.length}{" "}
                            {lText(locale, "môn", "subjects")}
                          </span>
                        </div>
                        <p className="text-2xl font-bold text-foreground tabular-nums">
                          {totalEligible}{" "}
                          <span className="text-xs font-normal text-muted-foreground">
                            {lText(locale, "câu duy nhất", "unique questions")}
                          </span>
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            {lText(
                              locale,
                              "Chọn học phần ở Bước 1",
                              "Select study sets in Step 1",
                            )}
                          </span>
                          <span className="tabular-nums">
                            {allSets.length} {lText(locale, "môn", "sets")}
                          </span>
                        </div>
                        <p className="text-lg font-bold text-foreground tabular-nums">
                          {totalLibraryQuestions}{" "}
                          <span className="text-xs font-normal text-muted-foreground">
                            {lText(
                              locale,
                              "câu trong thư viện của bạn",
                              "questions in your library",
                            )}
                          </span>
                        </p>
                      </>
                    )}
                  </div>

                  {/* Pacing & Policy summary */}
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {lText(locale, "Quy mô đề:", "Exam Size:")}
                      </span>
                      <span className="font-semibold tabular-nums">
                        {fullCoverageMode && coveragePlan
                          ? `${coveragePlan.formattedPlan} (${coveragePlan.examCount} ${lText(locale, "đề", "exams")})`
                          : `${effectiveExamSize} ${lText(locale, "câu", "Q")}`}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {lText(locale, "Thời lượng:", "Duration:")}
                      </span>
                      <span className="font-semibold tabular-nums">
                        {parsedDurationMinutes
                          ? `${parsedDurationMinutes} ${lText(locale, "phút", "min")}${
                              avgSecondsPerQuestion
                                ? ` (~${avgSecondsPerQuestion}s/câu)`
                                : ""
                            }`
                          : lText(locale, "Không giới hạn", "Unlimited")}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {lText(locale, "Phân bổ:", "Allocation:")}
                      </span>
                      <span className="font-semibold">
                        {getAllocationLabel(locale, allocationStrategy)}
                      </span>
                    </div>
                    {!fullCoverageMode ? (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {lText(locale, "Chọn câu:", "Selection:")}
                        </span>
                        <span className="font-semibold">
                          {getPolicyLabel(locale, selectionPolicy)}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {/* Per-Subject Allocation Preview Table */}
                  {hasAnySource && effectiveSubjects.length > 0 ? (
                    <div className="space-y-2 border-t border-border pt-3">
                      <p className="text-xs font-semibold text-foreground">
                        {lText(locale, "Phân bổ theo môn", "Per-Subject Breakdown")}
                      </p>

                      {allocationStrategy === "global_random" && !fullCoverageMode ? (
                        <div className="rounded-md border border-border bg-secondary/30 p-2.5 text-[11px] text-muted-foreground">
                          {lText(
                            locale,
                            "Ngẫu nhiên toàn bộ: số câu chính xác của từng môn sẽ được rút ngẫu nhiên đồng đều khi bạn bấm Bắt đầu thi (không cố định trước).",
                            "Global Random: exact per-subject counts are sampled uniformly without replacement when you start (never pre-fixed).",
                          )}
                        </div>
                      ) : null}

                      <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                        {localAllocation.allocations.map((row) => (
                          <div key={row.subjectId} className="space-y-1 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate font-medium">
                                {row.title}
                              </span>
                              <span className="shrink-0 tabular-nums font-semibold">
                                {row.allocatedCount === null
                                  ? `~${row.expectedMean} (${row.minPossible}–${row.maxPossible})`
                                  : `${row.allocatedCount}`}
                                <span className="font-normal text-muted-foreground">
                                  /{row.availableCount}
                                </span>
                              </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                              <div
                                className="h-full bg-primary"
                                style={{
                                  width: `${Math.min(100, Math.round(row.sharePercent))}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Anti-Repeat Honest Disclosure */}
                  {!fullCoverageMode &&
                  selectionPolicy === "anti_repeat" &&
                  previewQuery.data &&
                  previewQuery.data.repeated_count > 0 ? (
                    <div
                      role="status"
                      className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning-subtle p-3 text-xs text-warning-subtle-foreground"
                    >
                      <AlertTriangle
                        className="mt-0.5 size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <span>
                        {lText(
                          locale,
                          `Số câu mới chưa làm gần đây không đủ — đề thi này sẽ lặp lại ${previewQuery.data.repeated_count} câu từ bài thi trước để đủ ${effectiveExamSize} câu.`,
                          `Not enough non-recent questions — ${previewQuery.data.repeated_count} recently seen question(s) will repeat to reach ${effectiveExamSize}.`,
                        )}
                      </span>
                    </div>
                  ) : null}

                  {/* Weighted Capacity Redistribution Confirmation Alert */}
                  {needsRedistributionConfirm ? (
                    <div
                      role="alert"
                      className="space-y-2.5 rounded-lg border border-warning/60 bg-warning-subtle p-3 text-xs text-warning-subtle-foreground"
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle
                          className="mt-0.5 size-4 shrink-0"
                          aria-hidden="true"
                        />
                        <p>
                          {lText(
                            locale,
                            "Một số môn không đủ câu theo tỷ trọng % yêu cầu. Phần dư đã được tự động phân bổ sang các môn còn câu hỏi như bảng trên.",
                            "One or more weighted subjects hit their available cap. Excess slots were redistributed as shown in the adjusted preview above.",
                          )}
                        </p>
                      </div>
                      <label className="flex cursor-pointer items-center gap-2 font-medium text-foreground">
                        <Checkbox
                          checked={redistributionConfirmed}
                          onCheckedChange={(v) =>
                            setConfirmedRedistributionKey(
                              Boolean(v) ? redistributionKey : null,
                            )
                          }
                        />
                        <span>
                          {lText(
                            locale,
                            "Tôi xác nhận phân bổ đã điều chỉnh này",
                            "I confirm this redistributed allocation",
                          )}
                        </span>
                      </label>
                    </div>
                  ) : null}

                  {/* Validation Errors */}
                  {!fullCoverageMode &&
                  hasAnySource &&
                  localAllocation.errors.length > 0 ? (
                    <div
                      role="alert"
                      className="space-y-1 rounded-lg border border-destructive/40 bg-destructive-subtle p-3 text-xs text-destructive-subtle-foreground"
                    >
                      {localAllocation.errors.map((err, i) => (
                        <p key={`${err.code}-${i}`} className="flex items-start gap-1.5">
                          <AlertCircle
                            className="mt-0.5 size-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          <span>{err.message}</span>
                        </p>
                      ))}
                    </div>
                  ) : null}

                  {/* Primary & Secondary CTAs */}
                  <div className="space-y-2 pt-1">
                    <Button
                      type="button"
                      size="lg"
                      className="min-h-11 w-full"
                      disabled={!canLaunch}
                      onClick={() => void handleLaunch()}
                    >
                      {isLaunching ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Play className="size-4" aria-hidden="true" />
                      )}
                      {fullCoverageMode
                        ? lText(
                            locale,
                            "Khởi tạo & Thi đề #1",
                            "Create Cycle & Start Exam #1",
                          )
                        : lText(locale, "Bắt đầu thi ngay", "Start Exam")}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-10 w-full"
                      disabled={!hasAnySource}
                      onClick={() => {
                        setPresetNameDraft(
                          examTitle.trim() ||
                            (effectiveSubjects.length === 1
                              ? `${effectiveSubjects[0].title} (${effectiveExamSize})`
                              : lText(
                                  locale,
                                  `Mẫu thi ${effectiveSubjects.length} môn (${effectiveExamSize} câu)`,
                                  `${effectiveSubjects.length}-Subject Preset (${effectiveExamSize}Q)`,
                                )),
                        );
                        setSavePresetOpen(true);
                      }}
                    >
                      <Bookmark className="size-4" aria-hidden="true" />
                      {lText(locale, "Lưu làm mẫu đề", "Save as Preset")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </aside>
          </div>
        </TabsContent>

        {/* TAB 2: SAVED PRESETS */}
        <TabsContent value="presets" className="mt-5">
          <ExamPresetsSection
            onSelectPresetInBuilder={hydrateFromPreset}
            compact
          />
        </TabsContent>

        {/* TAB 3: FULL COVERAGE CYCLES */}
        <TabsContent value="coverage" className="mt-5">
          <CoverageCyclesSection compact />
        </TabsContent>
      </Tabs>

      {/* Mobile Sticky Bottom Bar (<lg, compact <12% viewport height; sits cleanly above AppShell bottom nav when not embedded) */}
      {activeTab === "builder" ? (
        <div
          className={cn(
            "fixed inset-x-0 z-30 border-t border-border bg-card/95 px-4 py-2.5 backdrop-blur-xs lg:hidden",
            embedded
              ? "bottom-0 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
              : "bottom-[calc(4rem+max(0.25rem,env(safe-area-inset-bottom,0px)))]",
          )}
        >
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
            {!hasAnySource && allSets.length > 0 ? (
              <>
                <div className="min-w-0 text-xs tabular-nums">
                  <p className="truncate font-semibold text-foreground">
                    {lText(locale, "Chưa chọn học phần", "No study set selected")}
                  </p>
                  <p className="truncate text-muted-foreground">
                    {allSets.length} {lText(locale, "học phần", "sets")} ·{" "}
                    {totalLibraryQuestions} {lText(locale, "câu", "Q")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-11 shrink-0 px-4"
                  onClick={handleSelectAllSets}
                >
                  {lText(locale, "Chọn tất cả", "Select all")}
                </Button>
              </>
            ) : (
              <>
                <div className="min-w-0 text-xs tabular-nums">
                  <p className="truncate font-semibold text-foreground">
                    {effectiveExamSize} {lText(locale, "câu", "Q")} ·{" "}
                    {parsedDurationMinutes
                      ? `${parsedDurationMinutes}${lText(locale, "p", "m")}`
                      : lText(locale, "Không giờ", "Untimed")}
                  </p>
                  <p className="truncate text-muted-foreground">
                    {lText(locale, "Khả dụng", "Pool")}: {totalEligible}
                  </p>
                </div>
                <Button
                  type="button"
                  className="min-h-11 shrink-0 px-5"
                  disabled={!canLaunch}
                  onClick={() => void handleLaunch()}
                >
                  {isLaunching ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Play className="size-4" aria-hidden="true" />
                  )}
                  {lText(locale, "Bắt đầu thi", "Start Exam")}
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* Save Preset Dialog */}
      <Dialog open={savePresetOpen} onOpenChange={setSavePresetOpen}>
        <DialogContent className="overscroll-contain">
          <DialogHeader>
            <DialogTitle>
              {lText(locale, "Lưu cấu hình thành mẫu đề", "Save as Exam Preset")}
            </DialogTitle>
            <DialogDescription>
              {lText(
                locale,
                "Chỉ lưu cấu hình thi (không khóa cố định danh sách câu hỏi). Lần sau bấm Thi ngay sẽ tự động tạo đề ngẫu nhiên mới.",
                "Stores exam rules only (never fixed question IDs). Each future launch generates a fresh random exam.",
              )}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSavePresetSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="save-preset-name">
                {lText(locale, "Tên mẫu đề", "Preset Name")}
              </Label>
              <Input
                id="save-preset-name"
                value={presetNameDraft}
                onChange={(e) => setPresetNameDraft(e.target.value)}
                maxLength={160}
                autoFocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="save-preset-desc">
                {lText(locale, "Mô tả (tùy chọn)", "Description (optional)")}
              </Label>
              <Input
                id="save-preset-desc"
                value={presetDescDraft}
                onChange={(e) => setPresetDescDraft(e.target.value)}
                maxLength={500}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <Label htmlFor="save-preset-fav" className="cursor-pointer text-sm">
                {lText(locale, "Ghim vào mục Yêu thích", "Pin to Favorites")}
              </Label>
              <Switch
                id="save-preset-fav"
                checked={presetFavoriteDraft}
                onCheckedChange={setPresetFavoriteDraft}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSavePresetOpen(false)}
              >
                {lText(locale, "Hủy", "Cancel")}
              </Button>
              <Button
                type="submit"
                disabled={isSavingPreset || !presetNameDraft.trim()}
              >
                {isSavingPreset ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                {lText(locale, "Lưu mẫu đề", "Save Preset")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
