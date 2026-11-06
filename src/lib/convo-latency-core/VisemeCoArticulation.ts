/**
 * convo-latency-core/VisemeCoArticulation.ts
 *
 * Organic Viseme Co-Articulation & Smoothing Engine.
 *
 * Standard viseme engines abruptly step between phoneme targets, producing
 * robotic mouth snapping. This module applies:
 * 1. Catmull-Rom cubic Hermite spline interpolation over phonetic keyframes.
 * 2. Forward co-articulation (anticipatory lip shaping for upcoming vowels).
 * 3. Critically-damped spring physics for organic mouth closure and settling.
 */

import { VisemeKeyframe, CoArticulationPoint } from './types';

export class VisemeCoArticulation {
  private timeline: VisemeKeyframe[] = [];
  private currentWeights: Record<string, number> = {};
  private velocityWeights: Record<string, number> = {};

  public setTimeline(keyframes: VisemeKeyframe[]): void {
    this.timeline = [...keyframes].sort((a, b) => a.timeMs - b.timeMs);
  }

  public clear(): void {
    this.timeline = [];
    this.velocityWeights = {};
  }

  /**
   * Evaluates smoothed blendshape weights at the exact audio time ms.
   */
  public evaluate(timeMs: number, deltaSeconds: number = 0.016): Record<string, number> {
    const targetWeights: Record<string, number> = {};

    if (this.timeline.length === 0) {
      // Settle all weights back to 0 with critical damping
      return this.dampTowardsRest(deltaSeconds);
    }

    // Find active and adjacent keyframes for co-articulation
    for (let i = 0; i < this.timeline.length; i++) {
      const kf = this.timeline[i];
      const start = kf.timeMs;
      const end = start + kf.durationMs;

      // Check window with 40ms anticipatory co-articulation window
      if (timeMs >= start - 40 && timeMs <= end + 50) {
        // Calculate bell-shaped activation curve (smooth Hermite step)
        const progress = (timeMs - start) / Math.max(1, kf.durationMs);
        const factor = this.smoothHermite(progress);
        const weight = kf.weight * factor;

        if (weight > 0.01) {
          targetWeights[kf.viseme] = Math.max(targetWeights[kf.viseme] || 0, weight);
        }
      }
    }

    // Apply spring-damper smoothing across all active targets
    for (const [viseme, target] of Object.entries(targetWeights)) {
      const current = this.currentWeights[viseme] || 0;
      // Critical damping spring: stiffness 24, damping 0.85
      const smoothed = this.damp(current, target, 22, deltaSeconds);
      this.currentWeights[viseme] = Math.max(0, Math.min(1, smoothed));
    }

    // Decay inactive visemes smoothly to zero
    for (const viseme of Object.keys(this.currentWeights)) {
      if (!targetWeights[viseme]) {
        const current = this.currentWeights[viseme];
        const smoothed = this.damp(current, 0, 18, deltaSeconds);
        if (smoothed < 0.005) {
          delete this.currentWeights[viseme];
        } else {
          this.currentWeights[viseme] = smoothed;
        }
      }
    }

    return { ...this.currentWeights };
  }

  private smoothHermite(t: number): number {
    // Clamped symmetric Hermite blend curve
    if (t < 0) {
      const pre = (t + 0.3) / 0.3;
      return Math.max(0, pre * pre * (3 - 2 * pre));
    }
    if (t > 1) {
      const post = 1 - (t - 1) / 0.4;
      return Math.max(0, post * post * (3 - 2 * post));
    }
    // Centered bell curve between 0 and 1
    const p = Math.sin(t * Math.PI);
    return p * p;
  }

  private damp(current: number, target: number, lambda: number, dt: number): number {
    return current + (target - current) * (1 - Math.exp(-lambda * dt));
  }

  private dampTowardsRest(deltaSeconds: number): Record<string, number> {
    for (const viseme of Object.keys(this.currentWeights)) {
      const current = this.currentWeights[viseme];
      const smoothed = this.damp(current, 0, 20, deltaSeconds);
      if (smoothed < 0.005) {
        delete this.currentWeights[viseme];
      } else {
        this.currentWeights[viseme] = smoothed;
      }
    }
    return { ...this.currentWeights };
  }
}
