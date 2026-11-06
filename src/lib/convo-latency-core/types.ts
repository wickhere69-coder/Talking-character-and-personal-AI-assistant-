/**
 * convo-latency-core/types.ts
 * Type definitions for the Ultra-Smooth Conversation & Latency Reduction Engine.
 */

export interface LatencyTelemetry {
  queryStartTime: number;
  speechCompleteTime?: number;
  firstTokenTime?: number;
  firstSentenceTime?: number;
  firstAudioPlayTime?: number;
  fillerStartTime?: number;
  fillerEndTime?: number;
  totalLatencyMs?: number;
  perceivedLatencyMs?: number;
}

export interface ScheduledAudioSegment {
  id: string;
  text: string;
  buffer: AudioBuffer;
  sourceNode: AudioBufferSourceNode;
  gainNode: GainNode;
  startTime: number;
  endTime: number;
  duration: number;
  isFiller?: boolean;
}

export type FillerCategory = 'thinking' | 'search' | 'affirmative' | 'general';

export interface FillerItem {
  id: string;
  category: FillerCategory;
  text: string;
  audioBuffer?: AudioBuffer;
  blobUrl?: string;
  duration?: number;
}

export interface VisemeKeyframe {
  timeMs: number;
  viseme: string;
  weight: number;
  durationMs: number;
}

export interface CoArticulationPoint {
  timeMs: number;
  weights: Record<string, number>;
}
