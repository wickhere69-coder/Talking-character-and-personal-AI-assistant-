/**
 * convo-latency-core/index.ts
 *
 * Main entry point for the Ultra-Smooth Natural Conversation & Latency Reduction Engine.
 * Exports all modules, classes, and singleton accessors.
 */

export * from './types';
export * from './GaplessAudioScheduler';
export * from './FillerOrchestrator';
export * from './BargeInController';
export * from './VisemeCoArticulation';

import { GaplessAudioScheduler } from './GaplessAudioScheduler';
import { FillerOrchestrator } from './FillerOrchestrator';
import { BargeInController } from './BargeInController';
import { VisemeCoArticulation } from './VisemeCoArticulation';

export class ConvoLatencyEngine {
  public readonly scheduler: GaplessAudioScheduler;
  public readonly filler: FillerOrchestrator;
  public readonly bargeIn: BargeInController;
  public readonly visemeSmoother: VisemeCoArticulation;

  constructor() {
    this.scheduler = new GaplessAudioScheduler();
    this.filler = new FillerOrchestrator(this.scheduler);
    this.bargeIn = new BargeInController(this.scheduler);
    this.visemeSmoother = new VisemeCoArticulation();
  }

  public async initialize(): Promise<void> {
    await this.scheduler.ensureContext();
    // Preload natural conversation fillers in the background
    this.filler.preloadFillers().catch(() => {});
  }
}

// Global singleton instance
let _instance: ConvoLatencyEngine | null = null;

export function getConvoLatencyEngine(): ConvoLatencyEngine {
  if (!_instance) {
    _instance = new ConvoLatencyEngine();
  }
  return _instance;
}
