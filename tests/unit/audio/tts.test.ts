import { describe, expect, it, vi } from "vitest";
import {
  clampTtsRate,
  filterVoicesByLanguage,
  selectBestVoice,
  TtsController,
  type SpeechSynthesisLike,
  type SpeechSynthesisUtteranceLike,
  type SpeechSynthesisVoiceLike,
} from "@/lib/audio/tts";

class FakeUtterance implements SpeechSynthesisUtteranceLike {
  text: string;
  lang = "";
  voice: SpeechSynthesisVoiceLike | null = null;
  rate = 1;
  pitch = 1;
  volume = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onpause: (() => void) | null = null;
  onresume: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

class FakeSpeechSynthesis implements SpeechSynthesisLike {
  voices: SpeechSynthesisVoiceLike[] = [];
  speaking = false;
  paused = false;
  spokenUtterances: FakeUtterance[] = [];
  cancelCount = 0;
  private listeners = new Set<() => void>();

  getVoices(): SpeechSynthesisVoiceLike[] {
    return this.voices;
  }

  speak(utterance: SpeechSynthesisUtteranceLike): void {
    this.speaking = true;
    this.paused = false;
    this.spokenUtterances.push(utterance as FakeUtterance);
    utterance.onstart?.();
  }

  cancel(): void {
    this.cancelCount += 1;
    this.speaking = false;
    this.paused = false;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === "voiceschanged") this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === "voiceschanged") this.listeners.delete(listener);
  }

  emitVoicesChanged(nextVoices: SpeechSynthesisVoiceLike[]): void {
    this.voices = nextVoices;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

const SAMPLE_VOICES: SpeechSynthesisVoiceLike[] = [
  { voiceURI: "en-local", name: "English Local", lang: "en-US", localService: true, default: true },
  { voiceURI: "en-cloud", name: "Google US English", lang: "en-US", localService: false, default: false },
  { voiceURI: "vi-cloud", name: "Google Tiếng Việt", lang: "vi-VN", localService: false, default: false },
  { voiceURI: "vi-local", name: "Microsoft An Online", lang: "vi-VN", localService: true, default: false },
];

describe("TTS browser SpeechSynthesis wrapper", () => {
  it("gracefully handles unsupported environments without throwing", async () => {
    const controller = new TtsController({ synthesis: null, UtteranceCtor: null });
    expect(controller.isSupported()).toBe(false);
    expect(await controller.loadVoices(50)).toEqual([]);
    const result = controller.speak({ text: "Xin chào" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported");
  });

  it("handles async voiceschanged loading and normalizes localService vs network disclosure", async () => {
    const synth = new FakeSpeechSynthesis();
    const controller = new TtsController({ synthesis: synth, UtteranceCtor: FakeUtterance });

    const loadPromise = controller.loadVoices(500);
    synth.emitVoicesChanged(SAMPLE_VOICES);
    const voices = await loadPromise;

    expect(voices).toHaveLength(4);
    expect(voices.find((v) => v.voiceURI === "en-local")?.privacyScope).toBe("local");
    expect(voices.find((v) => v.voiceURI === "vi-cloud")?.privacyScope).toBe("network");
  });

  it("filters voices by language prefix and prefers localService voice when requested", () => {
    const synth = new FakeSpeechSynthesis();
    synth.voices = SAMPLE_VOICES;
    const controller = new TtsController({ synthesis: synth, UtteranceCtor: FakeUtterance });
    const normalized = controller.getVoices();

    const viVoices = filterVoicesByLanguage(normalized, "vi");
    expect(viVoices).toHaveLength(2);

    const bestViLocal = selectBestVoice(normalized, "vi-VN", true);
    expect(bestViLocal?.voiceURI).toBe("vi-local");
    expect(bestViLocal?.localService).toBe(true);

    const bestViAny = selectBestVoice(normalized, "vi-VN", false);
    expect(bestViAny?.lang).toBe("vi-VN");
  });

  it("clamps playback rate safely to [0.5, 2.0]", () => {
    expect(clampTtsRate(0.1)).toBe(0.5);
    expect(clampTtsRate(4.5)).toBe(2.0);
    expect(clampTtsRate(1.25)).toBe(1.25);
    expect(clampTtsRate(Number.NaN)).toBe(1.0);
  });

  it("cancels stale speech on subsequent speak() or stop() and suppresses stale callbacks", () => {
    const synth = new FakeSpeechSynthesis();
    synth.voices = SAMPLE_VOICES;
    const controller = new TtsController({ synthesis: synth, UtteranceCtor: FakeUtterance });

    const firstEnd = vi.fn();
    const secondEnd = vi.fn();

    const r1 = controller.speak({ text: "Question 1", lang: "en-US", rate: 1.2, onEnd: firstEnd });
    expect(r1.ok).toBe(true);
    const utt1 = synth.spokenUtterances[0];
    expect(utt1.rate).toBe(1.2);

    // Navigate / speak next item before first completes
    const r2 = controller.speak({ text: "Question 2", lang: "en-US", onEnd: secondEnd });
    expect(r2.ok).toBe(true);
    expect(synth.cancelCount).toBeGreaterThanOrEqual(2);

    // Late callback from stale utterance must NOT trigger firstEnd
    utt1.onend?.();
    expect(firstEnd).not.toHaveBeenCalled();

    // Active utterance completes normally
    const utt2 = synth.spokenUtterances[1];
    utt2.onend?.();
    expect(secondEnd).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe("idle");
  });

  it("rejects blank text cleanly", () => {
    const synth = new FakeSpeechSynthesis();
    const controller = new TtsController({ synthesis: synth, UtteranceCtor: FakeUtterance });
    const res = controller.speak({ text: "   " });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("empty_text");
  });
});
