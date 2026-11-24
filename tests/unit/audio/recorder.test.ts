import { describe, expect, it, vi } from "vitest";
import {
  AudioRecorderController,
  MAX_RECORDING_BYTES,
  MAX_RECORDING_DURATION_SECONDS,
  type MediaRecorderLike,
  type MediaStreamLike,
} from "@/lib/audio/recorder";

class FakeTrack {
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
}

class FakeStream implements MediaStreamLike {
  tracks = [new FakeTrack()];
  getTracks(): Array<{ stop: () => void }> {
    return this.tracks;
  }
}

class FakeMediaRecorder implements MediaRecorderLike {
  static isTypeSupported = (mime: string): boolean => mime === "audio/webm;codecs=opus";
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: { error?: Error }) => void) | null = null;

  constructor(_stream: MediaStreamLike, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "audio/webm";
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.onstop?.();
  }

  emitChunk(sizeBytes: number): void {
    const blob = new Blob([new Uint8Array(sizeBytes)], { type: this.mimeType });
    this.ondataavailable?.({ data: blob });
  }
}

describe("AudioRecorderController", () => {
  it("never requests microphone until start() is explicitly called", () => {
    const getUserMedia = vi.fn();
    const controller = new AudioRecorderController({
      mediaDevices: { getUserMedia },
      MediaRecorderCtor: FakeMediaRecorder,
      createObjectURL: () => "blob:fake-1",
      revokeObjectURL: vi.fn(),
    });

    expect(controller.getSnapshot().status).toBe("idle");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("records, produces preview blob/URL, stops all mic tracks, and revokes URL on delete", async () => {
    const stream = new FakeStream();
    let recorderInstance: FakeMediaRecorder | null = null;
    const revoke = vi.fn();

    class CapturingRecorder extends FakeMediaRecorder {
      constructor(s: MediaStreamLike, opts?: { mimeType?: string }) {
        super(s, opts);
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        recorderInstance = this;
      }
    }

    const controller = new AudioRecorderController({
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      MediaRecorderCtor: CapturingRecorder,
      createObjectURL: () => "blob:preview-url",
      revokeObjectURL: revoke,
    });

    const started = await controller.start();
    expect(started.ok).toBe(true);
    expect(controller.getSnapshot().status).toBe("recording");

    recorderInstance!.emitChunk(2048);
    controller.stop();

    const snap = controller.getSnapshot();
    expect(snap.status).toBe("preview");
    expect(snap.previewUrl).toBe("blob:preview-url");
    expect(snap.sizeBytes).toBe(2048);
    expect(stream.tracks[0].stopped).toBe(true);

    controller.deleteRecording();
    expect(revoke).toHaveBeenCalledWith("blob:preview-url");
    expect(controller.getSnapshot().status).toBe("idle");
    expect(controller.getSnapshot().blob).toBeNull();
  });

  it("maps permission denied gracefully without throwing", async () => {
    const err = new DOMException("Permission denied", "NotAllowedError");
    const controller = new AudioRecorderController({
      mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(err) },
      MediaRecorderCtor: FakeMediaRecorder,
    });

    const result = await controller.start();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PERMISSION_DENIED");
    }
    expect(controller.getSnapshot().status).toBe("error");
    expect(controller.getSnapshot().errorCode).toBe("PERMISSION_DENIED");
  });

  it("auto-stops when byte cap is exceeded", async () => {
    const stream = new FakeStream();
    let recorderInstance: FakeMediaRecorder | null = null;

    class CapturingRecorder extends FakeMediaRecorder {
      constructor(s: MediaStreamLike, opts?: { mimeType?: string }) {
        super(s, opts);
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        recorderInstance = this;
      }
    }

    const controller = new AudioRecorderController({
      maxBytes: 1024,
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      MediaRecorderCtor: CapturingRecorder,
      createObjectURL: () => "blob:cap",
      revokeObjectURL: vi.fn(),
    });

    await controller.start();
    recorderInstance!.emitChunk(600);
    expect(controller.getSnapshot().status).toBe("recording");
    recorderInstance!.emitChunk(600); // exceeds 1024 -> auto-stop!

    expect(controller.getSnapshot().status).toBe("preview");
    expect(controller.getSnapshot().stopReason).toBe("size_limit");
    expect(stream.tracks[0].stopped).toBe(true);
  });

  it("auto-stops when duration cap (120s max) is reached", async () => {
    vi.useFakeTimers();
    try {
      const stream = new FakeStream();
      let recorderInstance: FakeMediaRecorder | null = null;

      class CapturingRecorder extends FakeMediaRecorder {
        constructor(s: MediaStreamLike, opts?: { mimeType?: string }) {
          super(s, opts);
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          recorderInstance = this;
        }
      }

      const controller = new AudioRecorderController({
        maxDurationSeconds: 5,
        mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
        MediaRecorderCtor: CapturingRecorder,
        createObjectURL: () => "blob:timed",
        revokeObjectURL: vi.fn(),
      });

      await controller.start();
      recorderInstance!.emitChunk(512);
      vi.advanceTimersByTime(5100);

      expect(controller.getSnapshot().status).toBe("preview");
      expect(controller.getSnapshot().stopReason).toBe("duration_limit");
      expect(stream.tracks[0].stopped).toBe(true);
      expect(MAX_RECORDING_DURATION_SECONDS).toBe(120);
      expect(MAX_RECORDING_BYTES).toBe(10 * 1024 * 1024);
    } finally {
      vi.useRealTimers();
    }
  });
});
