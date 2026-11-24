import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const ICONS_DIR = path.join(PUBLIC_DIR, "icons");

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readPngMetadata(filePath: string): {
  width: number;
  height: number;
  hasValidSignature: boolean;
  hasIend: boolean;
  byteLength: number;
} {
  const buf = fs.readFileSync(filePath);
  const hasValidSignature =
    buf.length >= 33 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
  const ihdrType = buf.subarray(12, 16).toString("ascii");
  const width = ihdrType === "IHDR" ? buf.readUInt32BE(16) : 0;
  const height = ihdrType === "IHDR" ? buf.readUInt32BE(20) : 0;
  const hasIend = buf.includes(Buffer.from("IEND", "ascii"));
  return {
    width,
    height,
    hasValidSignature,
    hasIend,
    byteLength: buf.length,
  };
}

describe("PWA Manifest & Icons", () => {
  it("provides a valid web app manifest with required StudyHub V3 fields", () => {
    const manifestPath = path.join(PUBLIC_DIR, "manifest.webmanifest");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const raw = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(raw) as {
      name: string;
      short_name: string;
      start_url: string;
      display: string;
      theme_color: string;
      background_color: string;
      icons: Array<{
        src: string;
        sizes: string;
        type: string;
        purpose?: string;
      }>;
    };

    expect(manifest.name).toBe("StudyHub");
    expect(manifest.short_name).toBe("StudyHub");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/dashboard");
    expect(manifest.theme_color).toBe("#4f46e5");
    expect(manifest.background_color).toBe("#f8fafc");

    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: "/icons/icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        }),
        expect.objectContaining({
          src: "/icons/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        }),
        expect.objectContaining({
          src: "/icons/icon-maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        }),
      ]),
    );

    // Ensure separate purpose entries (no combined "any maskable")
    for (const icon of manifest.icons) {
      expect(icon.purpose).not.toBe("any maskable");
    }
  });

  it("contains valid deterministic PNG files at exact declared dimensions", () => {
    const expectedIcons: Array<[string, number, number]> = [
      ["icon-192.png", 192, 192],
      ["icon-512.png", 512, 512],
      ["icon-maskable-512.png", 512, 512],
      ["apple-touch-icon.png", 180, 180],
    ];

    for (const [filename, expectedW, expectedH] of expectedIcons) {
      const fullPath = path.join(ICONS_DIR, filename);
      expect(fs.existsSync(fullPath)).toBe(true);
      const meta = readPngMetadata(fullPath);
      expect(meta.hasValidSignature).toBe(true);
      expect(meta.hasIend).toBe(true);
      expect(meta.width).toBe(expectedW);
      expect(meta.height).toBe(expectedH);
      expect(meta.byteLength).toBeGreaterThan(500);
    }
  });
});

interface MockSwHarness {
  listeners: Map<string, Array<(event: unknown) => void>>;
  skipWaiting: ReturnType<typeof vi.fn>;
  clientsClaim: ReturnType<typeof vi.fn>;
  fetchMock: ReturnType<typeof vi.fn>;
  cacheStorage: Map<string, Map<string, Response>>;
}

function createServiceWorkerHarness(): MockSwHarness {
  const swSource = fs.readFileSync(path.join(PUBLIC_DIR, "sw.js"), "utf8");
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const cacheStorage = new Map<string, Map<string, Response>>();

  const getOrCreateCache = (name: string) => {
    let store = cacheStorage.get(name);
    if (!store) {
      store = new Map<string, Response>();
      cacheStorage.set(name, store);
    }
    return {
      match: async (req: Request | string) => {
        const key = typeof req === "string" ? req : req.url;
        const hit =
          store!.get(key) ??
          store!.get(
            key.startsWith("https://studyhub.app")
              ? key.replace("https://studyhub.app", "")
              : `https://studyhub.app${key}`,
          );
        return hit ? hit.clone() : undefined;
      },
      put: async (req: Request | string, res: Response) => {
        const key = typeof req === "string" ? req : req.url;
        store!.set(key, res.clone());
      },
    };
  };

  const skipWaiting = vi.fn();
  const clientsClaim = vi.fn().mockResolvedValue(undefined);
  const fetchMock = vi.fn();

  const sandboxSelf = {
    location: { origin: "https://studyhub.app" },
    skipWaiting,
    clients: { claim: clientsClaim },
    addEventListener: (type: string, cb: (event: unknown) => void) => {
      const list = listeners.get(type) ?? [];
      list.push(cb);
      listeners.set(type, list);
    },
  };

  const context = vm.createContext({
    self: sandboxSelf,
    caches: {
      open: async (name: string) => getOrCreateCache(name),
      keys: async () => Array.from(cacheStorage.keys()),
      delete: async (name: string) => cacheStorage.delete(name),
    },
    fetch: fetchMock,
    URL,
    Request,
    Response,
    Headers,
    Promise,
  });

  vm.runInContext(swSource, context);

  return {
    listeners,
    skipWaiting,
    clientsClaim,
    fetchMock,
    cacheStorage,
  };
}

function makeFakeRequest(
  url: string,
  options: {
    method?: string;
    mode?: string;
    headers?: Record<string, string>;
  } = {},
) {
  return {
    url,
    method: options.method ?? "GET",
    mode: options.mode ?? "cors",
    headers: new Headers(options.headers),
  };
}

function makeBasicResponse(
  body: string,
  options: { status?: number; headers?: Record<string, string>; type?: string } = {},
): Response {
  const res = new Response(body, {
    status: options.status ?? 200,
    headers: options.headers,
  });
  Object.defineProperty(res, "type", {
    value: options.type ?? "basic",
    configurable: true,
  });
  return res;
}

describe("Service Worker (`public/sw.js`) Security & Offline Contract", () => {
  it("never calls skipWaiting automatically during install; only on explicit APPLY_UPDATE", async () => {
    const sw = createServiceWorkerHarness();
    sw.fetchMock.mockResolvedValue(makeBasicResponse("<html>offline</html>"));

    const installPromises: Promise<unknown>[] = [];
    for (const cb of sw.listeners.get("install") ?? []) {
      cb({ waitUntil: (p: Promise<unknown>) => installPromises.push(p) });
    }
    await Promise.all(installPromises);

    expect(sw.skipWaiting).not.toHaveBeenCalled();

    // Unrelated message must not trigger skipWaiting
    for (const cb of sw.listeners.get("message") ?? []) {
      cb({ data: { type: "PING" } });
    }
    expect(sw.skipWaiting).not.toHaveBeenCalled();

    // Explicit APPLY_UPDATE triggers skipWaiting
    for (const cb of sw.listeners.get("message") ?? []) {
      cb({ data: { type: "APPLY_UPDATE" } });
    }
    expect(sw.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("NEVER intercepts or caches /api/*, /auth/*, /share/*, cross-origin Supabase, or POST requests", () => {
    const sw = createServiceWorkerHarness();
    const fetchListeners = sw.listeners.get("fetch") ?? [];

    const forbiddenRequests = [
      makeFakeRequest("https://studyhub.app/api/exams/123"),
      makeFakeRequest("https://studyhub.app/api/sync/events", { method: "POST" }),
      makeFakeRequest("https://studyhub.app/auth/callback?code=abc"),
      makeFakeRequest("https://studyhub.app/share/secret-token-123"),
      makeFakeRequest("https://proj.supabase.co/rest/v1/questions"),
      makeFakeRequest("https://proj.supabase.co/auth/v1/token"),
      makeFakeRequest("https://studyhub.app/_next/static/chunk.js", {
        headers: { Authorization: "Bearer secret" },
      }),
    ];

    for (const request of forbiddenRequests) {
      const respondWith = vi.fn();
      for (const cb of fetchListeners) {
        cb({ request, respondWith });
      }
      expect(respondWith).not.toHaveBeenCalled();
    }
  });

  it("uses cache-first for /_next/static/* and /icons/* and skips caching no-store responses", async () => {
    const sw = createServiceWorkerHarness();
    const fetchListeners = sw.listeners.get("fetch") ?? [];

    sw.fetchMock.mockResolvedValueOnce(
      makeBasicResponse("console.log('ok');", { status: 200 }),
    );

    const staticReq = makeFakeRequest(
      "https://studyhub.app/_next/static/chunks/app.js",
    );
    let responsePromise: Promise<Response> | null = null;
    for (const cb of fetchListeners) {
      cb({
        request: staticReq,
        respondWith: (p: Promise<Response>) => {
          responsePromise = p;
        },
      });
    }
    expect(responsePromise).not.toBeNull();
    const first = await responsePromise!;
    expect(await first.text()).toBe("console.log('ok');");
    expect(sw.fetchMock).toHaveBeenCalledTimes(1);

    // Second request serves from cache without calling fetch again
    let secondPromise: Promise<Response> | null = null;
    for (const cb of fetchListeners) {
      cb({
        request: staticReq,
        respondWith: (p: Promise<Response>) => {
          secondPromise = p;
        },
      });
    }
    const second = await secondPromise!;
    expect(await second.text()).toBe("console.log('ok');");
    expect(sw.fetchMock).toHaveBeenCalledTimes(1);

    // no-store response must not be cached
    sw.fetchMock.mockResolvedValueOnce(
      makeBasicResponse("dynamic", {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }),
    );
    const noStoreReq = makeFakeRequest("https://studyhub.app/icons/temp.png");
    let thirdPromise: Promise<Response> | null = null;
    for (const cb of fetchListeners) {
      cb({
        request: noStoreReq,
        respondWith: (p: Promise<Response>) => {
          thirdPromise = p;
        },
      });
    }
    await thirdPromise!;
    const cacheMap = sw.cacheStorage.get("studyhub-v3-shell-v1");
    expect(cacheMap?.has("https://studyhub.app/icons/temp.png")).toBe(false);
  });

  it("uses network-first for page navigations and falls back to precached /offline when network fails", async () => {
    const sw = createServiceWorkerHarness();
    const fetchListeners = sw.listeners.get("fetch") ?? [];

    // Seed precached /offline during install
    sw.fetchMock.mockImplementation(() =>
      Promise.resolve(
        makeBasicResponse("<html><body>Offline Page Shell</body></html>"),
      ),
    );
    const installWait: Promise<unknown>[] = [];
    for (const cb of sw.listeners.get("install") ?? []) {
      cb({ waitUntil: (p: Promise<unknown>) => installWait.push(p) });
    }
    await Promise.all(installWait);

    // Online navigation succeeds via network without caching authenticated HTML
    sw.fetchMock.mockResolvedValueOnce(
      makeBasicResponse("<html><body>Private Dashboard HTML</body></html>"),
    );
    const navReq = makeFakeRequest("https://studyhub.app/dashboard", {
      mode: "navigate",
    });
    let onlinePromise: Promise<Response> | null = null;
    for (const cb of fetchListeners) {
      cb({
        request: navReq,
        respondWith: (p: Promise<Response>) => {
          onlinePromise = p;
        },
      });
    }
    const onlineRes = await onlinePromise!;
    expect(await onlineRes.text()).toContain("Private Dashboard HTML");

    // Verify /dashboard HTML was NOT stored in static cache
    const cacheMap = sw.cacheStorage.get("studyhub-v3-shell-v1");
    expect(cacheMap?.has("https://studyhub.app/dashboard")).toBe(false);

    // Offline navigation falls back cleanly to /offline
    sw.fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    let offlinePromise: Promise<Response> | null = null;
    for (const cb of fetchListeners) {
      cb({
        request: navReq,
        respondWith: (p: Promise<Response>) => {
          offlinePromise = p;
        },
      });
    }
    const offlineRes = await offlinePromise!;
    expect(await offlineRes.text()).toContain("Offline Page Shell");
  });

  it("purges legacy cache versions on activate", async () => {
    const sw = createServiceWorkerHarness();
    sw.cacheStorage.set("studyhub-v1-legacy", new Map());
    sw.cacheStorage.set("studyhub-v3-shell-v1", new Map());

    const waitPromises: Promise<unknown>[] = [];
    for (const cb of sw.listeners.get("activate") ?? []) {
      cb({ waitUntil: (p: Promise<unknown>) => waitPromises.push(p) });
    }
    await Promise.all(waitPromises);

    expect(sw.cacheStorage.has("studyhub-v1-legacy")).toBe(false);
    expect(sw.cacheStorage.has("studyhub-v3-shell-v1")).toBe(true);
    expect(sw.clientsClaim).toHaveBeenCalledTimes(1);
  });
});
