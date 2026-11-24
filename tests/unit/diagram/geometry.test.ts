import { describe, expect, it } from "vitest";
import {
  clampNormalizedPoint,
  clampViewportTransform,
  detectHotspotOverlaps,
  fromV3HotspotGeometry,
  getHotspotBoundingBox,
  getHotspotCentroid,
  hitTestAllHotspots,
  hitTestHotspot,
  hitTestV3HotspotGeometry,
  isPointInPointHotspot,
  isPointInPolygon,
  isPointInRect,
  normalizedToViewport,
  remapHotspotsForImageChange,
  toV3HotspotGeometry,
  validateHotspotGeometry,
  validateImageDimensionRemap,
  viewportToNormalized,
  zoomAtViewportPoint,
  type DiagramHotspotGeometry,
  type ImageViewportMetrics,
  type ViewportTransform,
} from "@/lib/diagram/geometry";

describe("diagram geometry engine", () => {
  describe("clampNormalizedPoint", () => {
    it("clamps coordinates strictly to [0, 1] and rejects NaN to 0", () => {
      expect(clampNormalizedPoint({ x: -0.25, y: 1.5 })).toEqual({ x: 0, y: 1 });
      expect(clampNormalizedPoint({ x: 0.42, y: 0.73 })).toEqual({ x: 0.42, y: 0.73 });
      expect(clampNormalizedPoint({ x: Number.NaN, y: Number.POSITIVE_INFINITY })).toEqual({
        x: 0,
        y: 0,
      });
    });
  });

  describe("point hotspot hit-testing", () => {
    const hotspot: DiagramHotspotGeometry = {
      id: "pt-1",
      shape_type: "point",
      x: 0.5,
      y: 0.5,
      radius: 0.05,
    };

    it("accepts clicks at center, inside radius, and on exact boundary", () => {
      expect(isPointInPointHotspot({ x: 0.5, y: 0.5 }, hotspot)).toBe(true);
      expect(isPointInPointHotspot({ x: 0.53, y: 0.54 }, hotspot)).toBe(true); // dist = 0.05 exact
      expect(isPointInPointHotspot({ x: 0.52, y: 0.52 }, hotspot)).toBe(true);
    });

    it("rejects clicks outside radius and respects extra tolerance", () => {
      expect(isPointInPointHotspot({ x: 0.56, y: 0.5 }, hotspot)).toBe(false);
      expect(isPointInPointHotspot({ x: 0.56, y: 0.5 }, hotspot, 0.015)).toBe(true);
    });
  });

  describe("rect hotspot hit-testing", () => {
    const rect: DiagramHotspotGeometry = {
      id: "rect-1",
      shape_type: "rect",
      x: 0.2,
      y: 0.3,
      width: 0.3,
      height: 0.2,
    };

    it("accepts interior points and exact edges/corners", () => {
      expect(isPointInRect({ x: 0.35, y: 0.4 }, rect)).toBe(true);
      expect(isPointInRect({ x: 0.2, y: 0.3 }, rect)).toBe(true);
      expect(isPointInRect({ x: 0.5, y: 0.5 }, rect)).toBe(true);
      expect(isPointInRect({ x: 0.2, y: 0.5 }, rect)).toBe(true);
    });

    it("rejects points outside rectangle", () => {
      expect(isPointInRect({ x: 0.199, y: 0.4 }, rect)).toBe(false);
      expect(isPointInRect({ x: 0.501, y: 0.4 }, rect)).toBe(false);
      expect(isPointInRect({ x: 0.35, y: 0.299 }, rect)).toBe(false);
      expect(isPointInRect({ x: 0.35, y: 0.501 }, rect)).toBe(false);
    });
  });

  describe("polygon hotspot hit-testing (ray-casting + boundary)", () => {
    // Concave L-shaped polygon
    const lPolygon = [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.1 },
      { x: 0.5, y: 0.3 },
      { x: 0.3, y: 0.3 },
      { x: 0.3, y: 0.6 },
      { x: 0.1, y: 0.6 },
    ];

    it("identifies interior points of concave polygon", () => {
      expect(isPointInPolygon({ x: 0.2, y: 0.2 }, lPolygon)).toBe(true);
      expect(isPointInPolygon({ x: 0.45, y: 0.2 }, lPolygon)).toBe(true);
      expect(isPointInPolygon({ x: 0.2, y: 0.5 }, lPolygon)).toBe(true);
    });

    it("rejects points inside concave cutout and exterior", () => {
      expect(isPointInPolygon({ x: 0.4, y: 0.45 }, lPolygon)).toBe(false);
      expect(isPointInPolygon({ x: 0.05, y: 0.05 }, lPolygon)).toBe(false);
      expect(isPointInPolygon({ x: 0.8, y: 0.8 }, lPolygon)).toBe(false);
    });

    it("accepts points lying exactly on polygon edges and vertices", () => {
      expect(isPointInPolygon({ x: 0.1, y: 0.1 }, lPolygon)).toBe(true);
      expect(isPointInPolygon({ x: 0.3, y: 0.1 }, lPolygon)).toBe(true); // top horizontal edge
      expect(isPointInPolygon({ x: 0.3, y: 0.45 }, lPolygon)).toBe(true); // inner vertical edge
      expect(isPointInPolygon({ x: 0.3, y: 0.3 }, lPolygon)).toBe(true); // concave reflex vertex
    });

    it("returns false for degenerate polygon (< 3 vertices)", () => {
      expect(isPointInPolygon({ x: 0.2, y: 0.2 }, [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }])).toBe(
        false,
      );
    });
  });

  describe("hitTestHotspot & hitTestAllHotspots", () => {
    const shapes: DiagramHotspotGeometry[] = [
      { id: "p1", shape_type: "point", x: 0.2, y: 0.2, radius: 0.05 },
      { id: "r1", shape_type: "rect", x: 0.18, y: 0.18, width: 0.2, height: 0.2 },
      {
        id: "poly1",
        shape_type: "polygon",
        points: [
          { x: 0.6, y: 0.6 },
          { x: 0.9, y: 0.6 },
          { x: 0.75, y: 0.9 },
        ],
      },
    ];

    it("dispatches hit tests across point, rect, and polygon shapes", () => {
      expect(hitTestHotspot({ x: 0.75, y: 0.7 }, shapes[2])).toBe(true);
      expect(hitTestHotspot({ x: 0.75, y: 0.7 }, shapes[0])).toBe(false);
    });

    it("returns all matching overlapping hotspots sorted by specificity (smallest area first)", () => {
      const matches = hitTestAllHotspots({ x: 0.2, y: 0.2 }, shapes);
      expect(matches.map((m) => m.id)).toEqual(["p1", "r1"]);
    });
  });

  describe("zoom/pan viewport <-> normalized coordinate transform", () => {
    const metrics: ImageViewportMetrics = {
      containerWidth: 800,
      containerHeight: 600,
      baseImageWidth: 600,
      baseImageHeight: 400,
      baseOffsetX: 100,
      baseOffsetY: 100,
    };

    it("round-trips accurately at identity transform (scale = 1, translate = 0)", () => {
      const transform: ViewportTransform = { scale: 1, translateX: 0, translateY: 0 };
      const norm = { x: 0.25, y: 0.75 };
      const vp = normalizedToViewport(norm, metrics, transform);
      expect(vp.x).toBeCloseTo(100 + 0.25 * 600, 6);
      expect(vp.y).toBeCloseTo(100 + 0.75 * 400, 6);

      const back = viewportToNormalized(vp, metrics, transform);
      expect(back.point.x).toBeCloseTo(norm.x, 6);
      expect(back.point.y).toBeCloseTo(norm.y, 6);
      expect(back.isInsideImage).toBe(true);
    });

    it("round-trips accurately under combined zoom and pan", () => {
      const transform: ViewportTransform = { scale: 2.5, translateX: -120, translateY: 45 };
      const norm = { x: 0.62, y: 0.31 };
      const vp = normalizedToViewport(norm, metrics, transform);
      const back = viewportToNormalized(vp, metrics, transform);

      expect(back.point.x).toBeCloseTo(norm.x, 6);
      expect(back.point.y).toBeCloseTo(norm.y, 6);
      expect(back.isInsideImage).toBe(true);
    });

    it("flags points outside the rendered image bounds", () => {
      const transform: ViewportTransform = { scale: 1, translateX: 0, translateY: 0 };
      const outside = viewportToNormalized({ x: 20, y: 20 }, metrics, transform);
      expect(outside.isInsideImage).toBe(false);
      expect(outside.clamped.x).toBe(0);
      expect(outside.clamped.y).toBe(0);
    });

    it("zoomAtViewportPoint keeps the image point under the focal cursor stationary", () => {
      const initial: ViewportTransform = { scale: 1, translateX: 0, translateY: 0 };
      const focal = { x: 400, y: 300 };
      const beforeNorm = viewportToNormalized(focal, metrics, initial).point;

      const zoomed = zoomAtViewportPoint(initial, 2.5, focal, {
        minScale: 1,
        maxScale: 5,
        containerWidth: metrics.containerWidth,
        containerHeight: metrics.containerHeight,
      });

      const afterNorm = viewportToNormalized(focal, metrics, zoomed).point;
      expect(zoomed.scale).toBe(2.5);
      expect(afterNorm.x).toBeCloseTo(beforeNorm.x, 6);
      expect(afterNorm.y).toBeCloseTo(beforeNorm.y, 6);
    });

    it("clampViewportTransform prevents zooming below minScale or panning image completely away", () => {
      const clamped = clampViewportTransform(
        { scale: 0.2, translateX: 5000, translateY: -5000 },
        { minScale: 1, maxScale: 5, containerWidth: 800, containerHeight: 600 },
      );
      expect(clamped.scale).toBe(1);
      expect(clamped.translateX).toBe(0);
      expect(clamped.translateY).toBe(0);
    });
  });

  describe("overlap ambiguity detector", () => {
    it("detects overlapping points, rects, point-rect, and crossing polygons", () => {
      const hotspots: DiagramHotspotGeometry[] = [
        { id: "ptA", shape_type: "point", x: 0.2, y: 0.2, radius: 0.05 },
        { id: "ptB", shape_type: "point", x: 0.24, y: 0.2, radius: 0.05 }, // overlaps ptA
        { id: "rectA", shape_type: "rect", x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
        {
          id: "polyCross",
          shape_type: "polygon",
          points: [
            { x: 0.45, y: 0.58 },
            { x: 0.75, y: 0.58 },
            { x: 0.75, y: 0.62 },
            { x: 0.45, y: 0.62 },
          ],
        }, // crosses horizontally across rectA with no vertices inside rectA!
        { id: "isolated", shape_type: "point", x: 0.92, y: 0.1, radius: 0.03 },
      ];

      const warnings = detectHotspotOverlaps(hotspots);
      const pairs = warnings.map((w) => [w.hotspotAId, w.hotspotBId].sort().join(":"));

      expect(pairs).toContain("ptA:ptB");
      expect(pairs).toContain("polyCross:rectA");
      expect(pairs.some((p) => p.includes("isolated"))).toBe(false);
    });

    it("returns empty array when all hotspots are well separated", () => {
      const hotspots: DiagramHotspotGeometry[] = [
        { id: "a", shape_type: "point", x: 0.1, y: 0.1, radius: 0.03 },
        { id: "b", shape_type: "rect", x: 0.4, y: 0.4, width: 0.15, height: 0.15 },
        {
          id: "c",
          shape_type: "polygon",
          points: [
            { x: 0.75, y: 0.75 },
            { x: 0.9, y: 0.75 },
            { x: 0.82, y: 0.9 },
          ],
        },
      ];
      expect(detectHotspotOverlaps(hotspots)).toEqual([]);
    });
  });

  describe("hotspot validation, centroid & bounding box", () => {
    it("computes centroid and bounding box for each shape", () => {
      const poly: DiagramHotspotGeometry = {
        id: "tri",
        shape_type: "polygon",
        points: [
          { x: 0.0, y: 0.0 },
          { x: 0.6, y: 0.0 },
          { x: 0.3, y: 0.6 },
        ],
      };
      const centroid = getHotspotCentroid(poly);
      expect(centroid.x).toBeCloseTo(0.3, 5);
      expect(centroid.y).toBeCloseTo(0.2, 5);

      const bbox = getHotspotBoundingBox(poly);
      expect(bbox).toEqual({ minX: 0, minY: 0, maxX: 0.6, maxY: 0.6 });
    });

    it("flags invalid geometries (negative dimensions, out-of-range coords, <3 polygon points)", () => {
      expect(
        validateHotspotGeometry({ id: "bad-pt", shape_type: "point", x: 1.5, y: 0.5, radius: 0.05 })
          .valid,
      ).toBe(false);
      expect(
        validateHotspotGeometry({
          id: "bad-rect",
          shape_type: "rect",
          x: 0.8,
          y: 0.2,
          width: 0.4,
          height: 0.2,
        }).valid,
      ).toBe(false);
      expect(
        validateHotspotGeometry({
          id: "bad-poly",
          shape_type: "polygon",
          points: [
            { x: 0.1, y: 0.1 },
            { x: 0.2, y: 0.2 },
          ],
        }).valid,
      ).toBe(false);
      expect(
        validateHotspotGeometry({
          id: "good-rect",
          shape_type: "rect",
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.4,
        }).valid,
      ).toBe(true);
    });
  });

  describe("image dimension remap validator", () => {
    const sampleHotspots: DiagramHotspotGeometry[] = [
      { id: "h1", shape_type: "point", x: 0.5, y: 0.5, radius: 0.04 },
      { id: "h2", shape_type: "rect", x: 0.1, y: 0.2, width: 0.2, height: 0.2 },
    ];

    it("marks proportional resize as exact and safe", () => {
      const report = validateImageDimensionRemap(
        { width: 1000, height: 500 },
        { width: 2000, height: 1000 },
        sampleHotspots,
      );
      expect(report.status).toBe("exact");
      expect(report.requiresReview).toBe(false);
      expect(report.aspectRatioDeltaPercent).toBeCloseTo(0, 4);
    });

    it("warns minor_drift on small aspect ratio shift (2%–10%)", () => {
      const report = validateImageDimensionRemap(
        { width: 1000, height: 1000 },
        { width: 1050, height: 1000 },
        sampleHotspots,
      );
      expect(report.status).toBe("minor_drift");
      expect(report.requiresReview).toBe(true);
    });

    it("flags aspect_mismatch on dramatic aspect ratio change (>10%)", () => {
      const report = validateImageDimensionRemap(
        { width: 1600, height: 900 },
        { width: 800, height: 1200 },
        sampleHotspots,
      );
      expect(report.status).toBe("aspect_mismatch");
      expect(report.requiresReview).toBe(true);
      expect(report.affectedHotspotCount).toBe(2);
    });

    it("remaps hotspots cleanly in fit_contain mode while keeping coordinates in [0, 1]", () => {
      const remapped = remapHotspotsForImageChange(
        sampleHotspots,
        { width: 1000, height: 1000 },
        { width: 2000, height: 1000 },
        "fit_contain",
      );
      const pt = remapped[0];
      expect(pt.shape_type).toBe("point");
      if (pt.shape_type === "point") {
        expect(pt.x).toBeCloseTo(0.5, 5);
        expect(pt.y).toBeCloseTo(0.5, 5);
      }
      const rect = remapped[1];
      expect(rect.shape_type).toBe("rect");
      if (rect.shape_type === "rect") {
        // Centered horizontally in 2:1 frame -> x shifted from [0,1] into [0.25, 0.75]
        expect(rect.x).toBeCloseTo(0.3, 5);
        expect(rect.width).toBeCloseTo(0.1, 5);
        expect(rect.y).toBeCloseTo(0.2, 5);
        expect(rect.height).toBeCloseTo(0.2, 5);
      }
    });
  });

  describe("V3 HotspotGeometry contract bridge", () => {
    it("round-trips V3 HotspotGeometry across point, rect, and polygon and hit-tests accurately", () => {
      const v3Point = { shape: "point" as const, x: 0.4, y: 0.6, radius: 0.05 };
      const geom = fromV3HotspotGeometry("h-1", v3Point);
      expect(toV3HotspotGeometry(geom)).toEqual(v3Point);
      expect(hitTestV3HotspotGeometry({ x: 0.42, y: 0.61 }, v3Point)).toBe(true);
      expect(hitTestV3HotspotGeometry({ x: 0.8, y: 0.8 }, v3Point)).toBe(false);

      const v3Poly = {
        shape: "polygon" as const,
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.4, y: 0.1 },
          { x: 0.25, y: 0.4 },
        ],
      };
      expect(toV3HotspotGeometry(fromV3HotspotGeometry("h-2", v3Poly))).toEqual(v3Poly);
      expect(hitTestV3HotspotGeometry({ x: 0.25, y: 0.2 }, v3Poly)).toBe(true);
    });
  });
});
