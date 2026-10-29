import * as THREE from 'three';
import type { CharacterBones } from './ProceduralAnimation';
import type { EmotionState, EmotionType, GestureCue } from '@/services/emotionDetector';

interface EmotionExpression {
  browDownLeft: number;
  browDownRight: number;
  browOuterUpLeft: number;
  browOuterUpRight: number;
  eyeSquintLeft: number;
  eyeSquintRight: number;
  eyeWideLeft: number;
  eyeWideRight: number;
  mouthFrownLeft: number;
  mouthFrownRight: number;
  mouthPucker: number;
  cheekSquintLeft: number;
  cheekSquintRight: number;
  cheekPuff: number;
  noseSneerLeft: number;
  noseSneerRight: number;
  jawForward: number;
}

const EMPTY_EXPRESSION: EmotionExpression = {
  browDownLeft: 0, browDownRight: 0,
  browOuterUpLeft: 0, browOuterUpRight: 0,
  eyeSquintLeft: 0, eyeSquintRight: 0,
  eyeWideLeft: 0, eyeWideRight: 0,
  mouthFrownLeft: 0, mouthFrownRight: 0,
  mouthPucker: 0,
  cheekSquintLeft: 0, cheekSquintRight: 0,
  cheekPuff: 0,
  noseSneerLeft: 0, noseSneerRight: 0,
  jawForward: 0,
};

const EMOTION_PRESETS: Record<EmotionType, Partial<EmotionExpression>> = {
  neutral: {},
  happy: {
    cheekSquintLeft: 0.3, cheekSquintRight: 0.3,
    eyeSquintLeft: 0.15, eyeSquintRight: 0.15,
    browOuterUpLeft: 0.1, browOuterUpRight: 0.1,
  },
  excited: {
    eyeWideLeft: 0.25, eyeWideRight: 0.25,
    browOuterUpLeft: 0.3, browOuterUpRight: 0.3,
    cheekSquintLeft: 0.2, cheekSquintRight: 0.2,
  },
  curious: {
    browOuterUpLeft: 0.25, browOuterUpRight: 0.1,
    eyeWideLeft: 0.1, eyeWideRight: 0.05,
  },
  concerned: {
    browDownLeft: 0.2, browDownRight: 0.2,
    mouthFrownLeft: 0.15, mouthFrownRight: 0.15,
  },
  empathetic: {
    browOuterUpLeft: 0.15, browOuterUpRight: 0.15,
    browDownLeft: 0.08, browDownRight: 0.08,
    mouthFrownLeft: 0.08, mouthFrownRight: 0.08,
  },
  thoughtful: {
    browDownLeft: 0.1, browDownRight: 0.05,
    mouthPucker: 0.12,
    eyeSquintLeft: 0.08, eyeSquintRight: 0.08,
  },
  surprised: {
    eyeWideLeft: 0.4, eyeWideRight: 0.4,
    browOuterUpLeft: 0.4, browOuterUpRight: 0.4,
    jawForward: 0.1,
  },
  amused: {
    cheekSquintLeft: 0.35, cheekSquintRight: 0.35,
    eyeSquintLeft: 0.2, eyeSquintRight: 0.2,
    noseSneerLeft: 0.08, noseSneerRight: 0.08,
  },
  confident: {
    browOuterUpLeft: 0.08, browOuterUpRight: 0.08,
    cheekSquintLeft: 0.1, cheekSquintRight: 0.1,
  },
};

interface ActiveGesture {
  cue: GestureCue;
  phase: number;
  duration: number;
  intensity: number;
}

export class HumanBehavior {
  private meshes: THREE.SkinnedMesh[];
  private bones: CharacterBones;

  private targetExpression: EmotionExpression = { ...EMPTY_EXPRESSION };
  private currentExpression: EmotionExpression = { ...EMPTY_EXPRESSION };
  private currentEmotion: EmotionState = { primary: 'neutral', intensity: 0.3, secondary: null };

  private activeGesture: ActiveGesture | null = null;
  private gestureQueue: GestureCue[] = [];
  private gestureCooldown: number = 0;

  private microExpressionTimer: number = 0;
  private microExpressionTarget: Partial<EmotionExpression> = {};

  private weightShiftPhase: number = 0;
  private fidgetTimer: number = 8 + Math.random() * 6;
  private fidgetPhase: number = 0;
  private isFidgeting: boolean = false;

  private initialLeftForeArmQuat: THREE.Quaternion = new THREE.Quaternion();
  private initialRightForeArmQuat: THREE.Quaternion = new THREE.Quaternion();
  private initialLeftShoulderQuat: THREE.Quaternion = new THREE.Quaternion();
  private initialRightShoulderQuat: THREE.Quaternion = new THREE.Quaternion();

  constructor(meshes: THREE.SkinnedMesh[], bones: CharacterBones) {
    this.meshes = meshes;
    this.bones = bones;

    if (bones.leftForeArm) this.initialLeftForeArmQuat.copy(bones.leftForeArm.quaternion);
    if (bones.rightForeArm) this.initialRightForeArmQuat.copy(bones.rightForeArm.quaternion);
    if (bones.leftShoulder) this.initialLeftShoulderQuat.copy(bones.leftShoulder.quaternion);
    if (bones.rightShoulder) this.initialRightShoulderQuat.copy(bones.rightShoulder.quaternion);
  }

  setEmotion(emotion: EmotionState): void {
    this.currentEmotion = emotion;
    const preset = EMOTION_PRESETS[emotion.primary] || {};
    this.targetExpression = { ...EMPTY_EXPRESSION };
    for (const [key, value] of Object.entries(preset)) {
      (this.targetExpression as any)[key] = (value as number) * emotion.intensity;
    }
  }

  queueGesture(cue: GestureCue): void {
    if (cue !== 'none' && this.gestureQueue.length < 3) {
      this.gestureQueue.push(cue);
    }
  }

  update(delta: number, isSpeaking: boolean, agentStatus: string): void {
    this.updateEmotionBlend(delta);
    this.updateMicroExpressions(delta, isSpeaking);
    this.updateGestures(delta, isSpeaking);
    this.updateIdleBehaviors(delta, isSpeaking, agentStatus);
  }

  private updateEmotionBlend(delta: number): void {
    const speed = 4.0;
    for (const key of Object.keys(this.currentExpression) as (keyof EmotionExpression)[]) {
      const target = this.targetExpression[key] + (this.microExpressionTarget[key] || 0);
      this.currentExpression[key] = THREE.MathUtils.damp(
        this.currentExpression[key], target, speed, delta
      );
      this.applyBlendShape(key, this.currentExpression[key]);
    }
  }

  private updateMicroExpressions(delta: number, isSpeaking: boolean): void {
    this.microExpressionTimer -= delta;
    if (this.microExpressionTimer <= 0) {
      this.microExpressionTimer = isSpeaking
        ? 1.5 + Math.random() * 2.0
        : 4.0 + Math.random() * 4.0;

      const emotion = this.currentEmotion.primary;
      this.microExpressionTarget = {};

      if (isSpeaking) {
        const r = Math.random();
        if (r < 0.3) {
          this.microExpressionTarget.browOuterUpLeft = 0.12 + Math.random() * 0.1;
          this.microExpressionTarget.browOuterUpRight = 0.12 + Math.random() * 0.1;
        } else if (r < 0.5) {
          this.microExpressionTarget.cheekSquintLeft = 0.1;
          this.microExpressionTarget.cheekSquintRight = 0.1;
        } else if (r < 0.65) {
          this.microExpressionTarget.eyeSquintLeft = 0.1;
          this.microExpressionTarget.eyeSquintRight = 0.1;
        }
      } else if (emotion === 'thoughtful' || emotion === 'curious') {
        if (Math.random() < 0.4) {
          this.microExpressionTarget.browOuterUpLeft = 0.08;
          this.microExpressionTarget.mouthPucker = 0.06;
        }
      }
    }
  }

  private updateGestures(delta: number, isSpeaking: boolean): void {
    this.gestureCooldown = Math.max(0, this.gestureCooldown - delta);

    if (!this.activeGesture && this.gestureQueue.length > 0 && this.gestureCooldown <= 0 && isSpeaking) {
      const cue = this.gestureQueue.shift()!;
      this.activeGesture = {
        cue,
        phase: 0,
        duration: this.gestureDuration(cue),
        intensity: 0,
      };
      this.gestureCooldown = 2.0 + Math.random() * 1.5;
    }

    if (this.activeGesture) {
      const g = this.activeGesture;
      g.phase += delta;
      const t = g.phase / g.duration;

      g.intensity = t < 0.2
        ? t / 0.2
        : t < 0.7
        ? 1.0
        : 1.0 - (t - 0.7) / 0.3;

      if (t < 1.0) {
        this.applyGesture(g);
      } else {
        this.activeGesture = null;
      }
    }
  }

  private gestureDuration(cue: GestureCue): number {
    switch (cue) {
      case 'nod': return 0.8;
      case 'head_tilt': return 1.5;
      case 'emphasis': return 0.9;
      case 'hand_raise': return 1.2;
      case 'both_hands': return 1.8;
      case 'shrug': return 1.4;
      case 'wave': return 1.6;
      case 'thinking_pose': return 2.0;
      case 'point': return 1.0;
      default: return 1.0;
    }
  }

  private applyGesture(g: ActiveGesture): void {
    const i = g.intensity;
    const { head, neck, leftForeArm, rightForeArm, leftShoulder, rightShoulder } = this.bones;

    switch (g.cue) {
      case 'nod':
        if (head) {
          head.rotation.x += Math.sin(g.phase * Math.PI * 3) * 0.04 * i;
        }
        break;

      case 'head_tilt':
        if (head) {
          head.rotation.z += 0.06 * i;
          head.rotation.x -= 0.02 * i;
        }
        break;

      case 'emphasis':
        if (leftForeArm) {
          const q = this.initialLeftForeArmQuat.clone();
          q.multiply(new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0), -0.15 * i
          ));
          leftForeArm.quaternion.slerp(q, 0.3);
        }
        if (head) {
          head.rotation.x += Math.sin(g.phase * Math.PI * 2) * 0.02 * i;
        }
        break;

      case 'hand_raise':
        if (leftForeArm) {
          const q = this.initialLeftForeArmQuat.clone();
          q.multiply(new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0), -0.25 * i
          ));
          leftForeArm.quaternion.slerp(q, 0.25);
        }
        if (leftShoulder) {
          const q = this.initialLeftShoulderQuat.clone();
          q.multiply(new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1), 0.06 * i
          ));
          leftShoulder.quaternion.slerp(q, 0.2);
        }
        break;

      case 'both_hands':
        for (const [forearm, initQ] of [
          [leftForeArm, this.initialLeftForeArmQuat],
          [rightForeArm, this.initialRightForeArmQuat],
        ] as [THREE.Bone | null, THREE.Quaternion][]) {
          if (forearm) {
            const q = initQ.clone();
            q.multiply(new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(1, 0, 0), -0.18 * i
            ));
            forearm.quaternion.slerp(q, 0.25);
          }
        }
        break;

      case 'shrug':
        if (leftShoulder) {
          leftShoulder.rotation.z += 0.05 * i;
          leftShoulder.rotation.y += 0.02 * i;
        }
        if (rightShoulder) {
          rightShoulder.rotation.z -= 0.05 * i;
          rightShoulder.rotation.y -= 0.02 * i;
        }
        if (head) {
          head.rotation.z += 0.03 * i;
        }
        break;

      case 'wave':
        if (rightForeArm) {
          const q = this.initialRightForeArmQuat.clone();
          const wave = Math.sin(g.phase * Math.PI * 4) * 0.12 * i;
          q.multiply(new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1), wave - 0.2 * i
          ));
          rightForeArm.quaternion.slerp(q, 0.3);
        }
        break;

      case 'thinking_pose':
        if (head) {
          head.rotation.z += 0.04 * i;
          head.rotation.x -= 0.03 * i;
        }
        if (leftForeArm) {
          const q = this.initialLeftForeArmQuat.clone();
          q.multiply(new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0), -0.3 * i
          ));
          leftForeArm.quaternion.slerp(q, 0.2);
        }
        break;

      case 'point':
        if (rightForeArm) {
          const q = this.initialRightForeArmQuat.clone();
          q.multiply(new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0), -0.2 * i
          ));
          rightForeArm.quaternion.slerp(q, 0.25);
        }
        break;
    }
  }

  private updateIdleBehaviors(delta: number, isSpeaking: boolean, agentStatus: string): void {
    if (isSpeaking || agentStatus === 'thinking') return;

    this.weightShiftPhase += delta * 0.15;
    if (this.bones.spine) {
      this.bones.spine.rotation.z += Math.sin(this.weightShiftPhase) * 0.003;
    }

    this.fidgetTimer -= delta;
    if (this.fidgetTimer <= 0 && !this.isFidgeting) {
      this.isFidgeting = true;
      this.fidgetPhase = 0;
      this.fidgetTimer = 6 + Math.random() * 8;
    }

    if (this.isFidgeting) {
      this.fidgetPhase += delta;
      const t = this.fidgetPhase / 1.5;
      if (t < 1.0) {
        const intensity = Math.sin(t * Math.PI);
        if (this.bones.rightShoulder) {
          this.bones.rightShoulder.rotation.y += intensity * 0.015;
        }
        if (this.bones.head) {
          this.bones.head.rotation.y += intensity * 0.01;
        }
      } else {
        this.isFidgeting = false;
      }
    }
  }

  private applyBlendShape(name: string, value: number): void {
    for (const mesh of this.meshes) {
      if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
        const idx = mesh.morphTargetDictionary[name];
        if (idx !== undefined) {
          mesh.morphTargetInfluences[idx] = Math.max(0, Math.min(1, value));
        }
      }
    }
  }
}
