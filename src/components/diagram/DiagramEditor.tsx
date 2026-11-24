"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  CircleDot,
  Eye,
  Hexagon,
  ImagePlus,
  Loader2,
  MousePointer2,
  Pencil,
  RotateCcw,
  Save,
  Square,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { DiagramStudyPlayer } from "@/components/diagram/DiagramStudyPlayer";
import { ApiError, getFriendlyErrorMessage } from "@/components/layout/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  createDiagram,
  updateDiagram,
  type UpsertDiagramHotspotInput,
} from "@/lib/diagram/api";
import {
  clamp01,
  clampViewportTransform,
  DEFAULT_POINT_RADIUS,
  detectHotspotOverlaps,
  fromV3HotspotGeometry,
  getHotspotCentroid,
  MAX_POINT_RADIUS,
  MIN_POINT_RADIUS,
  remapHotspotsForImageChange,
  toV3HotspotGeometry,
  validateHotspotGeometry,
  validateImageDimensionRemap,
  viewportToNormalized,
  zoomAtViewportPoint,
  type ImageDimensionRemapReport,
  type ImageViewportMetrics,
  type NormalizedPoint,
  type ViewportTransform,
} from "@/lib/diagram/geometry";
import { useOptionalI18n } from "@/lib/i18n";
import { uploadImageSmart } from "@/lib/media/direct-upload";
import { resolveSafeMediaUrl } from "@/lib/media/urls";
import {
  extractImageDimensionsFromBytes,
  optimizeImageForUpload,
  validateRasterImage,
} from "@/lib/media/validation";
import { cn } from "@/lib/utils";
import type { DiagramHotspot, DiagramSet, HotspotGeometry, HotspotShape } from "@/types/v3";

type EditorTool = "select" | "add_point" | "add_rect" | "add_polygon";

interface DraftHotspot {
  localId: string;
  persistedId?: string;
  label: string;
  alternativesText: string;
  description: string;
  hint: string;
  shape: HotspotShape;
  geometry: HotspotGeometry;
}

export interface DiagramEditorProps {
  studySetId: string;
  initialDiagram?: DiagramSet | null;
  backHref?: string;
  onSaved?: (saved: DiagramSet) => void;
  className?: string;
}

function makeTempId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `hs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseAlternatives(text: string): string[] {
  return text
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function toDraftHotspots(diagram: DiagramSet | null | undefined): DraftHotspot[] {
  if (!diagram?.hotspots?.length) return [];
  return [...diagram.hotspots]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((h) => ({
      localId: h.id,
      persistedId: h.id,
      label: h.label,
      alternativesText: (h.accepted_alternatives ?? []).join(", "),
      description: h.description ?? "",
      hint: h.hint ?? "",
      shape: h.shape,
      geometry: h.geometry,
    }));
}

export function DiagramEditor({
  studySetId,
  initialDiagram = null,
  backHref,
  onSaved,
  className,
}: DiagramEditorProps) {
  const i18n = useOptionalI18n();
  const locale = i18n?.locale ?? "vi";
  const vi = locale === "vi";
  const router = useRouter();
  const baseId = React.useId();

  const [title, setTitle] = React.useState(initialDiagram?.title ?? "");
  const [description, setDescription] = React.useState(initialDiagram?.description ?? "");
  const [baseMediaId, setBaseMediaId] = React.useState<string | null>(
    initialDiagram?.base_media_id ?? null,
  );
  const [baseImageUrl, setBaseImageUrl] = React.useState(initialDiagram?.base_image_url ?? "");
  const [imageDims, setImageDims] = React.useState<{ width: number; height: number } | null>(
    initialDiagram?.image_width && initialDiagram?.image_height
      ? { width: initialDiagram.image_width, height: initialDiagram.image_height }
      : null,
  );
  const [preserveOriginal, setPreserveOriginal] = React.useState(true);
  const [hotspots, setHotspots] = React.useState<DraftHotspot[]>(() =>
    toDraftHotspots(initialDiagram),
  );
  const [selectedId, setSelectedId] = React.useState<string | null>(
    () => initialDiagram?.hotspots?.[0]?.id ?? null,
  );
  const [tool, setTool] = React.useState<EditorTool>("select");
  const [polygonDraft, setPolygonDraft] = React.useState<NormalizedPoint[]>([]);
  const [rectDrawOrigin, setRectDrawOrigin] = React.useState<NormalizedPoint | null>(null);
  const [rectDrawCurrent, setRectDrawCurrent] = React.useState<NormalizedPoint | null>(null);

  const [previewMode, setPreviewMode] = React.useState(false);
  const [isUploadingImage, setIsUploadingImage] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [remapWarning, setRemapWarning] = React.useState<{
    report: ImageDimensionRemapReport;
    oldDims: { width: number; height: number };
    newDims: { width: number; height: number };
  } | null>(null);

  const [transform, setTransform] = React.useState<ViewportTransform>({
    scale: 1,
    translateX: 0,
    translateY: 0,
  });

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const imageRef = React.useRef<HTMLImageElement>(null);

  const dragOpRef = React.useRef<
    | {
        kind: "move_point";
        hotspotId: string;
      }
    | {
        kind: "move_rect";
        hotspotId: string;
        offsetX: number;
        offsetY: number;
        width: number;
        height: number;
      }
    | {
        kind: "resize_rect";
        hotspotId: string;
        originX: number;
        originY: number;
      }
    | {
        kind: "move_vertex";
        hotspotId: string;
        vertexIndex: number;
      }
    | {
        kind: "pan";
        startX: number;
        startY: number;
        translateX: number;
        translateY: number;
      }
    | null
  >(null);

  const renderableImageUrl = React.useMemo(
    () =>
      resolveSafeMediaUrl({
        url: baseImageUrl,
        proxy_url: initialDiagram?.base_media?.proxy_url,
        storage_path: initialDiagram?.base_media?.storage_path,
      }),
    [baseImageUrl, initialDiagram?.base_media],
  );

  const geometryList = React.useMemo(
    () => hotspots.map((h) => fromV3HotspotGeometry(h.localId, h.geometry)),
    [hotspots],
  );

  const overlapWarnings = React.useMemo(
    () => detectHotspotOverlaps(geometryList, 0.006),
    [geometryList],
  );

  const overlappingIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const w of overlapWarnings) {
      if (w.severity === "overlap") {
        ids.add(w.hotspotAId);
        ids.add(w.hotspotBId);
      }
    }
    return ids;
  }, [overlapWarnings]);

  const selectedHotspot = hotspots.find((h) => h.localId === selectedId) ?? null;

  const computeStageMetrics = React.useCallback((): ImageViewportMetrics | null => {
    const stage = stageRef.current;
    const img = imageRef.current;
    if (!stage || !img) return null;
    const stageRect = stage.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    if (stageRect.width <= 0 || stageRect.height <= 0 || imgRect.width <= 0 || imgRect.height <= 0) {
      return null;
    }
    const baseImageWidth = imgRect.width / transform.scale;
    const baseImageHeight = imgRect.height / transform.scale;
    const baseOffsetX = (imgRect.left - stageRect.left - transform.translateX) / transform.scale;
    const baseOffsetY = (imgRect.top - stageRect.top - transform.translateY) / transform.scale;
    return {
      containerWidth: stageRect.width,
      containerHeight: stageRect.height,
      baseImageWidth,
      baseImageHeight,
      baseOffsetX,
      baseOffsetY,
    };
  }, [transform]);

  const clientToNormalized = React.useCallback(
    (clientX: number, clientY: number) => {
      const stage = stageRef.current;
      const metrics = computeStageMetrics();
      if (!stage || !metrics) return null;
      const rect = stage.getBoundingClientRect();
      return viewportToNormalized(
        { x: clientX - rect.left, y: clientY - rect.top },
        metrics,
        transform,
      );
    },
    [computeStageMetrics, transform],
  );

  const handleUploadBaseImage = async (file: File) => {
    setErrorMsg(null);
    setIsUploadingImage(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const validation = validateRasterImage(bytes, file.name, file.type);
      if (!validation.valid) {
        setErrorMsg(validation.message);
        return;
      }

      const rawDims = extractImageDimensionsFromBytes(bytes);
      let fileToUpload = file;
      let width = rawDims?.width ?? null;
      let height = rawDims?.height ?? null;

      try {
        const optimized = await optimizeImageForUpload(file, {
          preserveOriginal,
          diagramMode: true,
        });
        fileToUpload = optimized.file;
        width = optimized.width ?? width;
        height = optimized.height ?? height;
      } catch {
        // Keep validated original if browser canvas decode unavailable
      }

      const response = await uploadImageSmart({
        file: fileToUpload,
        fileName: fileToUpload.name,
        studySetId,
        purpose: "diagram",
        width: width && width > 0 ? Math.round(width) : undefined,
        height: height && height > 0 ? Math.round(height) : undefined,
      });

      const contentType = response.headers.get("content-type") ?? "";
      const parsed = contentType.includes("application/json")
        ? ((await response.json().catch(() => null)) as
            | {
                data?: Record<string, unknown>;
                error?: { code?: string; message?: string; details?: unknown };
                message?: string;
              }
            | null)
        : null;
      if (!response.ok) {
        if (parsed?.error) {
          throw new ApiError(
            parsed.error.code ?? "API_ERROR",
            parsed.error.message ?? response.statusText,
            response.status,
            parsed.error.details,
          );
        }
        throw new ApiError(
          "HTTP_ERROR",
          parsed?.message ?? (response.statusText || "Upload failed"),
          response.status,
        );
      }

      const d = (parsed?.data ?? parsed ?? {}) as Record<string, unknown>;
      const storagePath = String(d.path ?? d.storage_path ?? "");
      const nextUrl =
        resolveSafeMediaUrl({
          proxy_url:
            typeof d.proxyUrl === "string"
              ? d.proxyUrl
              : typeof d.proxy_url === "string"
                ? d.proxy_url
                : null,
          storage_path: storagePath,
        }) ?? "";

      const nextDims = width && height ? { width, height } : null;

      // Validate dimension remap if replacing an existing base image that has hotspots
      if (imageDims && nextDims && hotspots.length > 0) {
        const report = validateImageDimensionRemap(imageDims, nextDims, geometryList);
        if (report.requiresReview) {
          setRemapWarning({ report, oldDims: imageDims, newDims: nextDims });
        } else {
          setRemapWarning(null);
        }
      }

      setBaseMediaId(
        typeof d.mediaId === "string" ? d.mediaId : typeof d.id === "string" ? d.id : null,
      );
      setBaseImageUrl(nextUrl);
      if (nextDims) setImageDims(nextDims);
      setTransform({ scale: 1, translateX: 0, translateY: 0 });
      toast.success(vi ? "Đã tải ảnh sơ đồ lên." : "Diagram image uploaded.");
    } catch (err) {
      setErrorMsg(
        getFriendlyErrorMessage(
          err,
          locale,
          vi ? "Không thể tải ảnh sơ đồ lên." : "Failed to upload diagram image.",
        ),
      );
    } finally {
      setIsUploadingImage(false);
    }
  };

  const applyFitContainRemap = () => {
    if (!remapWarning) return;
    const remapped = remapHotspotsForImageChange(
      geometryList,
      remapWarning.oldDims,
      remapWarning.newDims,
      "fit_contain",
    );
    const byId = new Map(remapped.map((g) => [g.id, toV3HotspotGeometry(g)]));
    setHotspots((prev) =>
      prev.map((h) => ({
        ...h,
        geometry: byId.get(h.localId) ?? h.geometry,
      })),
    );
    setRemapWarning(null);
    toast.success(
      vi
        ? "Đã tự động căn lại tọa độ nhãn theo khung ảnh mới."
        : "Hotspots automatically remapped to fit the new image frame.",
    );
  };

  const addHotspot = (shape: HotspotShape, geometry: HotspotGeometry) => {
    const id = makeTempId();
    const indexNum = hotspots.length + 1;
    const next: DraftHotspot = {
      localId: id,
      label: vi ? `Vị trí ${indexNum}` : `Location ${indexNum}`,
      alternativesText: "",
      description: "",
      hint: "",
      shape,
      geometry,
    };
    setHotspots((prev) => [...prev, next]);
    setSelectedId(id);
    setTool("select");
  };

  const finishPolygon = () => {
    if (polygonDraft.length < 3) {
      setErrorMsg(
        vi ? "Đa giác cần ít nhất 3 đỉnh." : "A polygon requires at least 3 vertices.",
      );
      return;
    }
    addHotspot("polygon", { shape: "polygon", points: polygonDraft });
    setPolygonDraft([]);
    setErrorMsg(null);
  };

  const updateHotspotGeometry = (id: string, nextGeometry: HotspotGeometry) => {
    setHotspots((prev) =>
      prev.map((h) => (h.localId === id ? { ...h, geometry: nextGeometry } : h)),
    );
  };

  const updateHotspotField = <K extends keyof DraftHotspot>(
    id: string,
    field: K,
    val: DraftHotspot[K],
  ) => {
    setHotspots((prev) => prev.map((h) => (h.localId === id ? { ...h, [field]: val } : h)));
  };

  const deleteHotspot = (id: string) => {
    setHotspots((prev) => {
      const next = prev.filter((h) => h.localId !== id);
      if (selectedId === id) {
        setSelectedId(next[0]?.localId ?? null);
      }
      return next;
    });
  };

  const moveHotspotOrder = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= hotspots.length) return;
    setHotspots((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const handleStagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const stage = stageRef.current;
    if (!stage || !renderableImageUrl) return;

    const proj = clientToNormalized(event.clientX, event.clientY);
    if (!proj) return;

    if (tool === "add_point" && proj.isInsideImage) {
      addHotspot("point", {
        shape: "point",
        x: proj.clamped.x,
        y: proj.clamped.y,
        radius: DEFAULT_POINT_RADIUS,
      });
      return;
    }

    if (tool === "add_rect" && proj.isInsideImage) {
      stage.setPointerCapture?.(event.pointerId);
      setRectDrawOrigin(proj.clamped);
      setRectDrawCurrent(proj.clamped);
      return;
    }

    if (tool === "add_polygon" && proj.isInsideImage) {
      // Clicking close to vertex 0 with >= 3 vertices closes the polygon
      if (
        polygonDraft.length >= 3 &&
        Math.hypot(
          proj.clamped.x - polygonDraft[0].x,
          proj.clamped.y - polygonDraft[0].y,
        ) < 0.025
      ) {
        finishPolygon();
        return;
      }
      if (polygonDraft.length >= 64) {
        setErrorMsg(
          vi
            ? "Đa giác hỗ trợ tối đa 64 đỉnh. Hãy nhấn Hoàn tất đa giác."
            : "Polygons support at most 64 vertices. Click Finish polygon to complete.",
        );
        return;
      }
      setPolygonDraft((prev) => [...prev, proj.clamped]);
      return;
    }

    // Select mode: pan if zoomed and clicked on blank background
    if (tool === "select" && transform.scale > 1) {
      stage.setPointerCapture?.(event.pointerId);
      const rect = stage.getBoundingClientRect();
      dragOpRef.current = {
        kind: "pan",
        startX: event.clientX - rect.left,
        startY: event.clientY - rect.top,
        translateX: transform.translateX,
        translateY: transform.translateY,
      };
    }
  };

  const handleStagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;

    if (rectDrawOrigin) {
      const proj = clientToNormalized(event.clientX, event.clientY);
      if (proj) setRectDrawCurrent(proj.clamped);
      return;
    }

    const op = dragOpRef.current;
    if (!op) return;

    if (op.kind === "pan") {
      const rect = stage.getBoundingClientRect();
      const dx = event.clientX - rect.left - op.startX;
      const dy = event.clientY - rect.top - op.startY;
      setTransform((prev) =>
        clampViewportTransform(
          { scale: prev.scale, translateX: op.translateX + dx, translateY: op.translateY + dy },
          { minScale: 1, maxScale: 5, containerWidth: rect.width, containerHeight: rect.height },
        ),
      );
      return;
    }

    const proj = clientToNormalized(event.clientX, event.clientY);
    if (!proj) return;
    const pt = proj.clamped;

    if (op.kind === "move_point") {
      const current = hotspots.find((h) => h.localId === op.hotspotId);
      if (current && current.geometry.shape === "point") {
        updateHotspotGeometry(op.hotspotId, {
          ...current.geometry,
          x: pt.x,
          y: pt.y,
        });
      }
    } else if (op.kind === "move_rect") {
      const x = Math.max(0, Math.min(1 - op.width, pt.x - op.offsetX));
      const y = Math.max(0, Math.min(1 - op.height, pt.y - op.offsetY));
      updateHotspotGeometry(op.hotspotId, {
        shape: "rect",
        x,
        y,
        width: op.width,
        height: op.height,
      });
    } else if (op.kind === "resize_rect") {
      const x = Math.min(op.originX, pt.x);
      const y = Math.min(op.originY, pt.y);
      const width = Math.max(0.02, Math.abs(pt.x - op.originX));
      const height = Math.max(0.02, Math.abs(pt.y - op.originY));
      updateHotspotGeometry(op.hotspotId, {
        shape: "rect",
        x: clamp01(x),
        y: clamp01(y),
        width: Math.min(1 - clamp01(x), width),
        height: Math.min(1 - clamp01(y), height),
      });
    } else if (op.kind === "move_vertex") {
      const current = hotspots.find((h) => h.localId === op.hotspotId);
      if (current && current.geometry.shape === "polygon") {
        const nextPts = current.geometry.points.map((p, i) =>
          i === op.vertexIndex ? pt : p,
        );
        updateHotspotGeometry(op.hotspotId, {
          shape: "polygon",
          points: nextPts,
        });
      }
    }
  };

  const handleStagePointerUp = () => {
    if (rectDrawOrigin && rectDrawCurrent) {
      const rawW = Math.abs(rectDrawCurrent.x - rectDrawOrigin.x);
      const rawH = Math.abs(rectDrawCurrent.y - rectDrawOrigin.y);

      if (rawW < 0.015 && rawH < 0.015) {
        // Quick tap fallback: place default 16% x 12% rect centered on click
        const w = 0.16;
        const h = 0.12;
        const x = Math.max(0, Math.min(1 - w, rectDrawOrigin.x - w / 2));
        const y = Math.max(0, Math.min(1 - h, rectDrawOrigin.y - h / 2));
        addHotspot("rect", { shape: "rect", x, y, width: w, height: h });
      } else {
        const x = Math.min(rectDrawOrigin.x, rectDrawCurrent.x);
        const y = Math.min(rectDrawOrigin.y, rectDrawCurrent.y);
        addHotspot("rect", {
          shape: "rect",
          x,
          y,
          width: Math.max(0.02, rawW),
          height: Math.max(0.02, rawH),
        });
      }
      setRectDrawOrigin(null);
      setRectDrawCurrent(null);
    }

    dragOpRef.current = null;
  };

  const zoomBy = (delta: number) => {
    const stage = stageRef.current;
    const cw = stage?.clientWidth ?? 800;
    const ch = stage?.clientHeight ?? 500;
    setTransform((prev) =>
      zoomAtViewportPoint(
        prev,
        prev.scale + delta,
        { x: cw / 2, y: ch / 2 },
        { minScale: 1, maxScale: 5, containerWidth: cw, containerHeight: ch },
      ),
    );
  };

  const handleSave = async () => {
    setErrorMsg(null);
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setErrorMsg(vi ? "Vui lòng nhập tiêu đề cho sơ đồ." : "Please enter a diagram title.");
      return;
    }
    if (!baseImageUrl) {
      setErrorMsg(vi ? "Vui lòng tải ảnh sơ đồ gốc." : "Please upload a base diagram image.");
      return;
    }
    if (hotspots.length === 0) {
      setErrorMsg(
        vi ? "Vui lòng gắn ít nhất một nhãn vị trí trên sơ đồ." : "Please add at least one hotspot.",
      );
      return;
    }

    for (let i = 0; i < hotspots.length; i += 1) {
      const hs = hotspots[i];
      if (!hs.label.trim()) {
        setErrorMsg(
          vi
            ? `Nhãn số ${i + 1} chưa có tên. Vui lòng điền tên nhãn.`
            : `Hotspot #${i + 1} is missing a label.`,
        );
        setSelectedId(hs.localId);
        return;
      }
      const geomCheck = validateHotspotGeometry(fromV3HotspotGeometry(hs.localId, hs.geometry));
      if (!geomCheck.valid) {
        setErrorMsg(
          vi
            ? `Nhãn "${hs.label}" có tọa độ chưa hợp lệ: ${geomCheck.errors[0]}`
            : `Hotspot "${hs.label}" has invalid geometry: ${geomCheck.errors[0]}`,
        );
        setSelectedId(hs.localId);
        return;
      }
    }

    const payloadHotspots: UpsertDiagramHotspotInput[] = hotspots.map((hs, idx) => ({
      id: hs.persistedId,
      label: hs.label.trim(),
      accepted_alternatives: parseAlternatives(hs.alternativesText).slice(0, 20),
      description: hs.description.trim() || null,
      hint: hs.hint.trim() || null,
      shape: hs.shape,
      geometry: hs.geometry,
      sort_order: idx,
    }));

    setIsSaving(true);
    try {
      const saved = initialDiagram?.id
        ? await updateDiagram(initialDiagram.id, {
            title: trimmedTitle,
            description: description.trim() || null,
            base_media_id: baseMediaId,
            base_image_url: baseImageUrl,
            image_width: imageDims ? Math.round(imageDims.width) : null,
            image_height: imageDims ? Math.round(imageDims.height) : null,
            hotspots: payloadHotspots,
          })
        : await createDiagram({
            study_set_id: studySetId,
            title: trimmedTitle,
            description: description.trim() || null,
            base_media_id: baseMediaId,
            base_image_url: baseImageUrl,
            image_width: imageDims ? Math.round(imageDims.width) : null,
            image_height: imageDims ? Math.round(imageDims.height) : null,
            hotspots: payloadHotspots,
          });

      // Sync persisted server UUIDs back into draft hotspots so repeat saves update in place
      if (saved.hotspots && saved.hotspots.length > 0) {
        const synced = toDraftHotspots(saved);
        setHotspots(synced);
        setSelectedId((prev) =>
          prev && synced.some((h) => h.localId === prev) ? prev : (synced[0]?.localId ?? null),
        );
      }

      toast.success(vi ? "Đã lưu sơ đồ thành công!" : "Diagram saved successfully!");
      if (onSaved) {
        onSaved(saved);
      } else if (!initialDiagram?.id && saved.id) {
        router.push(`/diagrams/${saved.id}/edit`);
      }
    } catch (err) {
      const msg = getFriendlyErrorMessage(
        err,
        locale,
        vi ? "Không thể lưu sơ đồ. Vui lòng thử lại." : "Failed to save diagram.",
      );
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  // Build live DiagramSet draft for inline Preview Mode
  const previewDiagram = React.useMemo<DiagramSet>(() => {
    const now = new Date().toISOString();
    const mappedHotspots: DiagramHotspot[] = hotspots.map((h, idx) => ({
      id: h.localId,
      diagram_id: initialDiagram?.id ?? "draft",
      study_set_id: studySetId,
      label: h.label.trim() || `${vi ? "Vị trí" : "Location"} ${idx + 1}`,
      accepted_alternatives: parseAlternatives(h.alternativesText),
      description: h.description.trim() || null,
      hint: h.hint.trim() || null,
      shape: h.shape,
      geometry: h.geometry,
      sort_order: idx,
      created_at: now,
      updated_at: now,
    }));
    return {
      id: initialDiagram?.id ?? "draft",
      study_set_id: studySetId,
      owner_id: initialDiagram?.owner_id ?? "",
      title: title.trim() || (vi ? "Bản xem trước sơ đồ" : "Diagram Preview"),
      description: description.trim() || null,
      base_media_id: baseMediaId,
      base_image_url: baseImageUrl,
      image_width: imageDims?.width ?? null,
      image_height: imageDims?.height ?? null,
      content_version: initialDiagram?.content_version ?? 1,
      created_at: now,
      updated_at: now,
      hotspots: mappedHotspots,
    };
  }, [hotspots, initialDiagram, studySetId, title, description, baseMediaId, baseImageUrl, imageDims, vi]);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {backHref && (
            <Button asChild variant="outline" size="sm" className="min-h-10 gap-1.5 sm:min-h-9">
              <Link href={backHref}>
                <ArrowLeft className="size-4" aria-hidden="true" />
                <span>{vi ? "Quay lại" : "Back"}</span>
              </Link>
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-foreground sm:text-xl">
              {initialDiagram?.id
                ? vi
                  ? "Chỉnh sửa sơ đồ tương tác"
                  : "Edit Interactive Diagram"
                : vi
                  ? "Tạo sơ đồ tương tác mới"
                  : "Create Interactive Diagram"}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={previewMode ? "secondary" : "outline"}
            size="sm"
            disabled={!renderableImageUrl || hotspots.length === 0}
            onClick={() => setPreviewMode((prev) => !prev)}
            className="min-h-10 gap-1.5 sm:min-h-9"
          >
            {previewMode ? (
              <>
                <Pencil className="size-4" aria-hidden="true" />
                <span>{vi ? "Quay lại chỉnh sửa" : "Back to editor"}</span>
              </>
            ) : (
              <>
                <Eye className="size-4" aria-hidden="true" />
                <span>{vi ? "Xem trước (6 chế độ)" : "Preview (6 modes)"}</span>
              </>
            )}
          </Button>

          <Button
            type="button"
            disabled={isSaving || isUploadingImage}
            onClick={() => void handleSave()}
            className="min-h-10 gap-1.5 sm:min-h-9"
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            <span>{vi ? "Lưu sơ đồ" : "Save diagram"}</span>
          </Button>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-subtle px-3.5 py-2.5 text-sm text-destructive-subtle-foreground"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Aspect-Ratio Remap Warning when swapping base image */}
      {remapWarning && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning-subtle px-4 py-3 text-xs text-warning-subtle-foreground"
        >
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              {vi
                ? `Tỷ lệ khung hình ảnh mới lệch ${remapWarning.report.aspectRatioDeltaPercent.toFixed(1)}% so với ảnh cũ (${remapWarning.report.affectedHotspotCount} nhãn có thể bị lệch vị trí).`
                : `New image aspect ratio differs by ${remapWarning.report.aspectRatioDeltaPercent.toFixed(1)}% (${remapWarning.report.affectedHotspotCount} hotspots may shift).`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={applyFitContainRemap}>
              {vi ? "Tự động căn khung" : "Auto fit-contain"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setRemapWarning(null)}
            >
              {vi ? "Giữ nguyên" : "Keep as-is"}
            </Button>
          </div>
        </div>
      )}

      {/* Overlap Ambiguity Warning */}
      {overlapWarnings.length > 0 && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-subtle px-3.5 py-2.5 text-xs text-warning-subtle-foreground"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-semibold">
              {vi
                ? `Phát hiện ${overlapWarnings.length} cặp vùng nhãn đang chồng lấn hoặc quá sát nhau:`
                : `Detected ${overlapWarnings.length} overlapping or near-touching hotspot pair(s):`}
            </p>
            <ul className="list-disc pl-4 space-y-0.5">
              {overlapWarnings.slice(0, 5).map((w) => {
                const a = hotspots.find((h) => h.localId === w.hotspotAId)?.label ?? w.hotspotAId;
                const b = hotspots.find((h) => h.localId === w.hotspotBId)?.label ?? w.hotspotBId;
                return (
                  <li key={`${w.hotspotAId}-${w.hotspotBId}`}>
                    <strong>{a}</strong> ↔ <strong>{b}</strong> (
                    {w.severity === "overlap"
                      ? vi
                        ? "chồng lấn trực tiếp"
                        : "direct overlap"
                      : vi
                        ? "rất gần nhau"
                        : "very close"}
                    )
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {previewMode ? (
        <DiagramStudyPlayer diagram={previewDiagram} previewOnly />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* Left: Diagram Canvas + Drawing Toolbar */}
          <div className="space-y-3">
            {/* Metadata Inputs */}
            <Card>
              <CardContent className="grid gap-3 pt-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`${baseId}-title`}>
                    {vi ? "Tên sơ đồ *" : "Diagram title *"}
                  </Label>
                  <Input
                    id={`${baseId}-title`}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={
                      vi ? "VD: Cấu tạo cánh máy bay" : "e.g., Aircraft wing control surfaces"
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${baseId}-desc`}>
                    {vi ? "Mô tả ngắn" : "Short description"}
                  </Label>
                  <Input
                    id={`${baseId}-desc`}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={vi ? "Ghi chú ngữ cảnh sơ đồ…" : "Optional context…"}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Hidden raster image upload input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUploadBaseImage(file);
                e.target.value = "";
              }}
              className="sr-only"
              aria-label={vi ? "Chọn ảnh sơ đồ gốc" : "Choose base diagram image"}
            />

            {/* Drawing Toolbar */}
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={tool === "select" ? "default" : "outline"}
                    onClick={() => {
                      setTool("select");
                      setPolygonDraft([]);
                    }}
                    className="min-h-10 gap-1.5 sm:min-h-9"
                  >
                    <MousePointer2 className="size-3.5" aria-hidden="true" />
                    <span>{vi ? "Chọn / Kéo" : "Select / Move"}</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={tool === "add_point" ? "default" : "outline"}
                    disabled={!renderableImageUrl}
                    onClick={() => {
                      setTool("add_point");
                      setPolygonDraft([]);
                    }}
                    className="min-h-10 gap-1.5 sm:min-h-9"
                  >
                    <CircleDot className="size-3.5" aria-hidden="true" />
                    <span>{vi ? "Điểm" : "Point"}</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={tool === "add_rect" ? "default" : "outline"}
                    disabled={!renderableImageUrl}
                    onClick={() => {
                      setTool("add_rect");
                      setPolygonDraft([]);
                    }}
                    className="min-h-10 gap-1.5 sm:min-h-9"
                  >
                    <Square className="size-3.5" aria-hidden="true" />
                    <span>{vi ? "Chữ nhật" : "Rect"}</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={tool === "add_polygon" ? "default" : "outline"}
                    disabled={!renderableImageUrl}
                    onClick={() => setTool("add_polygon")}
                    className="min-h-10 gap-1.5 sm:min-h-9"
                  >
                    <Hexagon className="size-3.5" aria-hidden="true" />
                    <span>{vi ? "Đa giác" : "Polygon"}</span>
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isUploadingImage}
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-10 gap-1.5 sm:min-h-9"
                  >
                    {isUploadingImage ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <ImagePlus className="size-3.5" aria-hidden="true" />
                    )}
                    <span>
                      {renderableImageUrl
                        ? vi
                          ? "Đổi ảnh"
                          : "Replace image"
                        : vi
                          ? "Tải ảnh sơ đồ"
                          : "Upload image"}
                    </span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => zoomBy(-0.5)}
                    disabled={transform.scale <= 1}
                    aria-label={vi ? "Thu nhỏ" : "Zoom out"}
                    className="min-h-10 min-w-10 sm:min-h-9 sm:min-w-9"
                  >
                    <ZoomOut className="size-3.5" aria-hidden="true" />
                  </Button>
                  <span className="min-w-11 text-center text-xs font-medium tabular-nums">
                    {Math.round(transform.scale * 100)}%
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => zoomBy(0.5)}
                    disabled={transform.scale >= 5}
                    aria-label={vi ? "Phóng to" : "Zoom in"}
                    className="min-h-10 min-w-10 sm:min-h-9 sm:min-w-9"
                  >
                    <ZoomIn className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setTransform({ scale: 1, translateX: 0, translateY: 0 })}
                    disabled={transform.scale === 1}
                    aria-label={vi ? "Đặt lại thu phóng" : "Reset zoom"}
                    className="min-h-10 min-w-10 sm:min-h-9 sm:min-w-9"
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>

              {/* Active Polygon Draft Helper Bar */}
              {tool === "add_polygon" && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-accent/50 px-3 py-2 text-xs">
                  <span>
                    {vi
                      ? `Nhấn lên sơ đồ để thêm đỉnh đa giác (đã chấm ${polygonDraft.length} đỉnh, cần >= 3).`
                      : `Click on the diagram to place polygon vertices (${polygonDraft.length} placed, need >= 3).`}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={polygonDraft.length === 0}
                      onClick={() => setPolygonDraft((prev) => prev.slice(0, -1))}
                      className="h-8 gap-1 text-xs"
                    >
                      <Undo2 className="size-3" aria-hidden="true" />
                      <span>{vi ? "Hoàn tác đỉnh" : "Undo point"}</span>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={polygonDraft.length < 3}
                      onClick={finishPolygon}
                      className="h-8 gap-1 text-xs"
                    >
                      <Check className="size-3" aria-hidden="true" />
                      <span>{vi ? "Hoàn tất đa giác" : "Finish polygon"}</span>
                    </Button>
                  </div>
                </div>
              )}

              {/* Interactive Canvas Stage */}
              <div
                ref={stageRef}
                onPointerDown={handleStagePointerDown}
                onPointerMove={handleStagePointerMove}
                onPointerUp={handleStagePointerUp}
                onPointerCancel={handleStagePointerUp}
                style={{ touchAction: "none" }}
                className={cn(
                  "relative flex min-h-[360px] max-h-[68vh] items-center justify-center overflow-hidden bg-muted/35 select-none sm:min-h-[460px]",
                  tool !== "select" ? "cursor-crosshair" : "cursor-default",
                )}
              >
                {!renderableImageUrl ? (
                  <div className="flex max-w-sm flex-col items-center gap-3 p-6 text-center">
                    <ImagePlus className="size-10 text-muted-foreground" aria-hidden="true" />
                    <p className="text-sm font-medium text-foreground">
                      {vi
                        ? "Tải lên ảnh sơ đồ kỹ thuật (PNG, JPG, WebP, GIF)"
                        : "Upload a diagram image (PNG, JPG, WebP, GIF)"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {vi
                        ? "Tọa độ nhãn được lưu chuẩn hóa [0..1] nên hiển thị chính xác trên cả máy tính và điện thoại."
                        : "Hotspot coordinates are stored normalized in [0..1] for pixel-accurate alignment across all screens."}
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <Switch
                        id={`${baseId}-lossless`}
                        checked={preserveOriginal}
                        onCheckedChange={setPreserveOriginal}
                      />
                      <Label htmlFor={`${baseId}-lossless`} className="text-xs font-normal">
                        {vi ? "Giữ độ phân giải gốc (không nén)" : "Keep original lossless quality"}
                      </Label>
                    </div>
                    <Button
                      type="button"
                      disabled={isUploadingImage}
                      onClick={() => fileInputRef.current?.click()}
                      className="min-h-11 gap-2"
                    >
                      {isUploadingImage ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <ImagePlus className="size-4" aria-hidden="true" />
                      )}
                      <span>{vi ? "Chọn ảnh sơ đồ" : "Choose diagram image"}</span>
                    </Button>
                  </div>
                ) : (
                  <div
                    style={{
                      transform: `translate3d(${transform.translateX}px, ${transform.translateY}px, 0) scale(${transform.scale})`,
                      transformOrigin: "0 0",
                    }}
                    className="relative inline-flex max-h-full max-w-full items-center justify-center p-2"
                  >
                    <div className="relative inline-block max-h-[64vh] max-w-full">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        ref={imageRef}
                        src={renderableImageUrl}
                        alt={title || (vi ? "Ảnh sơ đồ" : "Diagram image")}
                        draggable={false}
                        onLoad={(e) => {
                          const imgEl = e.currentTarget;
                          if (!imageDims && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
                            setImageDims({
                              width: imgEl.naturalWidth,
                              height: imgEl.naturalHeight,
                            });
                          }
                        }}
                        className="block max-h-[64vh] max-w-full object-contain pointer-events-none rounded-md"
                      />

                      {/* Interactive SVG Layer */}
                      <svg
                        viewBox="0 0 1000 1000"
                        preserveAspectRatio="none"
                        className="absolute inset-0 h-full w-full"
                      >
                        {hotspots.map((hs) => {
                          const geom = fromV3HotspotGeometry(hs.localId, hs.geometry);
                          const isSelected = hs.localId === selectedId;
                          const isOverlap = overlappingIds.has(hs.localId);
                          const shapeClass = isOverlap
                            ? isSelected
                              ? "fill-warning/35 stroke-warning stroke-[3]"
                              : "fill-warning/20 stroke-warning stroke-[2]"
                            : isSelected
                              ? "fill-primary/30 stroke-primary stroke-[3]"
                              : "fill-accent-solid/20 stroke-accent-solid stroke-[2]";

                          if (geom.shape_type === "point") {
                            return (
                              <circle
                                key={hs.localId}
                                cx={geom.x * 1000}
                                cy={geom.y * 1000}
                                r={geom.radius * 1000}
                                vectorEffect="non-scaling-stroke"
                                className={cn(shapeClass, tool === "select" ? "cursor-move" : "")}
                                onPointerDown={(e) => {
                                  if (tool !== "select") return;
                                  e.stopPropagation();
                                  stageRef.current?.setPointerCapture?.(e.pointerId);
                                  setSelectedId(hs.localId);
                                  dragOpRef.current = { kind: "move_point", hotspotId: hs.localId };
                                }}
                              />
                            );
                          }

                          if (geom.shape_type === "rect") {
                            return (
                              <g key={hs.localId}>
                                <rect
                                  x={geom.x * 1000}
                                  y={geom.y * 1000}
                                  width={geom.width * 1000}
                                  height={geom.height * 1000}
                                  rx={4}
                                  vectorEffect="non-scaling-stroke"
                                  className={cn(shapeClass, tool === "select" ? "cursor-move" : "")}
                                  onPointerDown={(e) => {
                                    if (tool !== "select") return;
                                    e.stopPropagation();
                                    stageRef.current?.setPointerCapture?.(e.pointerId);
                                    setSelectedId(hs.localId);
                                    const pt = clientToNormalized(e.clientX, e.clientY)?.clamped;
                                    if (!pt) return;
                                    dragOpRef.current = {
                                      kind: "move_rect",
                                      hotspotId: hs.localId,
                                      offsetX: pt.x - geom.x,
                                      offsetY: pt.y - geom.y,
                                      width: geom.width,
                                      height: geom.height,
                                    };
                                  }}
                                />
                                {/* Bottom-right resize handle for selected rect */}
                                {isSelected && tool === "select" && (
                                  <rect
                                    x={(geom.x + geom.width) * 1000 - 14}
                                    y={(geom.y + geom.height) * 1000 - 14}
                                    width={28}
                                    height={28}
                                    rx={4}
                                    vectorEffect="non-scaling-stroke"
                                    className="cursor-nwse-resize fill-primary stroke-white stroke-[2]"
                                    onPointerDown={(e) => {
                                      e.stopPropagation();
                                      stageRef.current?.setPointerCapture?.(e.pointerId);
                                      dragOpRef.current = {
                                        kind: "resize_rect",
                                        hotspotId: hs.localId,
                                        originX: geom.x,
                                        originY: geom.y,
                                      };
                                    }}
                                  />
                                )}
                              </g>
                            );
                          }

                          const ptsStr = geom.points
                            .map((p) => `${p.x * 1000},${p.y * 1000}`)
                            .join(" ");
                          return (
                            <g key={hs.localId}>
                              <polygon
                                points={ptsStr}
                                vectorEffect="non-scaling-stroke"
                                className={cn(shapeClass, tool === "select" ? "cursor-pointer" : "")}
                                onPointerDown={(e) => {
                                  if (tool !== "select") return;
                                  e.stopPropagation();
                                  setSelectedId(hs.localId);
                                }}
                              />
                              {/* Draggable vertex handles when selected */}
                              {isSelected &&
                                tool === "select" &&
                                geom.points.map((pt, vIdx) => (
                                  <circle
                                    key={`${hs.localId}-v-${vIdx}`}
                                    cx={pt.x * 1000}
                                    cy={pt.y * 1000}
                                    r={14}
                                    vectorEffect="non-scaling-stroke"
                                    className="cursor-grab fill-primary stroke-white stroke-[2]"
                                    onPointerDown={(e) => {
                                      e.stopPropagation();
                                      stageRef.current?.setPointerCapture?.(e.pointerId);
                                      dragOpRef.current = {
                                        kind: "move_vertex",
                                        hotspotId: hs.localId,
                                        vertexIndex: vIdx,
                                      };
                                    }}
                                  />
                                ))}
                            </g>
                          );
                        })}

                        {/* Live Rectangle Drag Preview */}
                        {rectDrawOrigin && rectDrawCurrent && (
                          <rect
                            x={Math.min(rectDrawOrigin.x, rectDrawCurrent.x) * 1000}
                            y={Math.min(rectDrawOrigin.y, rectDrawCurrent.y) * 1000}
                            width={Math.abs(rectDrawCurrent.x - rectDrawOrigin.x) * 1000}
                            height={Math.abs(rectDrawCurrent.y - rectDrawOrigin.y) * 1000}
                            vectorEffect="non-scaling-stroke"
                            strokeDasharray="6 4"
                            className="fill-primary/20 stroke-primary stroke-[2]"
                          />
                        )}

                        {/* Live Polygon Draft Preview */}
                        {polygonDraft.length > 0 && (
                          <g>
                            <polyline
                              points={polygonDraft
                                .map((p) => `${p.x * 1000},${p.y * 1000}`)
                                .join(" ")}
                              vectorEffect="non-scaling-stroke"
                              className="fill-primary/15 stroke-primary stroke-[2]"
                            />
                            {polygonDraft.map((p, i) => (
                              <circle
                                key={`draft-${i}`}
                                cx={p.x * 1000}
                                cy={p.y * 1000}
                                r={10}
                                vectorEffect="non-scaling-stroke"
                                className={
                                  i === 0
                                    ? "fill-success stroke-white stroke-[2]"
                                    : "fill-primary stroke-white stroke-[2]"
                                }
                              />
                            ))}
                          </g>
                        )}
                      </svg>

                      {/* Numbered Pin Badges for visual clarity */}
                      {hotspots.map((hs, idx) => {
                        const centroid = getHotspotCentroid(
                          fromV3HotspotGeometry(hs.localId, hs.geometry),
                        );
                        const isSelected = hs.localId === selectedId;
                        return (
                          <button
                            key={`badge-${hs.localId}`}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedId(hs.localId);
                            }}
                            style={{
                              left: `${centroid.x * 100}%`,
                              top: `${centroid.y * 100}%`,
                            }}
                            aria-label={`${idx + 1}. ${hs.label}`}
                            className={cn(
                              "pointer-events-auto absolute z-10 inline-flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-[11px] font-bold shadow-sm transition-transform",
                              isSelected
                                ? "scale-110 border-white bg-primary text-primary-foreground"
                                : "border-white bg-slate-900/85 text-white dark:bg-slate-100 dark:text-slate-950",
                            )}
                          >
                            {idx + 1}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Right: Hotspot List + Selected Hotspot Inspector */}
          <div className="space-y-4">
            {/* Hotspot List */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b border-border py-3">
                <CardTitle className="text-sm font-semibold">
                  {vi ? "Danh sách nhãn vị trí" : "Labeled Hotspots"}
                </CardTitle>
                <Badge variant="secondary" className="tabular-nums">
                  {hotspots.length}
                </Badge>
              </CardHeader>
              <CardContent className="pt-3">
                {hotspots.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {vi
                      ? "Chọn công cụ Điểm, Chữ nhật hoặc Đa giác rồi nhấn lên ảnh để tạo nhãn đầu tiên."
                      : "Pick Point, Rect, or Polygon above and click on the diagram to create your first hotspot."}
                  </p>
                ) : (
                  <ul className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                    {hotspots.map((hs, idx) => {
                      const isSelected = hs.localId === selectedId;
                      const isOverlap = overlappingIds.has(hs.localId);
                      return (
                        <li
                          key={hs.localId}
                          className={cn(
                            "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-colors",
                            isSelected
                              ? "border-primary bg-accent/60"
                              : "border-border bg-card",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedId(hs.localId)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-medium text-foreground"
                          >
                            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold tabular-nums text-primary">
                              {idx + 1}
                            </span>
                            <span className="truncate">{hs.label || "—"}</span>
                            {isOverlap && (
                              <AlertTriangle
                                className="size-3.5 shrink-0 text-warning"
                                aria-label={vi ? "Đang chồng lấn" : "Overlapping"}
                              />
                            )}
                          </button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={idx === 0}
                            onClick={() => moveHotspotOrder(idx, -1)}
                            aria-label={vi ? "Lên trên" : "Move up"}
                            className="size-7"
                          >
                            <ArrowUp className="size-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={idx === hotspots.length - 1}
                            onClick={() => moveHotspotOrder(idx, 1)}
                            aria-label={vi ? "Xuống dưới" : "Move down"}
                            className="size-7"
                          >
                            <ArrowDown className="size-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteHotspot(hs.localId)}
                            aria-label={vi ? "Xóa nhãn" : "Delete hotspot"}
                            className="size-7 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Selected Hotspot Properties Inspector */}
            {selectedHotspot && (
              <Card>
                <CardHeader className="border-b border-border py-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm font-semibold">
                      {vi ? "Thuộc tính nhãn đang chọn" : "Selected Hotspot"}
                    </CardTitle>
                    <Badge variant="outline" className="text-xs uppercase">
                      {selectedHotspot.shape}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-4">
                  <div className="space-y-1">
                    <Label htmlFor={`${baseId}-hs-label`}>
                      {vi ? "Tên nhãn vị trí *" : "Hotspot label *"}
                    </Label>
                    <Input
                      id={`${baseId}-hs-label`}
                      value={selectedHotspot.label}
                      onChange={(e) =>
                        updateHotspotField(selectedHotspot.localId, "label", e.target.value)
                      }
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor={`${baseId}-hs-alt`}>
                      {vi
                        ? "Các tên gọi khác được chấp nhận (phân tách bằng dấu phẩy)"
                        : "Accepted alternative answers (comma-separated)"}
                    </Label>
                    <Input
                      id={`${baseId}-hs-alt`}
                      value={selectedHotspot.alternativesText}
                      onChange={(e) =>
                        updateHotspotField(
                          selectedHotspot.localId,
                          "alternativesText",
                          e.target.value,
                        )
                      }
                      placeholder={vi ? "VD: Flaps, Cánh tà sau" : "e.g., Flaps, Trailing flap"}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor={`${baseId}-hs-desc`}>
                      {vi ? "Mô tả / giải thích chi tiết" : "Description / explanation"}
                    </Label>
                    <Textarea
                      id={`${baseId}-hs-desc`}
                      rows={3}
                      value={selectedHotspot.description}
                      onChange={(e) =>
                        updateHotspotField(
                          selectedHotspot.localId,
                          "description",
                          e.target.value,
                        )
                      }
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor={`${baseId}-hs-hint`}>
                      {vi ? "Gợi ý khi học" : "Study hint"}
                    </Label>
                    <Input
                      id={`${baseId}-hs-hint`}
                      value={selectedHotspot.hint}
                      onChange={(e) =>
                        updateHotspotField(selectedHotspot.localId, "hint", e.target.value)
                      }
                    />
                  </div>

                  {/* Point Radius Slider */}
                  {selectedHotspot.geometry.shape === "point" && (
                    <div className="space-y-1 border-t border-border pt-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <Label htmlFor={`${baseId}-pt-radius`}>
                          {vi ? "Bán kính vùng chấm điểm" : "Hit tolerance radius"}
                        </Label>
                        <span className="tabular-nums text-muted-foreground">
                          {Math.round(
                            (selectedHotspot.geometry.radius ?? DEFAULT_POINT_RADIUS) * 1000,
                          ) / 10}
                          %
                        </span>
                      </div>
                      <input
                        id={`${baseId}-pt-radius`}
                        type="range"
                        min={Math.round(MIN_POINT_RADIUS * 1000)}
                        max={Math.round(MAX_POINT_RADIUS * 1000)}
                        value={Math.round(
                          (selectedHotspot.geometry.radius ?? DEFAULT_POINT_RADIUS) * 1000,
                        )}
                        onChange={(e) => {
                          const radius = Number(e.target.value) / 1000;
                          if (selectedHotspot.geometry.shape === "point") {
                            updateHotspotGeometry(selectedHotspot.localId, {
                              ...selectedHotspot.geometry,
                              radius,
                            });
                          }
                        }}
                        className="w-full"
                      />
                    </div>
                  )}

                  {/* Accessible Coordinate Readout */}
                  <div className="rounded-md bg-muted/40 px-2.5 py-1.5 text-[11px] tabular-nums text-muted-foreground">
                    {selectedHotspot.geometry.shape === "point" && (
                      <span>
                        x={(selectedHotspot.geometry.x * 100).toFixed(1)}% · y=
                        {(selectedHotspot.geometry.y * 100).toFixed(1)}%
                      </span>
                    )}
                    {selectedHotspot.geometry.shape === "rect" && (
                      <span>
                        x={(selectedHotspot.geometry.x * 100).toFixed(1)}% · y=
                        {(selectedHotspot.geometry.y * 100).toFixed(1)}% · w=
                        {(selectedHotspot.geometry.width * 100).toFixed(1)}% · h=
                        {(selectedHotspot.geometry.height * 100).toFixed(1)}%
                      </span>
                    )}
                    {selectedHotspot.geometry.shape === "polygon" && (
                      <span>
                        {vi
                          ? `${selectedHotspot.geometry.points.length} đỉnh (kéo các chấm tròn để điều chỉnh)`
                          : `${selectedHotspot.geometry.points.length} vertices (drag handles to refine)`}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
