/**
 * convo-latency-core/FillerOrchestrator.ts
 *
 * Instant Conversational Backchanneling & Filler Engine.
 * Pre-synthesizes and caches natural human filler phrases:
 * - "Hmm, let me look into that for you..."
 * - "Got it, checking right now..."
 * - "Let's see..."
 * - "Right, one second..."
 *
 * Plays in under 120ms when queries require search or deep thinking,
 * completely masking backend generation latency.
 */

import { FillerCategory, FillerItem } from './types';
import { GaplessAudioScheduler } from './GaplessAudioScheduler';

const FILLER_DEFINITIONS: Array<{ category: FillerCategory; text: string }> = [
  { category: 'search', text: 'Let me look that up for you.' },
  { category: 'search', text: 'Searching that right now.' },
  { category: 'thinking', text: 'Hmm, let me see.' },
  { category: 'thinking', text: 'Let me think about that.' },
  { category: 'affirmative', text: 'Got it, looking into that.' },
  { category: 'general', text: 'Right, one second.' },
];

export class FillerOrchestrator {
  private scheduler: GaplessAudioScheduler;
  private cache: Map<string, FillerItem> = new Map();
  private isPreloaded: boolean = false;
  private currentVoiceId: string = 'pFZP5JQG7iQjIQuC4Bku'; // default Lily / Sonia

  constructor(scheduler: GaplessAudioScheduler) {
    this.scheduler = scheduler;
  }

  public setVoice(voiceId: string): void {
    if (this.currentVoiceId !== voiceId) {
      this.currentVoiceId = voiceId;
      this.cache.clear();
      this.isPreloaded = false;
    }
  }

  /**
   * Pre-fetches and decodes filler audio buffers into in-memory WebAudio buffers.
   */
  public async preloadFillers(): Promise<void> {
    if (this.isPreloaded || typeof window === 'undefined') return;
    this.isPreloaded = true;

    for (const def of FILLER_DEFINITIONS) {
      const key = `${this.currentVoiceId}:${def.text}`;
      if (this.cache.has(key)) continue;

      try {
        const url = `/api/tts-stream?text=${encodeURIComponent(def.text)}&voice=${encodeURIComponent(this.currentVoiceId)}`;
        const res = await fetch(url);
        if (res.ok) {
          const arrayBuf = await res.arrayBuffer();
          const audioBuffer = await this.scheduler.decodeAudioData(arrayBuf);
          if (audioBuffer) {
            this.cache.set(key, {
              id: key,
              category: def.category,
              text: def.text,
              audioBuffer,
              duration: audioBuffer.duration,
            });
          }
        }
      } catch (e) {
        console.warn('[FillerOrchestrator] Notice preloading filler:', def.text, e);
      }
    }
  }

  /**
   * Selects an appropriate filler based on query intent.
   */
  public selectFiller(category: FillerCategory): FillerItem | null {
    const candidates: FillerItem[] = [];
    for (const item of this.cache.values()) {
      if (item.category === category && item.audioBuffer) {
        candidates.push(item);
      }
    }
    if (candidates.length === 0) {
      // Fallback to any cached filler
      for (const item of this.cache.values()) {
        if (item.audioBuffer) candidates.push(item);
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  /**
   * Plays a filler immediately in <120ms.
   * Returns the played filler duration in milliseconds, or 0 if none played.
   */
  public triggerInstantFiller(category: FillerCategory): { played: boolean; text?: string; durationMs?: number } {
    const filler = this.selectFiller(category);
    if (!filler || !filler.audioBuffer) {
      return { played: false };
    }

    const scheduled = this.scheduler.schedule(filler.audioBuffer, filler.text, true);
    if (scheduled) {
      return {
        played: true,
        text: filler.text,
        durationMs: (scheduled.duration || 1.2) * 1000,
      };
    }
    return { played: false };
  }
}
