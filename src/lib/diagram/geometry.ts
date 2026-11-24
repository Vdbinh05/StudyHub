/**
 * Deterministic Normalized [0, 1] Diagram Geometry Engine for StudyHub V3.0.
 * Zero DOM/React coupling — safe for shared use in UI, editors, grading, and unit tests.
 */

import type { DiagramHotspot, HotspotGeometry } from "@/types/v3";

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface ViewportPoint {
  x: number;
  y: number;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export type HotspotShapeType = "point" | "rect" | "polygon";

export interface PointHotspotGeometry {
  id: string;
  shape_type: "point";
  x: number;
  y: number;
  /** Hit tolerance radius in normalized [0, 1] space (default ~0.035). */
  radius: number;
}

export interface RectHotspotGeometry {
  id: string;
  shape_type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PolygonHotspotGeometry {
  id: string;
  shape_type: "polygon";
  points: NormalizedPoint[];
}

export type DiagramHotspotGeometry =
  | PointHotspotGeometry
  | RectHotspotGeometry
  | PolygonHotspotGeometry;

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ImageViewportMetrics {
  containerWidth: number;
  containerHeight: number;
  /** Rendered base image width inside container at scale === 1. */
  baseImageWidth: number;
  /** Rendered base image height inside container at scale === 1. */
  baseImageHeight: number;
  /** Left offset of base image inside container at scale === 1, translateX === 0. */
  baseOffsetX: number;
  /** Top offset of base image inside container at scale === 1, translateY === 0. */
  baseOffsetY: number;
}

/**
 * Transform applied to the image container with `transform-origin: 0 0`:
 * `translate3d(translateX, translateY, 0) scale(scale)`.
 */
export interface ViewportTransform {
  scale: number;
  translateX: number;
  translateY: number;
}

export interface TransformBounds {
  minScale: number;
  maxScale: number;
  containerWidth: number;
  containerHeight: number;
}

export interface NormalizedProjectionResult {
  point: NormalizedPoint;
  clamped: NormalizedPoint;
  isInsideImage: boolean;
}

export interface HotspotOverlapWarning {
  hotspotAId: string;
  hotspotBId: string;
  severity: "overlap" | "near";
  minDistance: number;
}

export interface HotspotGeometryValidation {
  valid: boolean;
  errors: string[];
}

export type DimensionRemapStatus = "exact" | "minor_drift" | "aspect_mismatch" | "invalid";

export interface ImageDimensionRemapReport {
  status: DimensionRemapStatus;
  oldAspectRatio: number;
  newAspectRatio: number;
  aspectRatioDeltaPercent: number;
  requiresReview: boolean;
  affectedHotspotCount: number;
}

export const DEFAULT_POINT_RADIUS = 0.04;
export const MIN_POINT_RADIUS = 0.01;
export const MAX_POINT_RADIUS = 0.25;
export const GEOMETRY_EPSILON = 1e-9;

function sanitizeFinite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function clampNormalizedPoint(point: NormalizedPoint): NormalizedPoint {
  return {
    x: clamp01(point.x),
    y: clamp01(point.y),
  };
}

export function distanceBetweenPoints(a: NormalizedPoint, b: NormalizedPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Computes shortest Euclidean distance from point P to closed line segment AB.
 */
export function distancePointToSegment(
  p: NormalizedPoint,
  a: NormalizedPoint,
  b: NormalizedPoint,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= GEOMETRY_EPSILON) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

export function isPointInPointHotspot(
  click: NormalizedPoint,
  hotspot: Pick<PointHotspotGeometry, "x" | "y" | "radius">,
  extraTolerance = 0,
): boolean {
  if (!Number.isFinite(click.x) || !Number.isFinite(click.y)) return false;
  const effectiveRadius = Math.max(0, hotspot.radius) + Math.max(0, extraTolerance);
  return Math.hypot(click.x - hotspot.x, click.y - hotspot.y) <= effectiveRadius + GEOMETRY_EPSILON;
}

export function isPointInRect(
  click: NormalizedPoint,
  rect: Pick<RectHotspotGeometry, "x" | "y" | "width" | "height">,
  extraTolerance = 0,
): boolean {
  if (!Number.isFinite(click.x) || !Number.isFinite(click.y)) return false;
  if (rect.width <= 0 || rect.height <= 0) return false;
  const tol = Math.max(0, extraTolerance) + GEOMETRY_EPSILON;
  return (
    click.x >= rect.x - tol &&
    click.x <= rect.x + rect.width + tol &&
    click.y >= rect.y - tol &&
    click.y <= rect.y + rect.height + tol
  );
}

/**
 * Deterministic polygon hit test:
 * 1. Explicit boundary check (point on any edge/vertex within tolerance is inside).
 * 2. Even-odd ray-casting algorithm for interior points (works on convex and concave polygons).
 */
export function isPointInPolygon(
  click: NormalizedPoint,
  points: readonly NormalizedPoint[],
  boundaryTolerance = 1e-7,
): boolean {
  if (!Number.isFinite(click.x) || !Number.isFinite(click.y)) return false;
  const n = points.length;
  if (n < 3) return false;

  const tol = Math.max(GEOMETRY_EPSILON, boundaryTolerance);

  // 1. Boundary / edge inclusion check
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    if (distancePointToSegment(click, a, b) <= tol) {
      return true;
    }
  }

  // 2. Ray-casting along +X
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;

    const straddlesY = yi > click.y !== yj > click.y;
    if (straddlesY) {
      const intersectX = ((xj - xi) * (click.y - yi)) / (yj - yi) + xi;
      if (click.x < intersectX) {
        inside = !inside;
      }
    }
  }

  return inside;
}

export function hitTestHotspot(
  click: NormalizedPoint,
  hotspot: DiagramHotspotGeometry,
  extraTolerance = 0,
): boolean {
  switch (hotspot.shape_type) {
    case "point":
      return isPointInPointHotspot(click, hotspot, extraTolerance);
    case "rect":
      return isPointInRect(click, hotspot, extraTolerance);
    case "polygon":
      return isPointInPolygon(click, hotspot.points, Math.max(1e-7, extraTolerance));
  }
}

export function getHotspotAreaEstimate(hotspot: DiagramHotspotGeometry): number {
  switch (hotspot.shape_type) {
    case "point":
      return Math.PI * hotspot.radius * hotspot.radius;
    case "rect":
      return Math.max(0, hotspot.width) * Math.max(0, hotspot.height);
    case "polygon": {
      const pts = hotspot.points;
      if (pts.length < 3) return 0;
      let sum = 0;
      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        sum += a.x * b.y - b.x * a.y;
      }
      return Math.abs(sum) / 2;
    }
  }
}

/**
 * Returns every hotspot containing `click`, sorted smallest area first (most specific target first).
 */
export function hitTestAllHotspots<T extends DiagramHotspotGeometry>(
  click: NormalizedPoint,
  hotspots: readonly T[],
  extraTolerance = 0,
): T[] {
  return hotspots
    .filter((h) => hitTestHotspot(click, h, extraTolerance))
    .sort((a, b) => getHotspotAreaEstimate(a) - getHotspotAreaEstimate(b));
}

export function getHotspotCentroid(hotspot: DiagramHotspotGeometry): NormalizedPoint {
  switch (hotspot.shape_type) {
    case "point":
      return { x: hotspot.x, y: hotspot.y };
    case "rect":
      return {
        x: hotspot.x + hotspot.width / 2,
        y: hotspot.y + hotspot.height / 2,
      };
    case "polygon": {
      const pts = hotspot.points;
      if (pts.length === 0) return { x: 0.5, y: 0.5 };
      let signedArea = 0;
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const cross = a.x * b.y - b.x * a.y;
        signedArea += cross;
        cx += (a.x + b.x) * cross;
        cy += (a.y + b.y) * cross;
      }
      if (Math.abs(signedArea) <= GEOMETRY_EPSILON) {
        const avgX = pts.reduce((acc, p) => acc + p.x, 0) / pts.length;
        const avgY = pts.reduce((acc, p) => acc + p.y, 0) / pts.length;
        return { x: clamp01(avgX), y: clamp01(avgY) };
      }
      const factor = 1 / (3 * signedArea);
      return { x: clamp01(cx * factor), y: clamp01(cy * factor) };
    }
  }
}

export function getHotspotBoundingBox(hotspot: DiagramHotspotGeometry): BoundingBox {
  switch (hotspot.shape_type) {
    case "point":
      return {
        minX: clamp01(hotspot.x - hotspot.radius),
        minY: clamp01(hotspot.y - hotspot.radius),
        maxX: clamp01(hotspot.x + hotspot.radius),
        maxY: clamp01(hotspot.y + hotspot.radius),
      };
    case "rect":
      return {
        minX: hotspot.x,
        minY: hotspot.y,
        maxX: hotspot.x + hotspot.width,
        maxY: hotspot.y + hotspot.height,
      };
    case "polygon": {
      if (hotspot.points.length === 0) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      }
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const p of hotspot.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { minX, minY, maxX, maxY };
    }
  }
}

export function validateHotspotGeometry(
  hotspot: DiagramHotspotGeometry,
): HotspotGeometryValidation {
  const errors: string[] = [];

  if (hotspot.shape_type === "point") {
    if (!Number.isFinite(hotspot.x) || hotspot.x < 0 || hotspot.x > 1) {
      errors.push("Point x must be within [0, 1].");
    }
    if (!Number.isFinite(hotspot.y) || hotspot.y < 0 || hotspot.y > 1) {
      errors.push("Point y must be within [0, 1].");
    }
    if (!Number.isFinite(hotspot.radius) || hotspot.radius <= 0 || hotspot.radius > 0.5) {
      errors.push("Point radius must be within (0, 0.5].");
    }
  } else if (hotspot.shape_type === "rect") {
    if (!Number.isFinite(hotspot.x) || hotspot.x < 0 || hotspot.x > 1) {
      errors.push("Rect x must be within [0, 1].");
    }
    if (!Number.isFinite(hotspot.y) || hotspot.y < 0 || hotspot.y > 1) {
      errors.push("Rect y must be within [0, 1].");
    }
    if (!Number.isFinite(hotspot.width) || hotspot.width <= 0) {
      errors.push("Rect width must be > 0.");
    }
    if (!Number.isFinite(hotspot.height) || hotspot.height <= 0) {
      errors.push("Rect height must be > 0.");
    }
    if (hotspot.x + hotspot.width > 1 + 1e-6) {
      errors.push("Rect extends past right image edge (x + width > 1).");
    }
    if (hotspot.y + hotspot.height > 1 + 1e-6) {
      errors.push("Rect extends past bottom image edge (y + height > 1).");
    }
  } else {
    if (!Array.isArray(hotspot.points) || hotspot.points.length < 3) {
      errors.push("Polygon requires at least 3 vertices.");
    } else {
      for (let i = 0; i < hotspot.points.length; i += 1) {
        const pt = hotspot.points[i];
        if (
          !Number.isFinite(pt.x) ||
          !Number.isFinite(pt.y) ||
          pt.x < 0 ||
          pt.x > 1 ||
          pt.y < 0 ||
          pt.y > 1
        ) {
          errors.push(`Polygon vertex ${i} must be within [0, 1].`);
          break;
        }
      }
      if (getHotspotAreaEstimate(hotspot) <= 1e-7) {
        errors.push("Polygon has zero or near-zero area.");
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Converts a normalized [0, 1] image point into viewport container coordinates (px).
 */
export function normalizedToViewport(
  norm: NormalizedPoint,
  metrics: ImageViewportMetrics,
  transform: ViewportTransform,
): ViewportPoint {
  const localX = metrics.baseOffsetX + norm.x * metrics.baseImageWidth;
  const localY = metrics.baseOffsetY + norm.y * metrics.baseImageHeight;
  return {
    x: localX * transform.scale + transform.translateX,
    y: localY * transform.scale + transform.translateY,
  };
}

/**
 * Converts a viewport container point (px relative to container top-left)
 * into normalized [0, 1] image coordinates under active zoom & pan transform.
 */
export function viewportToNormalized(
  viewport: ViewportPoint,
  metrics: ImageViewportMetrics,
  transform: ViewportTransform,
): NormalizedProjectionResult {
  const safeScale = transform.scale > GEOMETRY_EPSILON ? transform.scale : 1;
  const safeWidth = metrics.baseImageWidth > GEOMETRY_EPSILON ? metrics.baseImageWidth : 1;
  const safeHeight = metrics.baseImageHeight > GEOMETRY_EPSILON ? metrics.baseImageHeight : 1;

  const localX = (viewport.x - transform.translateX) / safeScale;
  const localY = (viewport.y - transform.translateY) / safeScale;

  const x = (localX - metrics.baseOffsetX) / safeWidth;
  const y = (localY - metrics.baseOffsetY) / safeHeight;

  const isInsideImage = x >= 0 && x <= 1 && y >= 0 && y <= 1;
  return {
    point: { x, y },
    clamped: clampNormalizedPoint({ x, y }),
    isInsideImage,
  };
}

/**
 * Clamps zoom & pan transform so the content stays within sane viewable bounds.
 */
export function clampViewportTransform(
  transform: ViewportTransform,
  bounds: TransformBounds,
): ViewportTransform {
  const minScale = Math.max(0.25, sanitizeFinite(bounds.minScale, 1));
  const maxScale = Math.max(minScale, sanitizeFinite(bounds.maxScale, 5));
  const scale = Math.min(maxScale, Math.max(minScale, sanitizeFinite(transform.scale, 1)));

  const cw = Math.max(0, sanitizeFinite(bounds.containerWidth, 0));
  const ch = Math.max(0, sanitizeFinite(bounds.containerHeight, 0));

  if (scale <= 1 + GEOMETRY_EPSILON || cw === 0 || ch === 0) {
    return { scale, translateX: 0, translateY: 0 };
  }

  const minTx = cw - cw * scale;
  const maxTx = 0;
  const minTy = ch - ch * scale;
  const maxTy = 0;

  const translateX = Math.min(maxTx, Math.max(minTx, sanitizeFinite(transform.translateX, 0)));
  const translateY = Math.min(maxTy, Math.max(minTy, sanitizeFinite(transform.translateY, 0)));

  return { scale, translateX, translateY };
}

/**
 * Zooms around a focal point in viewport coordinates while keeping the underlying image
 * pixel fixed beneath the pointer or pinch center.
 */
export function zoomAtViewportPoint(
  current: ViewportTransform,
  targetScale: number,
  focalPoint: ViewportPoint,
  bounds: TransformBounds,
): ViewportTransform {
  const clampedScale = Math.min(
    Math.max(bounds.minScale, bounds.maxScale),
    Math.max(bounds.minScale, sanitizeFinite(targetScale, current.scale)),
  );
  const ratio = clampedScale / Math.max(GEOMETRY_EPSILON, current.scale);
  const nextTranslateX = focalPoint.x - (focalPoint.x - current.translateX) * ratio;
  const nextTranslateY = focalPoint.y - (focalPoint.y - current.translateY) * ratio;

  return clampViewportTransform(
    {
      scale: clampedScale,
      translateX: nextTranslateX,
      translateY: nextTranslateY,
    },
    bounds,
  );
}

// --- Overlap Ambiguity Detector Helpers ---

function rectToPolygonPoints(rect: RectHotspotGeometry): NormalizedPoint[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

function cross2d(o: NormalizedPoint, a: NormalizedPoint, b: NormalizedPoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function pointOnSegmentBox(p: NormalizedPoint, a: NormalizedPoint, b: NormalizedPoint): boolean {
  return (
    p.x >= Math.min(a.x, b.x) - GEOMETRY_EPSILON &&
    p.x <= Math.max(a.x, b.x) + GEOMETRY_EPSILON &&
    p.y >= Math.min(a.y, b.y) - GEOMETRY_EPSILON &&
    p.y <= Math.max(a.y, b.y) + GEOMETRY_EPSILON
  );
}

function segmentsIntersect(
  a1: NormalizedPoint,
  a2: NormalizedPoint,
  b1: NormalizedPoint,
  b2: NormalizedPoint,
): boolean {
  const d1 = cross2d(b1, b2, a1);
  const d2 = cross2d(b1, b2, a2);
  const d3 = cross2d(a1, a2, b1);
  const d4 = cross2d(a1, a2, b2);

  if (
    ((d1 > GEOMETRY_EPSILON && d2 < -GEOMETRY_EPSILON) ||
      (d1 < -GEOMETRY_EPSILON && d2 > GEOMETRY_EPSILON)) &&
    ((d3 > GEOMETRY_EPSILON && d4 < -GEOMETRY_EPSILON) ||
      (d3 < -GEOMETRY_EPSILON && d4 > GEOMETRY_EPSILON))
  ) {
    return true;
  }

  if (Math.abs(d1) <= GEOMETRY_EPSILON && pointOnSegmentBox(a1, b1, b2)) return true;
  if (Math.abs(d2) <= GEOMETRY_EPSILON && pointOnSegmentBox(a2, b1, b2)) return true;
  if (Math.abs(d3) <= GEOMETRY_EPSILON && pointOnSegmentBox(b1, a1, a2)) return true;
  if (Math.abs(d4) <= GEOMETRY_EPSILON && pointOnSegmentBox(b2, a1, a2)) return true;
  return false;
}

function distanceSegmentToSegment(
  a1: NormalizedPoint,
  a2: NormalizedPoint,
  b1: NormalizedPoint,
  b2: NormalizedPoint,
): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    distancePointToSegment(a1, b1, b2),
    distancePointToSegment(a2, b1, b2),
    distancePointToSegment(b1, a1, a2),
    distancePointToSegment(b2, a1, a2),
  );
}

function distancePointToPolygonShape(
  center: NormalizedPoint,
  points: readonly NormalizedPoint[],
): number {
  if (isPointInPolygon(center, points)) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i += 1) {
    const d = distancePointToSegment(center, points[i], points[(i + 1) % points.length]);
    if (d < best) best = d;
  }
  return best;
}

function distancePolygonToPolygon(
  polyA: readonly NormalizedPoint[],
  polyB: readonly NormalizedPoint[],
): number {
  if (polyA.length < 3 || polyB.length < 3) return Number.POSITIVE_INFINITY;

  for (const p of polyA) {
    if (isPointInPolygon(p, polyB)) return 0;
  }
  for (const p of polyB) {
    if (isPointInPolygon(p, polyA)) return 0;
  }

  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polyA.length; i += 1) {
    const a1 = polyA[i];
    const a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j += 1) {
      const b1 = polyB[j];
      const b2 = polyB[(j + 1) % polyB.length];
      const d = distanceSegmentToSegment(a1, a2, b1, b2);
      if (d === 0) return 0;
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Returns shortest distance between the boundaries/interiors of two hotspots.
 * `0` means the two hotspots overlap or touch.
 */
export function distanceBetweenHotspots(
  a: DiagramHotspotGeometry,
  b: DiagramHotspotGeometry,
): number {
  if (a.shape_type === "point") {
    if (b.shape_type === "point") {
      const centerDist = Math.hypot(a.x - b.x, a.y - b.y);
      return Math.max(0, centerDist - (a.radius + b.radius));
    }
    const poly = b.shape_type === "rect" ? rectToPolygonPoints(b) : b.points;
    const distToPoly = distancePointToPolygonShape({ x: a.x, y: a.y }, poly);
    return Math.max(0, distToPoly - a.radius);
  }

  if (b.shape_type === "point") {
    const poly = a.shape_type === "rect" ? rectToPolygonPoints(a) : a.points;
    const distToPoly = distancePointToPolygonShape({ x: b.x, y: b.y }, poly);
    return Math.max(0, distToPoly - b.radius);
  }

  const polyA = a.shape_type === "rect" ? rectToPolygonPoints(a) : a.points;
  const polyB = b.shape_type === "rect" ? rectToPolygonPoints(b) : b.points;
  return distancePolygonToPolygon(polyA, polyB);
}

/**
 * Detects overlapping or dangerously close hotspots that could create ambiguous grading.
 */
export function detectHotspotOverlaps(
  hotspots: readonly DiagramHotspotGeometry[],
  nearThreshold = 0.01,
): HotspotOverlapWarning[] {
  const warnings: HotspotOverlapWarning[] = [];
  const safeNear = Math.max(0, nearThreshold);

  for (let i = 0; i < hotspots.length; i += 1) {
    for (let j = i + 1; j < hotspots.length; j += 1) {
      const a = hotspots[i];
      const b = hotspots[j];
      const dist = distanceBetweenHotspots(a, b);
      if (dist <= GEOMETRY_EPSILON) {
        warnings.push({
          hotspotAId: a.id,
          hotspotBId: b.id,
          severity: "overlap",
          minDistance: 0,
        });
      } else if (safeNear > 0 && dist < safeNear) {
        warnings.push({
          hotspotAId: a.id,
          hotspotBId: b.id,
          severity: "near",
          minDistance: dist,
        });
      }
    }
  }

  return warnings;
}

/**
 * Evaluates whether replacing a diagram's base image with different dimensions
 * preserves hotspot alignment or risks coordinate drift.
 */
export function validateImageDimensionRemap(
  oldDims: ImageDimensions,
  newDims: ImageDimensions,
  hotspots: readonly DiagramHotspotGeometry[],
): ImageDimensionRemapReport {
  if (
    oldDims.width <= 0 ||
    oldDims.height <= 0 ||
    newDims.width <= 0 ||
    newDims.height <= 0 ||
    !Number.isFinite(oldDims.width) ||
    !Number.isFinite(oldDims.height) ||
    !Number.isFinite(newDims.width) ||
    !Number.isFinite(newDims.height)
  ) {
    return {
      status: "invalid",
      oldAspectRatio: 0,
      newAspectRatio: 0,
      aspectRatioDeltaPercent: 100,
      requiresReview: true,
      affectedHotspotCount: hotspots.length,
    };
  }

  const oldAspect = oldDims.width / oldDims.height;
  const newAspect = newDims.width / newDims.height;
  const deltaRatio = Math.abs(newAspect - oldAspect) / oldAspect;
  const deltaPercent = deltaRatio * 100;

  let status: DimensionRemapStatus = "exact";
  if (deltaRatio > 0.1) {
    status = "aspect_mismatch";
  } else if (deltaRatio > 0.01) {
    status = "minor_drift";
  }

  return {
    status,
    oldAspectRatio: oldAspect,
    newAspectRatio: newAspect,
    aspectRatioDeltaPercent: deltaPercent,
    requiresReview: status !== "exact" && hotspots.length > 0,
    affectedHotspotCount: status === "exact" ? 0 : hotspots.length,
  };
}

/**
 * Remaps hotspots when replacing a base image:
 * - `"preserve_normalized"`: clamps coordinates cleanly into [0, 1] as-is (default for same-aspect swaps).
 * - `"fit_contain"`: centers the old image's normalized frame inside the new image's aspect ratio.
 */
export function remapHotspotsForImageChange<T extends DiagramHotspotGeometry>(
  hotspots: readonly T[],
  oldDims: ImageDimensions,
  newDims: ImageDimensions,
  strategy: "preserve_normalized" | "fit_contain" = "preserve_normalized",
): T[] {
  if (
    strategy === "preserve_normalized" ||
    oldDims.width <= 0 ||
    oldDims.height <= 0 ||
    newDims.width <= 0 ||
    newDims.height <= 0
  ) {
    return hotspots.map((h) => ({ ...h }));
  }

  const oldAspect = oldDims.width / oldDims.height;
  const newAspect = newDims.width / newDims.height;

  // Compute where the old image fits inside the new [0, 1] x [0, 1] frame
  let scaleX = 1;
  let scaleY = 1;
  let offsetX = 0;
  let offsetY = 0;

  if (newAspect > oldAspect) {
    // New image is wider -> old frame fits full height, letterboxed horizontally
    scaleX = oldAspect / newAspect;
    offsetX = (1 - scaleX) / 2;
  } else if (newAspect < oldAspect) {
    // New image is taller -> old frame fits full width, letterboxed vertically
    scaleY = newAspect / oldAspect;
    offsetY = (1 - scaleY) / 2;
  }

  const mapPoint = (pt: NormalizedPoint): NormalizedPoint => ({
    x: clamp01(offsetX + pt.x * scaleX),
    y: clamp01(offsetY + pt.y * scaleY),
  });

  const radiusScale = Math.min(scaleX, scaleY);

  return hotspots.map((hotspot) => {
    const geom: DiagramHotspotGeometry = hotspot;
    if (geom.shape_type === "point") {
      const next = mapPoint({ x: geom.x, y: geom.y });
      return {
        ...hotspot,
        x: next.x,
        y: next.y,
        radius: Math.max(MIN_POINT_RADIUS, Math.min(MAX_POINT_RADIUS, geom.radius * radiusScale)),
      };
    }
    if (geom.shape_type === "rect") {
      const topLeft = mapPoint({ x: geom.x, y: geom.y });
      const bottomRight = mapPoint({
        x: geom.x + geom.width,
        y: geom.y + geom.height,
      });
      return {
        ...hotspot,
        x: topLeft.x,
        y: topLeft.y,
        width: Math.max(0.005, bottomRight.x - topLeft.x),
        height: Math.max(0.005, bottomRight.y - topLeft.y),
      };
    }
    return {
      ...hotspot,
      points: geom.points.map(mapPoint),
    };
  });
}

/**
 * Converts a frozen V3 `HotspotGeometry` (from `@/types/v3`) into a `DiagramHotspotGeometry`.
 */
export function fromV3HotspotGeometry(
  id: string,
  geometry: HotspotGeometry,
): DiagramHotspotGeometry {
  if (geometry.shape === "point") {
    return {
      id,
      shape_type: "point",
      x: clamp01(geometry.x),
      y: clamp01(geometry.y),
      radius: Math.max(
        MIN_POINT_RADIUS,
        Math.min(MAX_POINT_RADIUS, geometry.radius ?? DEFAULT_POINT_RADIUS),
      ),
    };
  }
  if (geometry.shape === "rect") {
    return {
      id,
      shape_type: "rect",
      x: clamp01(geometry.x),
      y: clamp01(geometry.y),
      width: clamp01(geometry.width),
      height: clamp01(geometry.height),
    };
  }
  return {
    id,
    shape_type: "polygon",
    points: geometry.points.map(clampNormalizedPoint),
  };
}

export function fromDiagramHotspot(
  hotspot: Pick<DiagramHotspot, "id" | "geometry">,
): DiagramHotspotGeometry {
  return fromV3HotspotGeometry(hotspot.id, hotspot.geometry);
}

/**
 * Converts a `DiagramHotspotGeometry` back into the canonical V3 `HotspotGeometry` DB/API payload.
 */
export function toV3HotspotGeometry(geometry: DiagramHotspotGeometry): HotspotGeometry {
  if (geometry.shape_type === "point") {
    return {
      shape: "point",
      x: clamp01(geometry.x),
      y: clamp01(geometry.y),
      radius: Math.max(MIN_POINT_RADIUS, Math.min(MAX_POINT_RADIUS, geometry.radius)),
    };
  }
  if (geometry.shape_type === "rect") {
    const x = clamp01(geometry.x);
    const y = clamp01(geometry.y);
    return {
      shape: "rect",
      x,
      y,
      width: Math.max(0.005, Math.min(1 - x, geometry.width)),
      height: Math.max(0.005, Math.min(1 - y, geometry.height)),
    };
  }
  return {
    shape: "polygon",
    points: geometry.points.map(clampNormalizedPoint),
  };
}

/**
 * Direct hit-test against a V3 `HotspotGeometry` (for exams, DiagramStudyPlayer, and ImageHotspot questions).
 */
export function hitTestV3HotspotGeometry(
  click: NormalizedPoint,
  geometry: HotspotGeometry,
  extraTolerance = 0,
): boolean {
  return hitTestHotspot(click, fromV3HotspotGeometry("target", geometry), extraTolerance);
}
