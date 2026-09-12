import * as THREE from 'three';
import { detectMorphTargetType, getVisemeWeights, OCULUS_VISEME_TO_ARKIT, AZURE_VISEME_TO_OCULUS } from './visemeMappings';
import { VisemeFrame } from '@/types';
import { SpeechVisemeCue, buildSpeechVisemeTimeline } from './phonemizer';

export class LipSyncController {
  private meshes: THREE.SkinnedMesh[];
  private morphTargetType: 'oculus' | 'arkit';
  private visemeQueue: VisemeFrame[] = [];
  private speechCues: SpeechVisemeCue[] = [];
  private speechClockMs: number = 0;
  private currentWeights: Record<string, number> = {};
  private isSettling: boolean = false;
  private wasSpeaking: boolean = false;
  private speechStarted: boolean = false;

  constructor(meshes: THREE.SkinnedMesh[]) {
    this.meshes = meshes;
    let dict: Record<string, number> = {};
    if (meshes.length > 0 && meshes[0].morphTargetDictionary) {
      dict = meshes[0].morphTargetDictionary;
    }
    this.morphTargetType = detectMorphTargetType(dict);
  }

  setVisemeQueue(queue: VisemeFrame[]): void {
    this.visemeQueue = [...queue].sort((a, b) => a.audioOffset - b.audioOffset);
  }

  /**
   * Prepares the phonetic speech viseme timeline from text
   */
  startSpeechTimeline(text: string, rate: number = 1.0): void {
    this.speechCues = buildSpeechVisemeTimeline(text, rate);
    this.speechClockMs = 0;
    this.isSettling = false;
    this.speechStarted = true;
  }

  signalSpeechActuallyStarted(): void {
    this.speechStarted = true;
    this.speechClockMs = 0;
  }

  syncCharIndex(charIndex: number): void {
    if (!this.speechCues.length) return;
    const matched = this.speechCues.find(c => c.charIndex >= charIndex);
    if (matched) {
      this.speechClockMs = (this.speechClockMs * 0.3) + (matched.timeMs * 0.7);
    }
  }

  stopSpeech(): void {
    this.speechCues = [];
    this.visemeQueue = [];
    this.speechStarted = false;
    this.startSettle();
  }

  /**
   * Safe audio connection: keeps HTML5 <audio> playing natively to speakers
   * without hijacking the stream into a suspended Web Audio graph.
   */
  connectAudioElement(_audio: HTMLAudioElement): void {
    // Keep HTML5 audio directly connected to system output for 100% reliability
  }

  disconnectAudio(): void {
    // Cleanup
  }

  startSettle(): void {
    this.isSettling = true;
  }

  reset(): void {
    this.visemeQueue = [];
    this.speechCues = [];
    this.speechClockMs = 0;
    this.currentWeights = {};
    this.isSettling = false;
    this.speechStarted = false;
    this.applyWeightsToMeshes();
  }

  update(delta: number, audioCurrentTimeMs: number, isSpeaking: boolean): void {
    // Detect transition from speaking to not speaking
    if (this.wasSpeaking && !isSpeaking) {
      this.startSettle();
      this.speechStarted = false;
    }
    this.wasSpeaking = isSpeaking;

    if (!isSpeaking) {
      if (!this.isSettling) return;

      let allZero = true;
      for (const shape in this.currentWeights) {
        this.currentWeights[shape] = THREE.MathUtils.damp(this.currentWeights[shape], 0, 16, delta);
        if (this.currentWeights[shape] > 0.005) {
          allZero = false;
        } else {
          this.currentWeights[shape] = 0;
        }
      }
      this.applyWeightsToMeshes();
      if (allZero) {
        this.isSettling = false;
      }
      return;
    }

    // Speaking is active
    this.speechStarted = true;
    this.speechClockMs += delta * 1000;
    const timeMs = audioCurrentTimeMs > 0 ? audioCurrentTimeMs : this.speechClockMs;

    let targetWeights: Record<string, number> = {};

    if (this.visemeQueue.length > 0) {
      // High-precision ElevenLabs timestamps
      targetWeights = this.interpolateVisemes(timeMs);
    } else if (this.speechCues.length > 0) {
      // Natural English phoneme-to-viseme timeline
      targetWeights = this.sampleSpeechTimeline(timeMs);
    } else {
      // Natural cadence speech articulation fallback - gentle natural human amplitude
      const t = this.speechClockMs * 0.009;
      const jaw = (Math.sin(t * 4.2) * 0.5 + 0.5) * 0.32 + (Math.sin(t * 8.4) * 0.08);
      targetWeights = {
        'viseme_aa': Math.max(0, jaw * 0.45),
        'viseme_E': Math.max(0, (Math.cos(t * 4.8) * 0.5 + 0.5) * 0.28),
        'jawOpen': Math.max(0, jaw * 0.22)
      };
    }

    // Smooth damp towards target weights for fluid, non-jittery lip sync
    const allKeys = new Set([...Object.keys(this.currentWeights), ...Object.keys(targetWeights)]);
    for (const shape of allKeys) {
      const current = this.currentWeights[shape] || 0;
      const target = targetWeights[shape] || 0;
      this.currentWeights[shape] = THREE.MathUtils.damp(current, target, 20, delta);
    }

    this.applyWeightsToMeshes();
  }

  private sampleSpeechTimeline(timeMs: number): Record<string, number> {
    if (!this.speechCues.length) return {};

    // Find the active cue
    let activeIdx = 0;
    for (let i = 0; i < this.speechCues.length; i++) {
      if (timeMs >= this.speechCues[i].timeMs) {
        activeIdx = i;
      } else {
        break;
      }
    }

    const currentCue = this.speechCues[activeIdx];
    const nextCue = activeIdx < this.speechCues.length - 1 ? this.speechCues[activeIdx + 1] : null;
    const prevCue = activeIdx > 0 ? this.speechCues[activeIdx - 1] : null;

    let blendFactor = 0;
    if (nextCue && nextCue.timeMs > currentCue.timeMs) {
      const progress = (timeMs - currentCue.timeMs) / (nextCue.timeMs - currentCue.timeMs);
      const clamped = Math.max(0, Math.min(1, progress));
      blendFactor = 0.5 - 0.5 * Math.cos(Math.PI * clamped);
    }

    const weights: Record<string, number> = {};

    const applyCueToWeights = (cue: SpeechVisemeCue, scale: number) => {
      if (!cue || cue.viseme === 'viseme_sil') return;

      const directOculus = cue.viseme;
      // Natural human scale factor (prevents exaggerated mouth stretching & lip ballooning)
      const humanScale = 0.55;
      weights[directOculus] = (weights[directOculus] || 0) + cue.intensity * scale * humanScale;

      // Only add subtle separate jawOpen for non-oculus meshes (Oculus visemes already include jaw lowering)
      if (this.morphTargetType !== 'oculus' && cue.jawOpen > 0) {
        weights['jawOpen'] = Math.max(weights['jawOpen'] || 0, cue.jawOpen * scale * 0.35);
      }

      // If mesh is ARKit standard, also map composite shapes with scaled intensity
      if (this.morphTargetType === 'arkit') {
        const arkitMap = OCULUS_VISEME_TO_ARKIT[cue.viseme] || {};
        for (const k in arkitMap) {
          weights[k] = Math.max(weights[k] || 0, arkitMap[k] * scale * cue.intensity * 0.50);
        }
      }
    };

    applyCueToWeights(currentCue, 1 - blendFactor);
    if (nextCue) {
      applyCueToWeights(nextCue, blendFactor);
    }

    // Co-articulation from prev cue
    if (prevCue && (1 - blendFactor) > 0.5) {
      applyCueToWeights(prevCue, 0.15);
    }

    // Clamp values between 0 and 0.58 to maintain normal lip size
    for (const k in weights) {
      weights[k] = Math.min(0.58, Math.max(0, weights[k]));
    }

    return weights;
  }

  private applyWeightsToMeshes(): void {
    for (const mesh of this.meshes) {
      if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
      
      for (const shape in this.currentWeights) {
        const index = mesh.morphTargetDictionary[shape];
        if (index !== undefined) {
          const val = this.currentWeights[shape];
          // Restrict mouth deformations to natural human range
          const clamped = (shape.startsWith('viseme_') || shape.startsWith('mouth') || shape === 'jawOpen')
            ? Math.min(0.58, Math.max(0, val))
            : val;
          mesh.morphTargetInfluences[index] = clamped;
        }
      }
    }
  }

  private interpolateVisemes(timeMs: number): Record<string, number> {
    if (this.visemeQueue.length === 0) return {};
    
    let low = 0;
    let high = this.visemeQueue.length - 1;
    let idx = 0;
    
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.visemeQueue[mid].audioOffset <= timeMs) {
        idx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const currentFrame = this.visemeQueue[idx];
    const nextFrame = idx < this.visemeQueue.length - 1 ? this.visemeQueue[idx + 1] : null;

    let targetWeights: Record<string, number> = {};

    const getWeights = (visemeId: number | string): Record<string, number> => {
      let name = 'viseme_sil';
      if (typeof visemeId === 'number') {
        name = AZURE_VISEME_TO_OCULUS[visemeId] || 'viseme_sil';
      } else {
        name = visemeId;
      }
      return { [name]: 0.52, 'jawOpen': name === 'viseme_aa' ? 0.30 : 0.12 };
    };

    const wCurrent = getWeights(currentFrame.visemeId);
    
    if (nextFrame && nextFrame.audioOffset > currentFrame.audioOffset) {
      const t = (timeMs - currentFrame.audioOffset) / (nextFrame.audioOffset - currentFrame.audioOffset);
      const clampedT = Math.max(0, Math.min(1, t));
      const factor = 0.5 - 0.5 * Math.cos(Math.PI * clampedT);
      const wNext = getWeights(nextFrame.visemeId);

      for (const k in wCurrent) {
        targetWeights[k] = (targetWeights[k] || 0) + wCurrent[k] * (1 - factor);
      }
      for (const k in wNext) {
        targetWeights[k] = (targetWeights[k] || 0) + wNext[k] * factor;
      }
    } else {
      for (const k in wCurrent) {
        targetWeights[k] = wCurrent[k];
      }
    }

    return targetWeights;
  }
}
