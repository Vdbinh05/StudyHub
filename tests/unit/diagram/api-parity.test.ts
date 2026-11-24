import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiagram,
  deleteDiagram,
  getDiagramDetail,
  listStudySetDiagrams,
  updateDiagram,
} from "@/lib/diagram/api";
import {
  attachMediaRelation,
  deleteMediaAsset,
  listMediaAssets,
  updateMediaAssetMeta,
} from "@/lib/media/api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("V3 Diagram & Media API Client Parity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("matches /api/sets/[id]/diagrams and /api/diagrams/[id] envelopes", async () => {
    const sampleDiagram = {
      id: "11111111-1111-4111-8111-111111111111",
      study_set_id: "22222222-2222-4222-8222-222222222222",
      owner_id: "33333333-3333-4333-8333-333333333333",
      title: "Engine schematic",
      description: null,
      base_media_id: null,
      base_image_url: "/api/uploads/signed-url?path=a/b/c.png&redirect=1",
      image_width: 1200,
      image_height: 800,
      content_version: 1,
      created_at: "2026-11-24T00:00:00Z",
      updated_at: "2026-11-24T00:00:00Z",
      hotspots: [],
    };

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: { diagrams: [sampleDiagram] } }))
      .mockResolvedValueOnce(jsonResponse({ data: { diagram: sampleDiagram } }))
      .mockResolvedValueOnce(jsonResponse({ data: { diagram: sampleDiagram } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { diagram: { ...sampleDiagram, title: "Updated" } } }))
      .mockResolvedValueOnce(jsonResponse({ data: { deleted: true, id: sampleDiagram.id } }));

    const list = await listStudySetDiagrams(sampleDiagram.study_set_id);
    expect(list).toHaveLength(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/sets/${sampleDiagram.study_set_id}/diagrams`,
      expect.any(Object),
    );

    const detail = await getDiagramDetail(sampleDiagram.id);
    expect(detail.id).toBe(sampleDiagram.id);

    const created = await createDiagram({
      study_set_id: sampleDiagram.study_set_id,
      title: sampleDiagram.title,
      description: null,
      base_image_url: sampleDiagram.base_image_url,
      image_width: 1200,
      image_height: 800,
      hotspots: [],
    });
    expect(created.title).toBe("Engine schematic");

    const updated = await updateDiagram(sampleDiagram.id, { title: "Updated" });
    expect(updated.title).toBe("Updated");

    await deleteDiagram(sampleDiagram.id);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/diagrams/${sampleDiagram.id}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("matches /api/media and /api/media/[id] envelopes", async () => {
    const asset = {
      id: "44444444-4444-4444-8444-444444444444",
      owner_id: "33333333-3333-4333-8333-333333333333",
      study_set_id: "22222222-2222-4222-8222-222222222222",
      kind: "image" as const,
      storage_bucket: "study-media",
      storage_path: "33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222/a.png",
      proxy_url: "/api/uploads/signed-url?path=x&redirect=1",
      mime_type: "image/png",
      file_name: "a.png",
      size_bytes: 1024,
      sha256_hash: null,
      width: 640,
      height: 480,
      duration_ms: null,
      alt_text: "Alt",
      caption: null,
      is_orphaned: false,
      created_at: "2026-11-24T00:00:00Z",
      updated_at: "2026-11-24T00:00:00Z",
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [asset], meta: { total: 1, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "rel-1", media_id: asset.id } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { ...asset, caption: "Fig 1" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { deleted: true, id: asset.id } }));

    const listed = await listMediaAssets({ studySetId: asset.study_set_id, kind: "image" });
    expect(listed.items).toHaveLength(1);
    expect(listed.total).toBe(1);

    const rel = await attachMediaRelation({
      media_id: asset.id,
      entity_type: "question",
      entity_id: "55555555-5555-4555-8555-555555555555",
      role: "prompt",
    });
    expect(rel.media_id).toBe(asset.id);

    const patched = await updateMediaAssetMeta(asset.id, { caption: "Fig 1" });
    expect(patched.caption).toBe("Fig 1");

    const del = await deleteMediaAsset(asset.id);
    expect(del.deleted).toBe(true);
  });
});
