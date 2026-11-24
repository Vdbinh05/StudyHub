const DEFAULT_STREAM_CHUNK_BYTES = 64 * 1024; // 64 KB chunks

/**
 * Converts a byte buffer into a chunked Web `ReadableStream<Uint8Array>`.
 * Omitting `Content-Length` enables HTTP chunked streaming on Vercel Serverless
 * Node functions, bypassing the 4.5 MB buffered response cap cleanly.
 */
export function createChunkedByteStream(
  bytes: Uint8Array,
  chunkSize: number = DEFAULT_STREAM_CHUNK_BYTES,
): ReadableStream<Uint8Array> {
  const safeChunkSize = Math.max(1024, Math.min(1024 * 1024, Math.floor(chunkSize)));
  let offset = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + safeChunkSize, bytes.byteLength);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
}

/**
 * Returns a streamed binary `Response` (e.g., PDF / XLSX / CSV / TXT exports).
 * Intentionally deletes any `Content-Length` header so Vercel routes stream past 4.5 MB.
 */
export function streamBinaryResponse(
  bytes: Uint8Array,
  init: { status?: number; headers: HeadersInit },
): Response {
  const headers = new Headers(init.headers);
  headers.delete("content-length");
  if (!headers.has("x-content-type-options")) {
    headers.set("X-Content-Type-Options", "nosniff");
  }

  return new Response(createChunkedByteStream(bytes), {
    status: init.status ?? 200,
    headers,
  });
}

/**
 * Returns a streamed UTF-8 JSON `Response` (e.g., large account data exports or
 * large import previews) exempt from Vercel's 4.5 MB buffered response cap.
 */
export function streamJsonResponse(
  payload: unknown,
  init?: { status?: number; headers?: HeadersInit },
): Response {
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const headers = new Headers(init?.headers);
  headers.delete("content-length");
  if (!headers.has("content-type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  if (!headers.has("x-content-type-options")) {
    headers.set("X-Content-Type-Options", "nosniff");
  }

  return new Response(createChunkedByteStream(encoded), {
    status: init?.status ?? 200,
    headers,
  });
}
