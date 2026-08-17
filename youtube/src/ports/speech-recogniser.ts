/**
 * Automatic captions, behind a port because the browser's answer is poor.
 *
 * The Web Speech API is the only speech recogniser available to a page with no
 * account and no key, and it has two properties that make it unsuitable as
 * anything but a demonstration: it is Chrome-and-derivatives only, and it
 * transcribes from a live audio stream at real time — a ten-minute video takes
 * ten minutes, because the audio has to be *played* into it.
 *
 * That is still worth shipping, because it makes the feature real without a
 * credential, and because the port makes a competent recogniser one adapter
 * away. What the port must not do is pretend the difference does not exist:
 * `realTimeRateOnly` and `wordTimings` are on the capability record precisely
 * so the UI can say "this will take about ten minutes" rather than appearing
 * to hang, and so the caption editor knows whether it has word-level timings
 * to work with or only sentence-level guesses.
 */

export interface RecognisedWord {
  readonly text: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface RecognisedSegment {
  readonly text: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  /** Empty when the adapter cannot produce word-level timings. */
  readonly words: readonly RecognisedWord[];
  /** 0–1 where the adapter reports it; `null` where it does not. */
  readonly confidence: number | null;
}

export interface RecogniserCapabilities {
  /** `false` for the null adapter, which is how the UI hides the feature. */
  readonly available: boolean;
  /**
   * True when transcription can only proceed at playback speed. Drives the
   * progress estimate and the warning shown before the user commits to it.
   */
  readonly realTimeRateOnly: boolean;
  /** True when {@link RecognisedSegment.words} will be populated. */
  readonly wordTimings: boolean;
  /** BCP-47 tags. */
  readonly languages: readonly string[];
}

export interface RecogniseOptions {
  readonly language: string;
  /** Called as segments finalise, so the editor can fill in progressively. */
  readonly onProgress?: (
    segment: RecognisedSegment,
    fractionComplete: number,
  ) => void;
  readonly signal?: AbortSignal;
}

export interface SpeechRecogniser {
  capabilities(): RecogniserCapabilities;

  /**
   * Transcribe decoded mono PCM.
   *
   * PCM rather than a file or a URL, because the caller already has this: the
   * audio was decoded during the transcode pass, and the fingerprinter is
   * reading the same buffer. Handing the recogniser a file would mean decoding
   * the video a second time for no reason.
   */
  transcribe(
    audio: Float32Array,
    sampleRate: number,
    options: RecogniseOptions,
  ): Promise<readonly RecognisedSegment[]>;
}
