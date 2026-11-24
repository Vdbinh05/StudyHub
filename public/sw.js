/**
 * StudyHub V3.0 Service Worker — Safe Static Shell & Offline Fallback.
 *
 * Security & Reliability Guarantees:
 * - Versioned static shell cache (`studyhub-v3-shell-v1`).
 * - Precaches `/offline`, manifest, and app icons.
 * - Cache-first ONLY for same-origin immutable static assets (`/_next/static/*`,
 *   `/icons/*`, `/manifest.webmanifest`).
 * - Network-first for page navigations with `/offline` fallback when unreachable.
 * - NEVER caches `/api/*`, `/auth/*`, `/share/*`, authenticated HTML documents,
 *   cross-origin requests (e.g. Supabase Auth/REST/Storage), or responses with
 *   `Cache-Control: no-store`.
 * - NEVER calls `skipWaiting()` automatically during install; updates apply ONLY
 *   when the client explicitly posts `{ type: "APPLY_UPDATE" }` (preventing
 *   forced reloads during active timed exams).
 */

const STATIC_CACHE = "studyhub-v3-shell-v1";
const OFFLINE_FALLBACK_URL = "/offline";

const PRECACHE_URLS = [
  OFFLINE_FALLBACK_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

function isNeverCachePath(pathname) {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    pathname === "/share" ||
    pathname.startsWith("/share/")
  );
}

function isStaticShellAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/manifest.webmanifest"
  );
}

function isCacheableStaticResponse(response) {
  if (!response || !response.ok || response.status !== 200) {
    return false;
  }
  if (response.redirected) {
    return false;
  }
  if (response.type !== "basic") {
    return false;
  }
  const cacheControl = (response.headers.get("cache-control") || "").toLowerCase();
  if (cacheControl.includes("no-store") || cacheControl.includes("private")) {
    return false;
  }
  return true;
}

function buildMinimalOfflineHtmlResponse() {
  const html = [
    "<!doctype html>",
    '<html lang="vi">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width,initial-scale=1" />',
    "<title>Ngoại tuyến | StudyHub</title>",
    "<style>",
    "body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#0f172a;}",
    ".card{max-width:440px;width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;}",
    "h1{margin:0 0 8px;font-size:1.25rem;}",
    "p{margin:0 0 16px;color:#475569;line-height:1.5;}",
    "button{background:#4f46e5;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer;}",
    "</style>",
    "</head>",
    "<body>",
    '<main class="card">',
    "<h1>Bạn đang ngoại tuyến</h1>",
    "<p>Không thể kết nối mạng. Vui lòng kiểm tra kết nối và thử lại, hoặc mở các học phần đã tải xuống khi có mạng trở lại.</p>",
    '<button type="button" onclick="window.location.reload()">Thử kết nối lại</button>',
    "</main>",
    "</body>",
    "</html>",
  ].join("");

  return new Response(html, {
    status: 503,
    statusText: "Offline",
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const absoluteUrl = new URL(url, self.location.origin).toString();
            const response = await fetch(
              new Request(absoluteUrl, {
                cache: "reload",
                credentials: "same-origin",
              }),
            );
            if (isCacheableStaticResponse(response)) {
              await cache.put(url, response.clone());
            }
          } catch {
            // Non-fatal during initial install if offline or route unavailable
          }
        }),
      );
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name !== STATIC_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const payload = event.data;
  if (!payload || typeof payload !== "object") {
    return;
  }

  if (payload.type === "APPLY_UPDATE") {
    self.skipWaiting();
    return;
  }

  if (payload.type === "CLEAR_SHELL_CACHE") {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(keys.map((key) => caches.delete(key))),
      ),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never intercept non-GET mutations or requests carrying explicit auth headers
  if (request.method !== "GET") {
    return;
  }
  if (request.headers.has("authorization")) {
    return;
  }

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Strictly same-origin only: never intercept Supabase or any remote endpoint
  if (url.origin !== self.location.origin) {
    return;
  }

  // Never cache API, Auth, or Share endpoints
  if (isNeverCachePath(url.pathname)) {
    return;
  }

  // Cache-first ONLY for immutable static assets, icons, and manifest
  if (isStaticShellAsset(url.pathname)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          return cached;
        }
        const networkResponse = await fetch(request);
        if (isCacheableStaticResponse(networkResponse)) {
          await cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      }),
    );
    return;
  }

  // Network-first for HTML page navigations, falling back to precached /offline
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          if (
            url.pathname === OFFLINE_FALLBACK_URL &&
            isCacheableStaticResponse(networkResponse)
          ) {
            const cache = await caches.open(STATIC_CACHE);
            await cache.put(OFFLINE_FALLBACK_URL, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          const cache = await caches.open(STATIC_CACHE);
          const fallback = await cache.match(OFFLINE_FALLBACK_URL);
          if (fallback) {
            return fallback;
          }
          return buildMinimalOfflineHtmlResponse();
        }
      })(),
    );
  }
});
