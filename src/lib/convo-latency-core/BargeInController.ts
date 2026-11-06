/**
 * convo-latency-core/BargeInController.ts
 *
 * Dedicated zero-latency user barge-in and conversational interruption coordinator.
 *
 * When the user speaks or commands stop while the avatar is talking:
 * 1. Attenuates WebAudio gain to 0 in under 5ms (pop-free exponential fade).
 * 2. Unloads and halts all scheduled audio buffers.
 * 3. Immediately aborts in-flight network synthesis requests.
 * 4. Dispatches instant cancellation to the Python backend over WebSocket.
 * 5. Smoothly damps avatar facial expressions back to attentive listening posture.
 */

import { GaplessAudioScheduler } from './GaplessAudioScheduler';

export interface BargeInHandlerOptions {
  onCancelBackend?: (spokenSoFar: string) => void;
  onAvatarRelax?: () => void;
  onInterrupted?: () => void;
}

export class BargeInController {
  private scheduler: GaplessAudioScheduler;
  private options: BargeInHandlerOptions = {};
  private activeAbortController: AbortController | null = null;

  constructor(scheduler: GaplessAudioScheduler, options?: BargeInHandlerOptions) {
    this.scheduler = scheduler;
    if (options) this.options = options;
  }

  public setOptions(options: BargeInHandlerOptions): void {
    this.options = { ...this.options, ...options };
  }

  public getAbortSignal(): AbortSignal {
    if (!this.activeAbortController || this.activeAbortController.signal.aborted) {
      this.activeAbortController = new AbortController();
    }
    return this.activeAbortController.signal;
  }

  /**
   * Executes instantaneous barge-in interruption (< 10ms execution time).
   */
  public interrupt(spokenSoFar: string = ''): void {
    // 1. Abort active network requests
    if (this.activeAbortController) {
      try {
        this.activeAbortController.abort();
      } catch {}
      this.activeAbortController = null;
    }

    // 2. Instantaneous WebAudio fade-out and stop
    this.scheduler.interrupt();

    // 3. Cancel backend LangGraph task
    this.options.onCancelBackend?.(spokenSoFar);

    // 4. Reset avatar blendshapes
    this.options.onAvatarRelax?.();

    // 5. Notify listener
    this.options.onInterrupted?.();
  }
}
