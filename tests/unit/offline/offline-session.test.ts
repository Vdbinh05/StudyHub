import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearUserOfflineData,
  closeAllOfflineDbs,
  getLocalNote,
  getQuestionById,
  listSyncQueue,
  putDiagramsForSet,
  putDownloadedSet,
  putMediaBlob,
  putQuestionsForSet,
} from "@/lib/offline/db";
import {
  clearOfflineCheckpoint,
  createOfflineMatchSession,
  evaluateOfflineDiagramHit,
  getOfflineAvailableModes,
  gradeOfflineAnswer,
  isOfflineModeSupported,
  loadOfflineCheckpoint,
  loadOfflineStudyBundle,
  recordOfflineStudyAction,
  resolveOfflineSpellAudio,
  saveOfflineCheckpoint,
  saveOfflineNote,
  toggleOfflineStar,
} from "@/lib/offline/offline-session";
import type {
  OfflineDiagramRecord,
  OfflineDownloadedSetRecord,
  OfflineQuestionRecord,
} from "@/lib/offline/types";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeSetRecord(): OfflineDownloadedSetRecord {
  return {
    user_id: USER_ID,
    set_id: SET_ID,
    title: "Complete Offline Biology & Weather Set",
    subject: "Science",
    description: "All modes offline",
    set_type: "mixed",
    visibility: "private",
    source_language: "vi",
    content_version: 1,
    server_updated_at: "2026-11-24T10:00:00.000Z",
    downloaded_at: "2026-11-24T11:00:00.000Z",
    downloaded_chapters: null,
    question_count: 5,
    diagram_count: 1,
    media_count: 2,
    media_bytes: 256,
    estimated_total_bytes: 4096,
    include_media: true,
    status: "ready",
    failed_media_urls: [],
    last_error: null,
    passages: [],
  };
}

function makeQuestions(): OfflineQuestionRecord[] {
  const baseTs = "2026-11-24T10:00:00.000Z";
  return [
    {
      id: "q-mc",
      user_id: USER_ID,
      study_set_id: SET_ID,
      question_type: "multiple_choice",
      position: 0,
      chapter: "Ch 1",
      prompt: "Select all noble gases",
      prompt_image_url: null,
      back_text: null,
      back_image_url: null,
      explanation: "He and Ne are noble gases.",
      hint: null,
      difficulty: "easy",
      source_metadata: {},
      created_at: baseTs,
      updated_at: baseTs,
      cached_at: baseTs,
      options: [
        {
          id: "uuid-he",
          question_id: "q-mc",
          study_set_id: SET_ID,
          position: 0,
          label: "A",
          content: "Helium",
          image_url: null,
          is_correct: true,
          created_at: baseTs,
        },
        {
          id: "uuid-o2",
          question_id: "q-mc",
          study_set_id: SET_ID,
          position: 1,
          label: "B",
          content: "Oxygen",
          image_url: null,
          is_correct: false,
          created_at: baseTs,
        },
        {
          id: "uuid-ne",
          question_id: "q-mc",
          study_set_id: SET_ID,
          position: 2,
          label: "C",
          content: "Neon",
          image_url: null,
          is_correct: true,
          created_at: baseTs,
        },
      ],
    },
    {
      id: "q-num",
      user_id: USER_ID,
      study_set_id: SET_ID,
      question_type: "numerical",
      position: 1,
      chapter: "Ch 1",
      prompt: "Standard gravity in m/s^2",
      prompt_image_url: null,
      back_text: "9.81 m/s^2",
      back_image_url: null,
      explanation: null,
      hint: null,
      difficulty: "medium",
      source_metadata: {},
      type_payload: {
        type: "numerical",
        correct_value: 9.81,
        abs_tolerance: 0.05,
        unit: "m/s^2",
        unit_required: true,
      },
      created_at: baseTs,
      updated_at: baseTs,
      cached_at: baseTs,
    },
    {
      id: "q-order",
      user_id: USER_ID,
      study_set_id: SET_ID,
      question_type: "ordering",
      position: 2,
      chapter: "Ch 1",
      prompt: "Order atmosphere layers from lowest to highest",
      prompt_image_url: null,
      back_text: null,
      back_image_url: null,
      explanation: null,
      hint: null,
      difficulty: "medium",
      source_metadata: {},
      type_payload: {
        type: "ordering",
        items: [
          { id: "layer-1", text: "Troposphere", correct_position: 0 },
          { id: "layer-2", text: "Stratosphere", correct_position: 1 },
          { id: "layer-3", text: "Mesosphere", correct_position: 2 },
        ],
      },
      created_at: baseTs,
      updated_at: baseTs,
      cached_at: baseTs,
    },
    {
      id: "q-match",
      user_id: USER_ID,
      study_set_id: SET_ID,
      question_type: "matching",
      position: 3,
      chapter: "Ch 2",
      prompt: "Match instruments",
      prompt_image_url: null,
      back_text: null,
      back_image_url: null,
      explanation: null,
      hint: null,
      difficulty: "medium",
      source_metadata: {},
      type_payload: {
        type: "matching",
        pairs: [
          {
            id: "l1",
            left_text: "Barometer",
            right_id: "r1",
            right_text: "Pressure",
          },
          {
            id: "l2",
            left_text: "Anemometer",
            right_id: "r2",
            right_text: "Wind speed",
          },
        ],
      },
      created_at: baseTs,
      updated_at: baseTs,
      cached_at: baseTs,
    },
    {
      id: "q-spell",
      user_id: USER_ID,
      study_set_id: SET_ID,
      question_type: "flashcard",
      position: 4,
      chapter: "Ch 2",
      prompt: "Tầng đối lưu",
      prompt_image_url: null,
      back_text: "Troposphere",
      back_image_url: null,
      audio_url: "/api/uploads/signed-url?path=tropo.mp3&redirect=1",
      explanation: null,
      hint: "Lowest atmospheric layer",
      difficulty: "easy",
      source_metadata: {},
      created_at: baseTs,
      updated_at: baseTs,
      cached_at: baseTs,
    },
  ];
}

function makeDiagram(): OfflineDiagramRecord {
  const baseTs = "2026-11-24T10:00:00.000Z";
  return {
    id: "diag-1",
    user_id: USER_ID,
    study_set_id: SET_ID,
    owner_id: USER_ID,
    title: "Atmosphere Profile",
    description: null,
    base_media_id: null,
    base_image_url: "/api/uploads/signed-url?path=atmos.png&redirect=1",
    image_width: 1000,
    image_height: 800,
    content_version: 1,
    created_at: baseTs,
    updated_at: baseTs,
    cached_at: baseTs,
    hotspots: [
      {
        id: "hs-point",
        diagram_id: "diag-1",
        study_set_id: SET_ID,
        label: "Tropopause",
        accepted_alternatives: ["rãnh đối lưu"],
        description: "Boundary layer",
        hint: "Between tropo and strato",
        shape: "point",
        geometry: { shape: "point", x: 0.5, y: 0.5, radius: 0.05 },
        sort_order: 0,
        created_at: baseTs,
        updated_at: baseTs,
      },
      {
        id: "hs-rect",
        diagram_id: "diag-1",
        study_set_id: SET_ID,
        label: "Stratosphere",
        accepted_alternatives: [],
        description: null,
        hint: null,
        shape: "rect",
        geometry: { shape: "rect", x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
        sort_order: 1,
        created_at: baseTs,
        updated_at: baseTs,
      },
      {
        id: "hs-poly",
        diagram_id: "diag-1",
        study_set_id: SET_ID,
        label: "Triangle Zone",
        accepted_alternatives: [],
        description: null,
        hint: null,
        shape: "polygon",
        geometry: {
          shape: "polygon",
          points: [
            { x: 0.6, y: 0.6 },
            { x: 0.9, y: 0.6 },
            { x: 0.75, y: 0.9 },
          ],
        },
        sort_order: 2,
        created_at: baseTs,
        updated_at: baseTs,
      },
    ],
  };
}

afterEach(async () => {
  await clearUserOfflineData(USER_ID);
  await closeAllOfflineDbs();
  vi.restoreAllMocks();
});

describe("Offline Session Adapter (`src/lib/offline/offline-session.ts`)", () => {
  it("supports all 7 offline study modes and explicitly blocks server-timed exams offline", () => {
    for (const mode of [
      "flashcards",
      "practice",
      "write",
      "learn",
      "spell",
      "match",
      "diagram",
    ] as const) {
      expect(isOfflineModeSupported(mode)).toBe(true);
    }
    expect(isOfflineModeSupported("exam")).toBe(false);
  });

  it("loads offline study bundle with cached media object URLs and computes available modes", async () => {
    await putDownloadedSet(USER_ID, makeSetRecord());
    await putQuestionsForSet(USER_ID, SET_ID, makeQuestions());
    await putDiagramsForSet(USER_ID, SET_ID, [makeDiagram()]);
    await putMediaBlob(USER_ID, {
      url: "/api/uploads/signed-url?path=tropo.mp3&redirect=1",
      user_id: USER_ID,
      media_id: null,
      kind: "audio",
      mime_type: "audio/mpeg",
      size_bytes: 16,
      blob: new Blob([new Uint8Array([73, 68, 51, 4])], { type: "audio/mpeg" }),
      set_ids: [SET_ID],
      downloaded_at: "2026-11-24T11:00:00.000Z",
    });
    await putMediaBlob(USER_ID, {
      url: "/api/uploads/signed-url?path=atmos.png&redirect=1",
      user_id: USER_ID,
      media_id: null,
      kind: "image",
      mime_type: "image/png",
      size_bytes: 16,
      blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
      set_ids: [SET_ID],
      downloaded_at: "2026-11-24T11:00:00.000Z",
    });

    const createObjUrlSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-offline-url");
    const revokeObjUrlSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);

    const bundle = await loadOfflineStudyBundle(USER_ID, SET_ID);
    expect(bundle).not.toBeNull();
    expect(bundle!.questions).toHaveLength(5);
    expect(bundle!.diagrams).toHaveLength(1);

    const resolvedDiagramUrl = await bundle!.resolveMediaUrl(
      "/api/uploads/signed-url?path=atmos.png&redirect=1",
    );
    expect(resolvedDiagramUrl).toBe("blob:mock-offline-url");
    expect(createObjUrlSpy).toHaveBeenCalledTimes(1);

    const modes = getOfflineAvailableModes(bundle!.questions, bundle!.diagrams);
    expect(modes.flashcards.available).toBe(true);
    expect(modes.practice.available).toBe(true);
    expect(modes.learn.available).toBe(true);
    expect(modes.write.available).toBe(true);
    expect(modes.spell.available).toBe(true);
    expect(modes.match.available).toBe(true);
    expect(modes.diagram.available).toBe(true);

    // Spell audio resolves downloaded audio blob first
    const spellAudio = await resolveOfflineSpellAudio(
      USER_ID,
      bundle!.questions[4]!,
      bundle!.resolveMediaUrl,
    );
    expect(spellAudio.source).toBe("downloaded_audio");
    expect(spellAudio.blobUrl).toBe("blob:mock-offline-url");
    expect(spellAudio.offlineGuaranteed).toBe(true);

    // Match board creates deterministic offline pairs
    const matchBoard = createOfflineMatchSession(bundle!.questions, { pairCount: 4 });
    expect(matchBoard.pairs.length).toBeGreaterThanOrEqual(2);

    bundle!.revokeAllMediaUrls();
    expect(revokeObjUrlSpy).toHaveBeenCalledWith("blob:mock-offline-url");
  });

  it("grades choice by option UUID, numerical with tolerance+unit, ordering, matching, and diagram hotspots deterministically", () => {
    const qs = makeQuestions();
    const mc = qs[0]!;
    const num = qs[1]!;
    const ord = qs[2]!;
    const match = qs[3]!;

    // MC graded strictly by UUID regardless of selection order
    expect(
      gradeOfflineAnswer(mc, {
        kind: "options",
        selected_option_ids: ["uuid-ne", "uuid-he"],
      }).isCorrect,
    ).toBe(true);
    expect(
      gradeOfflineAnswer(mc, {
        kind: "options",
        selected_option_ids: ["uuid-he"],
      }).isCorrect,
    ).toBe(false);

    // Numerical tolerance + unit check
    expect(
      gradeOfflineAnswer(num, {
        kind: "numerical",
        value: "9,84",
        unit: "m/s^2",
      }).isCorrect,
    ).toBe(true);
    expect(
      gradeOfflineAnswer(num, {
        kind: "numerical",
        value: "9.84",
        unit: "km/h",
      }).isCorrect,
    ).toBe(false);
    expect(
      gradeOfflineAnswer(num, {
        kind: "numerical",
        value: "10.2",
        unit: "m/s^2",
      }).isCorrect,
    ).toBe(false);

    // Ordering exact UUID sequence
    expect(
      gradeOfflineAnswer(ord, {
        kind: "ordering",
        ordered_item_ids: ["layer-1", "layer-2", "layer-3"],
      }).isCorrect,
    ).toBe(true);
    expect(
      gradeOfflineAnswer(ord, {
        kind: "ordering",
        ordered_item_ids: ["layer-2", "layer-1", "layer-3"],
      }).isCorrect,
    ).toBe(false);

    // Matching pair map
    expect(
      gradeOfflineAnswer(match, {
        kind: "matching",
        pairs: { l1: "r1", l2: "r2" },
      }).isCorrect,
    ).toBe(true);
    expect(
      gradeOfflineAnswer(match, {
        kind: "matching",
        pairs: { l1: "r2", l2: "r1" },
      }).isCorrect,
    ).toBe(false);

    // Diagram point, rect, polygon hit testing
    const diag = makeDiagram();
    expect(evaluateOfflineDiagramHit(diag.hotspots![0]!, { x: 0.52, y: 0.52 })).toBe(true);
    expect(evaluateOfflineDiagramHit(diag.hotspots![0]!, { x: 0.8, y: 0.8 })).toBe(false);
    expect(evaluateOfflineDiagramHit(diag.hotspots![1]!, { x: 0.2, y: 0.2 })).toBe(true);
    expect(evaluateOfflineDiagramHit(diag.hotspots![1]!, { x: 0.5, y: 0.5 })).toBe(false);
    expect(evaluateOfflineDiagramHit(diag.hotspots![2]!, { x: 0.75, y: 0.7 })).toBe(true);
    expect(evaluateOfflineDiagramHit(diag.hotspots![2]!, { x: 0.1, y: 0.9 })).toBe(false);
  });

  it("persists local checkpoints across simulated browser refresh and enqueues offline answers, confidence, stars & notes", async () => {
    await putDownloadedSet(USER_ID, makeSetRecord());
    await putQuestionsForSet(USER_ID, SET_ID, makeQuestions());

    // Save checkpoint and simulate refresh (close DB handles and reopen!)
    await saveOfflineCheckpoint(USER_ID, {
      study_set_id: SET_ID,
      mode: "learn",
      session_key: "default",
      current_index: 3,
      total_items: 5,
      state_json: { answeredIds: ["q-mc", "q-num", "q-order"], stage: 2 },
    });

    await closeAllOfflineDbs();

    const restored = await loadOfflineCheckpoint(USER_ID, SET_ID, "learn", "default");
    expect(restored).not.toBeNull();
    expect(restored?.current_index).toBe(3);
    expect(restored?.progress_percent).toBe(60);
    expect(restored?.state_json).toEqual({
      answeredIds: ["q-mc", "q-num", "q-order"],
      stage: 2,
    });

    // Record study action with confidence, star toggle, and private note
    await recordOfflineStudyAction(USER_ID, {
      study_set_id: SET_ID,
      question_id: "q-mc",
      mode: "practice",
      is_correct: true,
      selected_option_ids: ["uuid-he", "uuid-ne"],
      confidence: "certain",
      response_time_ms: 2100,
    });
    await toggleOfflineStar(USER_ID, SET_ID, "q-mc", true);
    await saveOfflineNote(USER_ID, SET_ID, "q-mc", "Remember He and Ne");

    const updatedQ = await getQuestionById(USER_ID, "q-mc");
    expect(updatedQ?.is_starred).toBe(true);
    expect(updatedQ?.local_progress?.correct_count).toBe(1);
    expect(updatedQ?.local_progress?.last_confidence).toBe("certain");

    const localNote = await getLocalNote(USER_ID, "q-mc");
    expect(localNote?.content_text).toBe("Remember He and Ne");
    expect(localNote?.dirty).toBe(true);

    const queue = await listSyncQueue(USER_ID);
    const types = queue.map((q) => q.event_type);
    expect(types).toContain("checkpoint_upsert");
    expect(types).toContain("answer");
    expect(types).toContain("star");
    expect(types).toContain("note_upsert");
    // Confidence is carried inside the `answer` payload so PG RPC never double-counts confidence events
    const answerEvt = queue.find((q) => q.event_type === "answer");
    expect(answerEvt?.payload.confidence).toBe("certain");
    expect(types.filter((t) => t === "confidence")).toHaveLength(0);
    const cpEvt = queue.find((q) => q.event_type === "checkpoint_upsert");
    expect(cpEvt?.payload.session_key).toBe(`${SET_ID}:learn:default`);

    await clearOfflineCheckpoint(USER_ID, SET_ID, "learn", "default");
    expect(await loadOfflineCheckpoint(USER_ID, SET_ID, "learn", "default")).toBeNull();
  });
});
