/**
 * liveMicService.ts
 * Continuous full-duplex microphone capture for Gemini Live.
 *
 * - Runs in an AudioWorklet (audio thread), so the 3D render loop can't starve it
 *   the way the old main-thread ScriptProcessor could (dropped/choppy frames).
 * - Captures straight into a 16 kHz AudioContext so the browser does proper
 *   anti-aliased resampling (linear interpolation without a low-pass aliases and
 *   hurts speech recognition). Falls back to an in-worklet box-filter downsampler.
 * - Emits 40 ms PCM16 frames plus their RMS so the conversation controller can run
 *   echo-aware barge-in gating.
 * - Echo cancellation / noise suppression / AGC are requested from the browser.
 */

export interface LiveMicOptions {
  /** 40 ms of 16 kHz mono PCM16 LE, plus the frame's RMS (0..1). */
  onFrame?: (pcm16k: ArrayBuffer, rms: number) => void;
  onError?: (err: Error) => void;
}

const TARGET_RATE = 16000;
const FRAME_MS = 40;

const WORKLET_SOURCE = `
class AuraMicProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.ratio = o.ratio || 1;            // input samples per output sample
    this.frameLen = o.frameLen || 640;    // output samples per frame
    this.out = new Int16Array(this.frameLen);
    this.outIdx = 0;
    this.sumSq = 0;
    this.acc = 0; this.accN = 0; this.phase = 0;
  }
  push(s) {
    if (s > 1) s = 1; else if (s < -1) s = -1;
    this.sumSq += s * s;
    this.out[this.outIdx++] = s < 0 ? s * 0x8000 : s * 0x7fff;
    if (this.outIdx === this.frameLen) {
      const rms = Math.sqrt(this.sumSq / this.frameLen);
      const buf = this.out.buffer.slice(0);
      this.port.postMessage({ pcm: buf, rms }, [buf]);
      this.outIdx = 0; this.sumSq = 0;
    }
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    if (this.ratio === 1) {
      for (let i = 0; i < input.length; i++) this.push(input[i]);
    } else {
      // Box-filter decimation (averaging) — a cheap low-pass that avoids gross aliasing.
      for (let i = 0; i < input.length; i++) {
        this.acc += input[i]; this.accN++;
        this.phase += 1;
        if (this.phase >= this.ratio) {
          this.phase -= this.ratio;
          this.push(this.acc / this.accN);
          this.acc = 0; this.accN = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('aura-mic-processor', AuraMicProcessor);
`;

export class LiveMicService {
  private mediaStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sinkGain: GainNode | null = null;
  private recording = false;
  private starting: Promise<void> | null = null;
  private options: LiveMicOptions = {};

  constructor(options?: LiveMicOptions) {
    if (options) this.options = options;
  }

  public setOptions(options: LiveMicOptions): void {
    this.options = { ...this.options, ...options };
  }

  public isCapturing(): boolean {
    return this.recording;
  }

  public start(): Promise<void> {
    if (this.recording) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = this.doStart().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async doStart(): Promise<void> {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });

      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      try {
        // Preferred: let the browser resample the mic to 16 kHz.
        this.audioCtx = new Ctx({ sampleRate: TARGET_RATE, latencyHint: 'interactive' });
        this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream);
      } catch {
        // Some browsers refuse cross-rate MediaStream sources — capture natively instead.
        try { await this.audioCtx?.close(); } catch {}
        this.audioCtx = new Ctx({ latencyHint: 'interactive' });
        this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream);
      }
      await this.audioCtx.resume();

      const ratio = this.audioCtx.sampleRate / TARGET_RATE;
      const blobUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      try {
        await this.audioCtx.audioWorklet.addModule(blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }

      this.workletNode = new AudioWorkletNode(this.audioCtx, 'aura-mic-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        processorOptions: { ratio, frameLen: (TARGET_RATE * FRAME_MS) / 1000 },
      });
      this.workletNode.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
        if (!this.recording) return;
        this.options.onFrame?.(e.data.pcm, e.data.rms);
      };

      this.sourceNode.connect(this.workletNode);
      // Keep the graph pulling without sending mic audio to the speakers.
      this.sinkGain = this.audioCtx.createGain();
      this.sinkGain.gain.value = 0;
      this.workletNode.connect(this.sinkGain);
      this.sinkGain.connect(this.audioCtx.destination);

      this.recording = true;
      console.log(`[LiveMicService] Mic streaming at ${this.audioCtx.sampleRate} Hz → 16 kHz PCM (${FRAME_MS} ms frames)`);
    } catch (err: any) {
      console.error('[LiveMicService] Start failed:', err);
      this.options.onError?.(err instanceof Error ? err : new Error(String(err)));
      this.stop();
      throw err;
    }
  }

  public stop(): void {
    const wasRecording = this.recording;
    this.recording = false;
    try { this.workletNode?.port.close(); } catch {}
    try { this.workletNode?.disconnect(); } catch {}
    try { this.sourceNode?.disconnect(); } catch {}
    try { this.sinkGain?.disconnect(); } catch {}
    this.workletNode = null;
    this.sourceNode = null;
    this.sinkGain = null;
    if (this.audioCtx) {
      try { this.audioCtx.close(); } catch {}
      this.audioCtx = null;
    }
    if (this.mediaStream) {
      try { this.mediaStream.getTracks().forEach((t) => t.stop()); } catch {}
      this.mediaStream = null;
    }
    if (wasRecording) console.log('[LiveMicService] Stopped mic capture.');
  }
}

export const liveMicService = new LiveMicService();
