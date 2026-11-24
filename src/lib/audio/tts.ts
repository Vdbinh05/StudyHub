/**
 * Browser SpeechSynthesis (TTS) Wrapper for StudyHub V3.0.
 * Handles async `voiceschanged`, honest localService vs network voice disclosure,
 * language/voice selection, clamped playback rate, stale speech cancellation on navigation,
 * and graceful unsupported fallback. Zero external/AI TTS services.
 */

export interface SpeechSynthesisVoiceLike {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

export interface SpeechSynthesisUtteranceLike {
  text: string;
  lang: string;
  voice: SpeechSynthesisVoiceLike | null;
  rate: number;
  pitch: number;
  volume: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onpause: (() => void) | null;
  onresume: (() => void) | null;
}

export interface SpeechSynthesisLike {
  speaking: boolean;
  paused: boolean;
  getVoices(): SpeechSynthesisVoiceLike[];
  speak(utterance: SpeechSynthesisUtteranceLike): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
  onvoiceschanged?: (() => void) | null;
}

export type UtteranceConstructorLike = new (text: string) => SpeechSynthesisUtteranceLike;

export interface TtsVoiceInfo {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  isDefault: boolean;
  /** Honest disclosure: "local" runs on-device offline; "network" uses browser vendor speech engine. */
  privacyScope: "local" | "network";
}

export type TtsStatus = "idle" | "speaking" | "paused" | "unsupported";

export interface TtsStateSnapshot {
  supported: boolean;
  status: TtsStatus;
  activeText: string | null;
  activeVoiceURI: string | null;
  activePrivacyScope: "local" | "network" | null;
  rate: number;
  error: string | null;
}

export interface SpeakOptions {
  text: string;
  lang?: string;
  voiceURI?: string | null;
  preferLocal?: boolean;
  rate?: number;
  pitch?: number;
  volume?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (errorCode: string) => void;
}

export type SpeakResult =
  | { ok: true; token: number; voice: TtsVoiceInfo | null }
  | { ok: false; reason: "unsupported" | "empty_text" };

export const MIN_TTS_RATE = 0.5;
export const MAX_TTS_RATE = 2.0;

export function clampTtsRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1.0;
  return Math.min(MAX_TTS_RATE, Math.max(MIN_TTS_RATE, Math.round(rate * 100) / 100));
}

export function normalizeVoiceInfo(voice: SpeechSynthesisVoiceLike): TtsVoiceInfo {
  return {
    voiceURI: voice.voiceURI,
    name: voice.name,
    lang: voice.lang,
    localService: Boolean(voice.localService),
    isDefault: Boolean(voice.default),
    privacyScope: voice.localService ? "local" : "network",
  };
}

export function filterVoicesByLanguage(
  voices: readonly TtsVoiceInfo[],
  langPrefix?: string,
): TtsVoiceInfo[] {
  if (!langPrefix || !langPrefix.trim()) return [...voices];
  const prefix = langPrefix.trim().toLowerCase().replace("_", "-");
  const baseLang = prefix.split("-")[0];
  return voices.filter((voice) => {
    const normalized = voice.lang.toLowerCase().replace("_", "-");
    return normalized === prefix || normalized.startsWith(`${baseLang}-`) || normalized === baseLang;
  });
}

export function selectBestVoice(
  voices: readonly TtsVoiceInfo[],
  preferredLang?: string,
  preferLocal = true,
): TtsVoiceInfo | null {
  if (voices.length === 0) return null;

  const target = (preferredLang ?? "").trim().toLowerCase().replace("_", "-");
  const baseLang = target.split("-")[0];

  const scored = voices.map((voice) => {
    const vLang = voice.lang.toLowerCase().replace("_", "-");
    let score = 0;
    if (target && vLang === target) {
      score += 100;
    } else if (baseLang && (vLang === baseLang || vLang.startsWith(`${baseLang}-`))) {
      score += 60;
    }
    if (preferLocal && voice.localService) {
      score += 25;
    }
    if (voice.isDefault) {
      score += 5;
    }
    return { voice, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.voice ?? null;
}

export interface TtsControllerDependencies {
  synthesis?: SpeechSynthesisLike | null;
  UtteranceCtor?: UtteranceConstructorLike | null;
}

function getBrowserSynthesis(): SpeechSynthesisLike | null {
  if (typeof window === "undefined") return null;
  if (!("speechSynthesis" in window) || !window.speechSynthesis) return null;
  return window.speechSynthesis as unknown as SpeechSynthesisLike;
}

function getBrowserUtteranceCtor(): UtteranceConstructorLike | null {
  if (typeof window === "undefined") return null;
  if (typeof window.SpeechSynthesisUtterance === "undefined") return null;
  return window.SpeechSynthesisUtterance as unknown as UtteranceConstructorLike;
}

export class TtsController {
  private readonly synthesis: SpeechSynthesisLike | null;
  private readonly UtteranceCtor: UtteranceConstructorLike | null;
  private activeToken = 0;
  private state: TtsStateSnapshot;
  private readonly stateListeners = new Set<(snapshot: TtsStateSnapshot) => void>();

  constructor(deps?: TtsControllerDependencies) {
    this.synthesis = deps && "synthesis" in deps ? (deps.synthesis ?? null) : getBrowserSynthesis();
    this.UtteranceCtor =
      deps && "UtteranceCtor" in deps ? (deps.UtteranceCtor ?? null) : getBrowserUtteranceCtor();

    const supported = this.isSupported();
    this.state = {
      supported,
      status: supported ? "idle" : "unsupported",
      activeText: null,
      activeVoiceURI: null,
      activePrivacyScope: null,
      rate: 1.0,
      error: null,
    };
  }

  isSupported(): boolean {
    return Boolean(this.synthesis && this.UtteranceCtor);
  }

  getState(): TtsStateSnapshot {
    return { ...this.state };
  }

  subscribeState(listener: (snapshot: TtsStateSnapshot) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  private updateState(partial: Partial<TtsStateSnapshot>): void {
    this.state = { ...this.state, ...partial };
    const snap = this.getState();
    for (const listener of this.stateListeners) {
      listener(snap);
    }
  }

  getVoices(): TtsVoiceInfo[] {
    if (!this.synthesis) return [];
    try {
      return this.synthesis.getVoices().map(normalizeVoiceInfo);
    } catch {
      return [];
    }
  }

  subscribeVoices(listener: (voices: TtsVoiceInfo[]) => void): () => void {
    const synth = this.synthesis;
    if (!synth) return () => {};

    const handler = () => {
      listener(this.getVoices());
    };

    if (typeof synth.addEventListener === "function") {
      synth.addEventListener("voiceschanged", handler);
      return () => {
        synth.removeEventListener?.("voiceschanged", handler);
      };
    }

    const previous = synth.onvoiceschanged ?? null;
    synth.onvoiceschanged = () => {
      previous?.();
      handler();
    };
    return () => {
      if (synth.onvoiceschanged) {
        synth.onvoiceschanged = previous;
      }
    };
  }

  /**
   * Resolves available voices cleanly, awaiting async `voiceschanged` with a bounded timeout.
   */
  loadVoices(timeoutMs = 1500): Promise<TtsVoiceInfo[]> {
    if (!this.isSupported()) {
      return Promise.resolve([]);
    }
    const immediate = this.getVoices();
    if (immediate.length > 0) {
      return Promise.resolve(immediate);
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (voices: TtsVoiceInfo[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(voices);
      };

      const unsubscribe = this.subscribeVoices((voices) => {
        if (voices.length > 0) {
          finish(voices);
        }
      });

      const timer = setTimeout(() => {
        finish(this.getVoices());
      }, Math.max(20, timeoutMs));
    });
  }

  speak(options: SpeakOptions): SpeakResult {
    if (!this.synthesis || !this.UtteranceCtor) {
      return { ok: false, reason: "unsupported" };
    }

    const cleanText = options.text.trim();
    if (!cleanText) {
      return { ok: false, reason: "empty_text" };
    }

    // Cancel any active or queued stale speech first
    this.activeToken += 1;
    const token = this.activeToken;
    this.synthesis.cancel();

    const rawVoices = this.synthesis.getVoices();
    const normalizedVoices = rawVoices.map(normalizeVoiceInfo);

    let chosenInfo: TtsVoiceInfo | null = null;
    if (options.voiceURI) {
      chosenInfo = normalizedVoices.find((v) => v.voiceURI === options.voiceURI) ?? null;
    }
    if (!chosenInfo) {
      chosenInfo = selectBestVoice(
        normalizedVoices,
        options.lang,
        options.preferLocal ?? true,
      );
    }

    const rawMatch = chosenInfo
      ? rawVoices.find((v) => v.voiceURI === chosenInfo.voiceURI) ?? null
      : null;

    const rate = clampTtsRate(options.rate ?? 1.0);
    const pitch = Number.isFinite(options.pitch)
      ? Math.min(2.0, Math.max(0.5, options.pitch!))
      : 1.0;
    const volume = Number.isFinite(options.volume)
      ? Math.min(1.0, Math.max(0, options.volume!))
      : 1.0;

    const utterance = new this.UtteranceCtor(cleanText);
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = volume;
    if (rawMatch) {
      utterance.voice = rawMatch;
      utterance.lang = rawMatch.lang;
    } else if (options.lang) {
      utterance.lang = options.lang;
    }

    utterance.onstart = () => {
      if (token !== this.activeToken) return;
      this.updateState({
        status: "speaking",
        activeText: cleanText,
        activeVoiceURI: chosenInfo?.voiceURI ?? null,
        activePrivacyScope: chosenInfo?.privacyScope ?? null,
        rate,
        error: null,
      });
      options.onStart?.();
    };

    utterance.onpause = () => {
      if (token !== this.activeToken) return;
      this.updateState({ status: "paused" });
    };

    utterance.onresume = () => {
      if (token !== this.activeToken) return;
      this.updateState({ status: "speaking" });
    };

    utterance.onend = () => {
      if (token !== this.activeToken) return;
      this.updateState({
        status: "idle",
        activeText: null,
        error: null,
      });
      options.onEnd?.();
    };

    utterance.onerror = (event) => {
      if (token !== this.activeToken) return;
      const errCode = event?.error ?? "speech_error";
      // "interrupted" and "canceled" are normal when switching cards/pages
      if (errCode === "interrupted" || errCode === "canceled") {
        this.updateState({ status: "idle", activeText: null, error: null });
        return;
      }
      this.updateState({
        status: "idle",
        activeText: null,
        error: errCode,
      });
      options.onError?.(errCode);
    };

    this.updateState({
      status: "speaking",
      activeText: cleanText,
      activeVoiceURI: chosenInfo?.voiceURI ?? null,
      activePrivacyScope: chosenInfo?.privacyScope ?? null,
      rate,
      error: null,
    });

    this.synthesis.speak(utterance);
    return { ok: true, token, voice: chosenInfo };
  }

  pause(): void {
    if (!this.synthesis || this.state.status !== "speaking") return;
    this.synthesis.pause();
    this.updateState({ status: "paused" });
  }

  resume(): void {
    if (!this.synthesis || this.state.status !== "paused") return;
    this.synthesis.resume();
    this.updateState({ status: "speaking" });
  }

  /**
   * Immediately cancels any current speech and invalidates stale callbacks (call on unmount/route change).
   */
  stop(): void {
    this.activeToken += 1;
    if (this.synthesis) {
      this.synthesis.cancel();
    }
    if (this.state.supported) {
      this.updateState({
        status: "idle",
        activeText: null,
        error: null,
      });
    }
  }
}

let defaultController: TtsController | null = null;

export function getDefaultTtsController(): TtsController {
  if (!defaultController) {
    defaultController = new TtsController();
  }
  return defaultController;
}

export function isBrowserTtsSupported(): boolean {
  return Boolean(getBrowserSynthesis() && getBrowserUtteranceCtor());
}
