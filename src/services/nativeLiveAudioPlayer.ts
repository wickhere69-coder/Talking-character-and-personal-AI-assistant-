/**
 * nativeLiveAudioPlayer.ts
 * Gapless 24 kHz PCM16 player for Gemini Live's native voice.
 *
 * - Chunks are scheduled back-to-back with NO per-chunk fades (per-chunk fades
 *   amplitude-modulate continuous speech and sound like a flutter/buzz).
 * - A small jitter buffer (lead time) absorbs network burstiness; late chunks
 *   re-anchor with a soft fade-in instead of clicking.
 * - Ducking gives a "soft barge-in": the voice dips the instant the user starts
 *   talking and only stops for real once the interruption is confirmed.
 * - Transcript pieces are stamped with their position on the audio timeline so
 *   the UI can show exactly what has been *heard* (and memory can record where an
 *   interruption cut the reply off).
 * - Exposes spectral features (low/mid/high band energy) for formant-driven lip-sync.
 */

export interface LiveVisemeFeatures {
  amp: number;   // overall loudness 0..1
  low: number;   // ~150–900 Hz  (F1: open vowels — aa / O)
  mid: number;   // ~900–2.5 kHz (F2: front vowels — E / I)
  high: number;  // ~3.5–8 kHz   (fricatives — S / F / CH)
}

interface TranscriptMark {
  text: string;
  atMs: number; // position on the turn's audio timeline when this text arrived
}

const SAMPLE_RATE = 24000;
const START_LEAD_S = 0.07;    // jitter buffer when a run starts
const UNDERRUN_LEAD_S = 0.04; // re-anchor lead after a late chunk
const STOP_FADE_S = 0.035;

export class NativeLiveAudioPlayer {
  private audioCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private freqData: Uint8Array | null = null;
  private timeData: Uint8Array | null = null;

  private nextPlayTime = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private playing = false;
  private turnComplete = false;
  private generation = 0; // bumps on stop() so stale onended handlers are ignored

  // Turn timeline. A turn can contain several contiguous "runs" separated by gaps
  // (e.g. "one sec, checking…" → tool call → answer), so time is tracked per run.
  private turnQueuedMs = 0;
  private runStartCtxTime = -1;
  private runQueuedStartMs = 0;
  private marks: TranscriptMark[] = [];
  private onIdleMidTurnCb: (() => void) | null = null;

  private smoothedAmp = 0;
  private outputLevel = 0; // slow RMS of what we play (echo reference for barge-in)
  private lastFeatures: LiveVisemeFeatures = { amp: 0, low: 0, mid: 0, high: 0 };

  private onPlaybackEndCb: (() => void) | null = null;
  private onPlaybackStartCb: (() => void) | null = null;

  constructor() {
    this.initAudioContext();
  }

  private initAudioContext(): void {
    if (typeof window === 'undefined') return;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new Ctx({ latencyHint: 'interactive' });
      this.masterGain = this.audioCtx.createGain();
      this.duckGain = this.audioCtx.createGain();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.35;
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeData = new Uint8Array(this.analyser.fftSize);
      this.masterGain.connect(this.duckGain);
      this.duckGain.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
    } catch (e) {
      console.warn('[NativeLiveAudioPlayer] AudioContext init notice:', e);
    }
  }

  public async ensureContext(): Promise<AudioContext | null> {
    if (!this.audioCtx) this.initAudioContext();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      try { await this.audioCtx.resume(); } catch {}
    }
    return this.audioCtx;
  }

  public setOnPlaybackEnd(cb: (() => void) | null): void {
    this.onPlaybackEndCb = cb;
  }

  public setOnPlaybackStart(cb: (() => void) | null): void {
    this.onPlaybackStartCb = cb;
  }

  /** Fired when audio runs dry before the turn is complete (e.g. waiting on a tool). */
  public setOnIdleMidTurn(cb: (() => void) | null): void {
    this.onIdleMidTurnCb = cb;
  }

  /** Begin a fresh assistant turn (resets the transcript timeline). */
  public beginTurn(): void {
    this.turnQueuedMs = 0;
    this.runStartCtxTime = -1;
    this.runQueuedStartMs = 0;
    this.marks = [];
    this.turnComplete = false;
  }

  /** Server says the turn is done generating; fire playback-end once the queue drains. */
  public markTurnComplete(): void {
    this.turnComplete = true;
    if (!this.playing) this.fireEnd();
  }

  /** Stamp a transcript delta at the current end of the queued audio. */
  public markTranscript(text: string): void {
    if (!text) return;
    this.marks.push({ text, atMs: this.turnQueuedMs });
  }

  /** Transcript text whose audio has actually been played. */
  public getSpokenText(leadMs = 120): string {
    const played = this.getTurnPlayedMs() + leadMs;
    let out = '';
    for (const m of this.marks) {
      if (m.atMs <= played) out += m.text;
      else break;
    }
    return out;
  }

  public getFullTranscript(): string {
    return this.marks.map(m => m.text).join('');
  }

  public getTurnPlayedMs(): number {
    if (!this.audioCtx || this.runStartCtxTime < 0) return 0;
    const inRun = Math.max(0, (this.audioCtx.currentTime - this.runStartCtxTime) * 1000);
    return Math.min(this.runQueuedStartMs + inRun, this.turnQueuedMs);
  }

  public getTurnQueuedMs(): number {
    return this.turnQueuedMs;
  }

  /** Queue a 24 kHz PCM16 LE chunk (ArrayBuffer from a binary WS frame, or base64). */
  public async queuePcmChunk(pcmData: ArrayBuffer | Uint8Array | string): Promise<void> {
    const ctx = await this.ensureContext();
    if (!ctx || !this.masterGain) return;

    let bytes: Uint8Array;
    if (typeof pcmData === 'string') {
      const bin = atob(pcmData);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else if (pcmData instanceof Uint8Array) {
      bytes = pcmData;
    } else {
      bytes = new Uint8Array(pcmData);
    }
    const numSamples = bytes.byteLength >> 1;
    if (numSamples === 0) return;

    const view = new DataView(bytes.buffer, bytes.byteOffset, numSamples * 2);
    const audioBuffer = ctx.createBuffer(1, numSamples, SAMPLE_RATE);
    const ch = audioBuffer.getChannelData(0);
    let sumSq = 0;
    for (let i = 0; i < numSamples; i++) {
      const s = view.getInt16(i * 2, true) / 32768;
      ch[i] = s;
      sumSq += s * s;
    }
    const chunkRms = Math.sqrt(sumSq / numSamples);
    this.outputLevel = this.outputLevel * 0.7 + chunkRms * 0.3;

    const now = ctx.currentTime;
    let startTime = this.nextPlayTime;
    let freshRun = false;
    if (!this.playing || startTime < now + 0.005) {
      // New run, or the network fell behind playback (underrun): re-anchor.
      freshRun = true;
      startTime = now + (this.playing ? UNDERRUN_LEAD_S : START_LEAD_S);
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    if (freshRun) {
      // One soft fade-in at the start of a run only — never between contiguous chunks.
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, startTime);
      g.gain.linearRampToValueAtTime(1, startTime + 0.008);
      source.connect(g);
      g.connect(this.masterGain);
    } else {
      source.connect(this.masterGain);
    }

    if (freshRun) {
      this.runStartCtxTime = startTime;
      this.runQueuedStartMs = this.turnQueuedMs;
    }
    source.start(startTime);
    const endTime = startTime + audioBuffer.duration;
    this.nextPlayTime = endTime;
    this.turnQueuedMs += audioBuffer.duration * 1000;
    this.activeSources.add(source);

    if (!this.playing) {
      this.playing = true;
      const gen = this.generation;
      const delayMs = Math.max(0, (startTime - now) * 1000);
      setTimeout(() => { if (gen === this.generation && this.playing) this.onPlaybackStartCb?.(); }, delayMs);
    }

    const gen = this.generation;
    source.onended = () => {
      this.activeSources.delete(source);
      if (gen !== this.generation) return;
      if (this.activeSources.size === 0 && this.audioCtx && this.audioCtx.currentTime >= this.nextPlayTime - 0.02) {
        this.playing = false;
        if (this.turnComplete) this.fireEnd();
        else this.onIdleMidTurnCb?.();
      }
    };
  }

  private fireEnd(): void {
    const cb = this.onPlaybackEndCb;
    this.onPlaybackEndCb = null;
    cb?.();
  }

  /** Dip the voice (soft barge-in). level 0..1 */
  public duck(level = 0.25, rampMs = 60): void {
    if (!this.audioCtx || !this.duckGain) return;
    const t = this.audioCtx.currentTime;
    this.duckGain.gain.cancelScheduledValues(t);
    this.duckGain.gain.setValueAtTime(this.duckGain.gain.value, t);
    this.duckGain.gain.linearRampToValueAtTime(level, t + rampMs / 1000);
  }

  public unduck(rampMs = 180): void {
    this.duck(1, rampMs);
  }

  public isDucked(): boolean {
    return !!this.duckGain && this.duckGain.gain.value < 0.95;
  }

  /** Smoothed loudness of queued output (runs ahead of what is audible). */
  public getOutputLevel(): number {
    return this.playing ? this.outputLevel : 0;
  }

  /**
   * RMS of what is coming out of the speakers *right now* (post-duck). This is the
   * echo reference for barge-in gating. Read straight from the analyser so it stays
   * correct even when the render loop is throttled (background tab).
   */
  public getPlayingRms(): number {
    if (!this.analyser || !this.timeData || !this.playing) return 0;
    this.analyser.getByteTimeDomainData(this.timeData as any);
    let sumSq = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const v = (this.timeData[i] - 128) / 128;
      sumSq += v * v;
    }
    return Math.sqrt(sumSq / this.timeData.length);
  }

  public getIsPlaying(): boolean {
    return this.playing;
  }

  /** Back-compat: overall amplitude for simple jaw motion. */
  public getLiveAmplitude(): number {
    return this.getVisemeFeatures().amp;
  }

  /** Band energies of the voice currently coming out of the speakers. */
  public getVisemeFeatures(): LiveVisemeFeatures {
    if (!this.analyser || !this.freqData || !this.timeData || !this.audioCtx || !this.playing) {
      this.smoothedAmp *= 0.8;
      this.lastFeatures = { amp: this.smoothedAmp, low: this.lastFeatures.low * 0.8, mid: this.lastFeatures.mid * 0.8, high: this.lastFeatures.high * 0.8 };
      return this.lastFeatures;
    }
    this.analyser.getByteTimeDomainData(this.timeData as any);
    let sumSq = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const v = (this.timeData[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / this.timeData.length);
    this.smoothedAmp = this.smoothedAmp * 0.35 + rms * 0.65;

    this.analyser.getByteFrequencyData(this.freqData as any);
    const binHz = this.audioCtx.sampleRate / this.analyser.fftSize;
    const band = (lo: number, hi: number) => {
      const a = Math.max(1, Math.floor(lo / binHz));
      const b = Math.min(this.freqData!.length - 1, Math.ceil(hi / binHz));
      let s = 0;
      for (let i = a; i <= b; i++) s += this.freqData![i];
      return s / ((b - a + 1) * 255);
    };
    this.lastFeatures = {
      amp: Math.min(1, this.smoothedAmp * 3.2),
      low: band(150, 900),
      mid: band(900, 2500),
      high: band(3500, 8000),
    };
    return this.lastFeatures;
  }

  /** Stop playback now (fast fade, no click). Returns the text that had been heard. */
  public stop(fadeMs = STOP_FADE_S * 1000): string {
    const spoken = this.getSpokenText(0);
    this.generation++;
    const ctx = this.audioCtx;
    const sources = Array.from(this.activeSources);
    this.activeSources.clear();
    this.playing = false;
    this.nextPlayTime = 0;
    this.turnComplete = false;
    this.onPlaybackEndCb = null;
    this.smoothedAmp = 0;
    this.outputLevel = 0;

    if (ctx && this.masterGain && this.duckGain) {
      const t = ctx.currentTime;
      const fade = fadeMs / 1000;
      this.masterGain.gain.cancelScheduledValues(t);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t);
      this.masterGain.gain.linearRampToValueAtTime(0, t + fade);
      setTimeout(() => {
        for (const src of sources) {
          try { src.stop(); src.disconnect(); } catch {}
        }
        if (this.audioCtx && this.masterGain && this.duckGain) {
          const t2 = this.audioCtx.currentTime;
          this.masterGain.gain.cancelScheduledValues(t2);
          this.masterGain.gain.setValueAtTime(1, t2);
          this.duckGain.gain.cancelScheduledValues(t2);
          this.duckGain.gain.setValueAtTime(1, t2);
        }
      }, fadeMs + 10);
    } else {
      for (const src of sources) {
        try { src.stop(); } catch {}
      }
    }
    return spoken;
  }
}

// Global singleton instance
export const nativeLiveAudioPlayer = new NativeLiveAudioPlayer();
