/**
 * Explicit-Action Browser MediaRecorder Wrapper for StudyHub V3.0.
 * - Requests microphone permission ONLY when `start()` is invoked by an explicit user action.
 * - Enforces hard duration cap (120s max) and byte cap (10 MB max).
 * - Always releases all MediaStream tracks immediately on stop/error/cancel/dispose (zero background recording).
 * - Revokes object URLs on delete/replace/dispose.
 */

import { MAX_AUDIO_UPLOAD_BYTES } from "@/lib/media/validation";

export const MAX_RECORDING_DURATION_SECONDS = 120;
export const MAX_RECORDING_BYTES = MAX_AUDIO_UPLOAD_BYTES; // 10 MB

export type RecorderStatus =
  | "idle"
  | "requesting_permission"
  | "recording"
  | "preview"
  | "unsupported"
  | "error";

export type RecorderStopReason = "user" | "duration_limit" | "size_limit" | "error";

export type RecorderErrorCode =
  | "UNSUPPORTED"
  | "PERMISSION_DENIED"
  | "NO_MICROPHONE"
  | "DEVICE_BUSY"
  | "EMPTY_RECORDING"
  | "RECORDER_ERROR";

export interface RecorderSnapshot {
  supported: boolean;
  status: RecorderStatus;
  elapsedSeconds: number;
  maxDurationSeconds: number;
  sizeBytes: number;
  maxBytes: number;
  mimeType: string | null;
  blob: Blob | null;
  previewUrl: string | null;
  stopReason: RecorderStopReason | null;
  errorCode: RecorderErrorCode | null;
}

export interface MediaStreamLike {
  getTracks(): Array<{ stop: () => void }>;
}

export interface MediaDevicesLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamLike>;
}

export interface MediaRecorderLike {
  state: "inactive" | "recording" | "paused";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: { error?: Error }) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
}

export interface MediaRecorderConstructorLike {
  new (stream: MediaStreamLike, options?: { mimeType?: string }): MediaRecorderLike;
  isTypeSupported?: (mimeType: string) => boolean;
}

export interface AudioRecorderOptions {
  maxDurationSeconds?: number;
  maxBytes?: number;
  mediaDevices?: MediaDevicesLike | null;
  MediaRecorderCtor?: MediaRecorderConstructorLike | null;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

const PREFERRED_RECORDING_MIMES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
] as const;

export function selectSupportedAudioMimeType(
  RecorderCtor?: MediaRecorderConstructorLike | null,
): string | undefined {
  const ctor =
    RecorderCtor ??
    (typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined"
      ? (window.MediaRecorder as unknown as MediaRecorderConstructorLike)
      : null);

  if (!ctor || typeof ctor.isTypeSupported !== "function") {
    return undefined;
  }

  for (const candidate of PREFERRED_RECORDING_MIMES) {
    try {
      if (ctor.isTypeSupported(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore browser quirks
    }
  }
  return undefined;
}

export function isAudioRecordingSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return Boolean(
    navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function" &&
      typeof window.MediaRecorder !== "undefined",
  );
}

function mapMediaErrorCode(err: unknown): RecorderErrorCode {
  if (err && typeof err === "object" && "name" in err) {
    const name = String((err as { name: string }).name);
    if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
      return "PERMISSION_DENIED";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "NO_MICROPHONE";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "DEVICE_BUSY";
    }
  }
  return "RECORDER_ERROR";
}

export function normalizeRecordedMimeExtension(mimeType: string | null): "webm" | "m4a" | "ogg" | "wav" {
  const lower = (mimeType ?? "").toLowerCase();
  if (lower.includes("mp4") || lower.includes("m4a")) return "m4a";
  if (lower.includes("ogg")) return "ogg";
  if (lower.includes("wav")) return "wav";
  return "webm";
}

export class AudioRecorderController {
  private readonly maxDurationSeconds: number;
  private readonly maxBytes: number;
  private readonly mediaDevices: MediaDevicesLike | null;
  private readonly MediaRecorderCtor: MediaRecorderConstructorLike | null;
  private readonly createObjectURLFn: (blob: Blob) => string;
  private readonly revokeObjectURLFn: (url: string) => void;

  private activeStream: MediaStreamLike | null = null;
  private activeRecorder: MediaRecorderLike | null = null;
  private chunks: Blob[] = [];
  private accumulatedBytes = 0;
  private startedAtMs = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingStopReason: RecorderStopReason = "user";
  private snapshot: RecorderSnapshot;
  private readonly listeners = new Set<(snap: RecorderSnapshot) => void>();

  constructor(options: AudioRecorderOptions = {}) {
    this.maxDurationSeconds = Math.min(
      MAX_RECORDING_DURATION_SECONDS,
      Math.max(1, Math.floor(options.maxDurationSeconds ?? MAX_RECORDING_DURATION_SECONDS)),
    );
    this.maxBytes = Math.min(
      MAX_RECORDING_BYTES,
      Math.max(512, Math.floor(options.maxBytes ?? MAX_RECORDING_BYTES)),
    );

    this.mediaDevices =
      "mediaDevices" in options
        ? (options.mediaDevices ?? null)
        : typeof navigator !== "undefined" && navigator.mediaDevices
          ? (navigator.mediaDevices as unknown as MediaDevicesLike)
          : null;

    this.MediaRecorderCtor =
      "MediaRecorderCtor" in options
        ? (options.MediaRecorderCtor ?? null)
        : typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined"
          ? (window.MediaRecorder as unknown as MediaRecorderConstructorLike)
          : null;

    this.createObjectURLFn =
      options.createObjectURL ??
      ((blob: Blob) =>
        typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
          ? URL.createObjectURL(blob)
          : "");

    this.revokeObjectURLFn =
      options.revokeObjectURL ??
      ((url: string) => {
        if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function" && url) {
          URL.revokeObjectURL(url);
        }
      });

    const supported = Boolean(this.mediaDevices && this.MediaRecorderCtor);
    this.snapshot = {
      supported,
      status: supported ? "idle" : "unsupported",
      elapsedSeconds: 0,
      maxDurationSeconds: this.maxDurationSeconds,
      sizeBytes: 0,
      maxBytes: this.maxBytes,
      mimeType: null,
      blob: null,
      previewUrl: null,
      stopReason: null,
      errorCode: supported ? null : "UNSUPPORTED",
    };
  }

  getSnapshot(): RecorderSnapshot {
    return { ...this.snapshot };
  }

  subscribe(listener: (snap: RecorderSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(partial: Partial<RecorderSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    const copy = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(copy);
    }
  }

  private clearTimers(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
  }

  private stopTracks(): void {
    if (this.activeStream) {
      for (const track of this.activeStream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore already-stopped track errors
        }
      }
      this.activeStream = null;
    }
  }

  private revokePreviewUrl(): void {
    if (this.snapshot.previewUrl) {
      this.revokeObjectURLFn(this.snapshot.previewUrl);
    }
  }

  /**
   * Explicitly requests microphone permission and starts recording.
   * Must ONLY be invoked from a direct user button click/tap.
   */
  async start(): Promise<{ ok: true } | { ok: false; code: RecorderErrorCode }> {
    if (!this.mediaDevices || !this.MediaRecorderCtor) {
      this.emit({ status: "unsupported", errorCode: "UNSUPPORTED" });
      return { ok: false, code: "UNSUPPORTED" };
    }

    // Clean any existing recording before starting a fresh one (replace flow)
    this.deleteRecording();
    this.emit({
      status: "requesting_permission",
      errorCode: null,
      stopReason: null,
      elapsedSeconds: 0,
      sizeBytes: 0,
    });

    let stream: MediaStreamLike;
    try {
      stream = await this.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const code = mapMediaErrorCode(err);
      this.emit({ status: "error", errorCode: code });
      return { ok: false, code };
    }

    this.activeStream = stream;
    this.chunks = [];
    this.accumulatedBytes = 0;
    this.pendingStopReason = "user";

    const preferredMime = selectSupportedAudioMimeType(this.MediaRecorderCtor);
    let recorder: MediaRecorderLike;
    try {
      recorder = preferredMime
        ? new this.MediaRecorderCtor(stream, { mimeType: preferredMime })
        : new this.MediaRecorderCtor(stream);
    } catch {
      this.stopTracks();
      this.emit({ status: "error", errorCode: "RECORDER_ERROR" });
      return { ok: false, code: "RECORDER_ERROR" };
    }

    this.activeRecorder = recorder;
    this.startedAtMs = Date.now();

    recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;
      const nextBytes = this.accumulatedBytes + event.data.size;
      if (nextBytes > this.maxBytes) {
        // Keep data strictly within byte cap and auto-stop
        const remaining = this.maxBytes - this.accumulatedBytes;
        if (remaining > 0) {
          this.chunks.push(event.data.slice(0, remaining));
          this.accumulatedBytes += remaining;
        }
        this.pendingStopReason = "size_limit";
        this.stopInternal("size_limit");
        return;
      }
      this.chunks.push(event.data);
      this.accumulatedBytes = nextBytes;
      this.emit({ sizeBytes: this.accumulatedBytes });
    };

    recorder.onerror = () => {
      this.clearTimers();
      this.stopTracks();
      this.activeRecorder = null;
      this.emit({
        status: "error",
        stopReason: "error",
        errorCode: "RECORDER_ERROR",
      });
    };

    recorder.onstop = () => {
      this.clearTimers();
      this.stopTracks();
      const mimeType = recorder.mimeType || preferredMime || "audio/webm";
      const blob = new Blob(this.chunks, { type: mimeType });
      this.activeRecorder = null;

      if (blob.size === 0) {
        this.emit({
          status: "error",
          blob: null,
          previewUrl: null,
          sizeBytes: 0,
          stopReason: this.pendingStopReason,
          errorCode: "EMPTY_RECORDING",
        });
        return;
      }

      const previewUrl = this.createObjectURLFn(blob);
      const elapsedSeconds = Math.min(
        this.maxDurationSeconds,
        Math.max(1, Math.round((Date.now() - this.startedAtMs) / 1000)),
      );
      this.emit({
        status: "preview",
        elapsedSeconds,
        sizeBytes: blob.size,
        mimeType,
        blob,
        previewUrl,
        stopReason: this.pendingStopReason,
        errorCode: null,
      });
    };

    this.tickTimer = setInterval(() => {
      const elapsed = Math.min(
        this.maxDurationSeconds,
        Math.floor((Date.now() - this.startedAtMs) / 1000),
      );
      this.emit({ elapsedSeconds: elapsed });
    }, 250);

    this.maxDurationTimer = setTimeout(() => {
      this.stopInternal("duration_limit");
    }, this.maxDurationSeconds * 1000);

    recorder.start(500);
    this.emit({
      status: "recording",
      mimeType: recorder.mimeType || preferredMime || "audio/webm",
      elapsedSeconds: 0,
      sizeBytes: 0,
    });

    return { ok: true };
  }

  private stopInternal(reason: RecorderStopReason): void {
    this.pendingStopReason = reason;
    this.clearTimers();
    if (this.activeRecorder && this.activeRecorder.state !== "inactive") {
      try {
        this.activeRecorder.stop();
      } catch {
        this.stopTracks();
      }
    } else {
      this.stopTracks();
    }
  }

  stop(): void {
    this.stopInternal("user");
  }

  deleteRecording(): void {
    this.clearTimers();
    if (this.activeRecorder && this.activeRecorder.state !== "inactive") {
      this.activeRecorder.onstop = null;
      this.activeRecorder.ondataavailable = null;
      try {
        this.activeRecorder.stop();
      } catch {
        // Ignore
      }
    }
    this.activeRecorder = null;
    this.stopTracks();
    this.revokePreviewUrl();
    this.chunks = [];
    this.accumulatedBytes = 0;

    if (this.snapshot.supported) {
      this.emit({
        status: "idle",
        elapsedSeconds: 0,
        sizeBytes: 0,
        mimeType: null,
        blob: null,
        previewUrl: null,
        stopReason: null,
        errorCode: null,
      });
    }
  }

  /**
   * Builds a standards-compliant `File` object from the recorded preview blob for upload.
   */
  toUploadFile(baseName = "voice-recording"): File | null {
    if (!this.snapshot.blob) return null;
    const ext = normalizeRecordedMimeExtension(this.snapshot.mimeType);
    const cleanMime = (this.snapshot.mimeType ?? "audio/webm").split(";")[0].trim();
    return new File([this.snapshot.blob], `${baseName}.${ext}`, {
      type: cleanMime,
      lastModified: Date.now(),
    });
  }

  /**
   * Full cleanup for unmount/navigation: stops mic immediately and revokes preview URL.
   */
  dispose(): void {
    this.deleteRecording();
    this.listeners.clear();
  }
}
