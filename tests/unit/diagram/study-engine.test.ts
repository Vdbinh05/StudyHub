import { describe, expect, it } from "vitest";
import {
  buildDiagramMcChoices,
  createDiagramStudyQueue,
  gradeDiagramIdentifyClick,
  gradeDiagramNameAnswer,
} from "@/lib/diagram/study-engine";
import type { DiagramHotspot } from "@/types/v3";

function makeHotspot(
  id: string,
  label: string,
  x: number,
  y: number,
  alternatives: string[] = [],
): DiagramHotspot {
  return {
    id,
    diagram_id: "diag-1",
    study_set_id: "set-1",
    label,
    accepted_alternatives: alternatives,
    description: `Description for ${label}`,
    hint: `Hint for ${label}`,
    shape: "point",
    geometry: { shape: "point", x, y, radius: 0.05 },
    sort_order: 0,
    created_at: "2026-11-24T00:00:00Z",
    updated_at: "2026-11-24T00:00:00Z",
  };
}

const HOTSPOTS: DiagramHotspot[] = [
  makeHotspot("h1", "Cánh tà", 0.2, 0.2, ["Flaps", "Trailing edge flap"]),
  makeHotspot("h2", "Bánh lái độ cao", 0.5, 0.2, ["Elevator"]),
  makeHotspot("h3", "Bánh lái hướng", 0.8, 0.2, ["Rudder"]),
  makeHotspot("h4", "Cánh liệng", 0.2, 0.7, ["Aileron"]),
  makeHotspot("h5", "Cánh phụ mũi", 0.6, 0.7, ["Slats"]),
];

describe("diagram 6-mode deterministic study engine", () => {
  describe("gradeDiagramIdentifyClick", () => {
    it("grades clicks inside target hotspot as correct and outside as incorrect", () => {
      const hit = gradeDiagramIdentifyClick({ x: 0.21, y: 0.19 }, HOTSPOTS[0], HOTSPOTS);
      expect(hit.isCorrect).toBe(true);
      expect(hit.clickedHotspotId).toBe("h1");

      const missOther = gradeDiagramIdentifyClick({ x: 0.5, y: 0.2 }, HOTSPOTS[0], HOTSPOTS);
      expect(missOther.isCorrect).toBe(false);
      expect(missOther.clickedHotspotId).toBe("h2");
      expect(missOther.clickedHotspotLabel).toBe("Bánh lái độ cao");

      const missBlank = gradeDiagramIdentifyClick({ x: 0.95, y: 0.95 }, HOTSPOTS[0], HOTSPOTS);
      expect(missBlank.isCorrect).toBe(false);
      expect(missBlank.clickedHotspotId).toBeNull();
    });
  });

  describe("gradeDiagramNameAnswer", () => {
    it("matches primary label and accepted alternatives ignoring Vietnamese diacritics by default", () => {
      expect(gradeDiagramNameAnswer("Cánh tà", HOTSPOTS[0]).isCorrect).toBe(true);
      expect(gradeDiagramNameAnswer("canh ta", HOTSPOTS[0]).isCorrect).toBe(true);
      expect(gradeDiagramNameAnswer("  FLAPS! ", HOTSPOTS[0]).isCorrect).toBe(true);
      expect(gradeDiagramNameAnswer("trailing edge flap", HOTSPOTS[0]).isCorrect).toBe(true);
      expect(gradeDiagramNameAnswer("Rudder", HOTSPOTS[0]).isCorrect).toBe(false);
    });

    it("enforces Vietnamese diacritics when strictDiacritics=true", () => {
      expect(gradeDiagramNameAnswer("Cánh tà", HOTSPOTS[0], true).isCorrect).toBe(true);
      expect(gradeDiagramNameAnswer("canh ta", HOTSPOTS[0], true).isCorrect).toBe(false);
    });
  });

  describe("buildDiagramMcChoices", () => {
    it("always includes the exact target hotspot plus up to 3 unique distractors deterministically", () => {
      const choices1 = buildDiagramMcChoices(HOTSPOTS[0], HOTSPOTS, 4, 42);
      const choices2 = buildDiagramMcChoices(HOTSPOTS[0], HOTSPOTS, 4, 42);

      expect(choices1).toEqual(choices2);
      expect(choices1).toHaveLength(4);
      expect(choices1.some((c) => c.hotspotId === "h1" && c.isCorrect)).toBe(true);
      expect(new Set(choices1.map((c) => c.hotspotId)).size).toBe(4);
    });

    it("handles diagrams with fewer than 4 hotspots cleanly without duplicate choices", () => {
      const small = HOTSPOTS.slice(0, 2);
      const choices = buildDiagramMcChoices(small[0], small, 4, 7);
      expect(choices).toHaveLength(2);
      expect(choices.filter((c) => c.isCorrect)).toHaveLength(1);
    });
  });

  describe("createDiagramStudyQueue", () => {
    it("builds review_incorrect queue exclusively from missed hotspot IDs", () => {
      const reviewQueue = createDiagramStudyQueue(HOTSPOTS, "review_incorrect", ["h2", "h4"]);
      expect(reviewQueue.map((h) => h.id)).toEqual(["h2", "h4"]);

      const emptyReview = createDiagramStudyQueue(HOTSPOTS, "review_incorrect", []);
      expect(emptyReview).toEqual([]);
    });

    it("preserves sorted order for explore/hidden_labels and deterministic shuffle for active quiz modes", () => {
      const exploreQueue = createDiagramStudyQueue(HOTSPOTS, "explore", []);
      expect(exploreQueue.map((h) => h.id)).toEqual(["h1", "h2", "h3", "h4", "h5"]);

      const shuffledA = createDiagramStudyQueue(HOTSPOTS, "identify_location", [], 99);
      const shuffledB = createDiagramStudyQueue(HOTSPOTS, "identify_location", [], 99);
      expect(shuffledA.map((h) => h.id)).toEqual(shuffledB.map((h) => h.id));
      expect(shuffledA).toHaveLength(5);
    });
  });
});
