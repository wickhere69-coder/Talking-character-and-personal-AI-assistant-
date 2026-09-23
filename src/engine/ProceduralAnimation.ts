import * as THREE from 'three';

export interface CharacterBones {
  head: THREE.Bone | null;
  neck: THREE.Bone | null;
  spine: THREE.Bone | null;
  spine1: THREE.Bone | null;
  leftShoulder: THREE.Bone | null;
  rightShoulder: THREE.Bone | null;
  leftArm: THREE.Bone | null;
  rightArm: THREE.Bone | null;
  leftForeArm: THREE.Bone | null;
  rightForeArm: THREE.Bone | null;
  leftHand: THREE.Bone | null;
  rightHand: THREE.Bone | null;
  fingerBones: THREE.Bone[];
}

export class ProceduralAnimation {
  private meshes: THREE.SkinnedMesh[];
  private bones: CharacterBones;

  private blinkTimer: number;
  private blinkProgress: number;
  private isBlinking: boolean;
  
  private breathPhase: number;
  private headSwayPhaseX: number;
  private headSwayPhaseY: number;
  private headSwayPhaseZ: number;
  
  private saccadeTimer: number;
  private saccadeOffset: { x: number, y: number };
  private saccadeTarget: { x: number, y: number };
  
  private settleAmount: number;

  // Stored initial bind transforms
  private initialSpineY: number = 0;
  private initialSpineRotX: number = 0;
  private initialHeadRotX: number = 0;
  private initialHeadRotY: number = 0;
  private initialHeadRotZ: number = 0;
  private initialNeckRotX: number = 0;
  private initialNeckRotY: number = 0;
  private initialNeckRotZ: number = 0;

  private initialLeftArmQuat: THREE.Quaternion = new THREE.Quaternion();
  private initialRightArmQuat: THREE.Quaternion = new THREE.Quaternion();

  // Subtle conversational nod during speech
  private nodTimer: number = 1.0;
  private nodPhase: number = 0;
  private isNodding: boolean = false;
  private nodIntensity: number = 0;

  constructor(
    meshes: THREE.SkinnedMesh[], 
    bones: CharacterBones
  ) {
    this.meshes = meshes;
    this.bones = bones;

    this.blinkTimer = 2.0;
    this.blinkProgress = 0;
    this.isBlinking = false;

    this.breathPhase = 0;
    this.headSwayPhaseX = 0;
    this.headSwayPhaseY = 0;
    this.headSwayPhaseZ = 0;

    this.saccadeTimer = 2.5;
    this.saccadeOffset = { x: 0, y: 0 };
    this.saccadeTarget = { x: 0, y: 0 };

    this.settleAmount = 0.4;

    if (this.bones.spine) {
      this.initialSpineY = this.bones.spine.position.y;
      this.initialSpineRotX = this.bones.spine.rotation.x;
    }
    if (this.bones.head) {
      this.initialHeadRotX = this.bones.head.rotation.x;
      this.initialHeadRotY = this.bones.head.rotation.y;
      this.initialHeadRotZ = this.bones.head.rotation.z;
    }
    if (this.bones.neck) {
      this.initialNeckRotX = this.bones.neck.rotation.x;
      this.initialNeckRotY = this.bones.neck.rotation.y;
      this.initialNeckRotZ = this.bones.neck.rotation.z;
    }
    if (this.bones.leftArm) {
      this.initialLeftArmQuat.copy(this.bones.leftArm.quaternion);
    }
    if (this.bones.rightArm) {
      this.initialRightArmQuat.copy(this.bones.rightArm.quaternion);
    }
  }

  setApplyToMeshes(meshes: THREE.SkinnedMesh[]): void {
    this.meshes = meshes;
  }

  update(delta: number, isSpeaking: boolean, agentStatus = 'idle'): void {
    const isThinking = agentStatus === 'thinking' || agentStatus === 'executing_tool';
    const isListening = agentStatus === 'listening';

    if (isSpeaking) {
      this.settleAmount = THREE.MathUtils.damp(this.settleAmount, 1.0, 5, delta);
    } else if (isThinking || isListening) {
      this.settleAmount = THREE.MathUtils.damp(this.settleAmount, 0.75, 4, delta);
    } else {
      this.settleAmount = THREE.MathUtils.damp(this.settleAmount, 0.4, 3, delta);
    }

    this.updateBlink(delta);
    this.updateBreathing(delta);
    this.updateHeadAndNeck(delta, isSpeaking, agentStatus);
    this.updateExpression(delta, isSpeaking, agentStatus);
    this.updateGaze(delta, agentStatus);
    this.updateNaturalStandingPose(delta, isSpeaking);
  }

  triggerBlink(): void {
    this.isBlinking = true;
    this.blinkProgress = 0;
  }

  private updateBlink(delta: number): void {
    if (!this.isBlinking) {
      this.blinkTimer -= delta;
      if (this.blinkTimer <= 0) {
        this.triggerBlink();
        this.blinkTimer = 2.5 + Math.random() * 3.5;
      }
    } else {
      const speed = 1.0 / 0.14;
      this.blinkProgress += delta * speed;
      
      let blinkWeight = 0;
      if (this.blinkProgress < 0.38) {
        blinkWeight = this.blinkProgress / 0.38;
      } else if (this.blinkProgress < 0.52) {
        blinkWeight = 1.0;
      } else if (this.blinkProgress < 1.0) {
        blinkWeight = 1.0 - (this.blinkProgress - 0.52) / 0.48;
      } else {
        this.isBlinking = false;
      }

      this.applyBlendShape('eyeBlinkLeft', blinkWeight);
      this.applyBlendShape('eyeBlinkRight', blinkWeight);
    }
  }

  private updateBreathing(delta: number): void {
    this.breathPhase += delta * (Math.PI * 2) / 3.8;
    const breathMotion = Math.sin(this.breathPhase) * 0.006 * this.settleAmount;
    
    if (this.bones.spine) {
      this.bones.spine.rotation.x = this.initialSpineRotX + breathMotion;
      this.bones.spine.position.y = this.initialSpineY + 
        Math.sin(this.breathPhase * 2) * 0.0008 * this.settleAmount;
    }
  }

  private updateHeadAndNeck(delta: number, isSpeaking: boolean, agentStatus = 'idle'): void {
    this.headSwayPhaseX += delta * (Math.PI * 2) * 0.28;
    this.headSwayPhaseY += delta * (Math.PI * 2) * 0.20;
    this.headSwayPhaseZ += delta * (Math.PI * 2) * 0.14;

    // Subtle conversational nod on speech accents or attentive listening
    if (isSpeaking) {
      this.nodTimer -= delta;
      if (this.nodTimer <= 0) {
        this.isNodding = true;
        this.nodPhase = 0;
        this.nodIntensity = 0;
        this.nodTimer = 2.5 + Math.random() * 2.5;
      }
    } else if (agentStatus === 'listening') {
      // Attentive listening micro-nod every 3.5 - 5 seconds
      this.nodTimer -= delta;
      if (this.nodTimer <= 0) {
        this.isNodding = true;
        this.nodPhase = 0;
        this.nodIntensity = 0;
        this.nodTimer = 3.5 + Math.random() * 2.0;
      }
    } else {
      this.isNodding = false;
      this.nodIntensity = 0;
      this.nodTimer = 1.0;
    }

    let nodOffset = 0;
    if (this.isNodding) {
      this.nodPhase += delta * Math.PI * 2.5;
      this.nodIntensity = THREE.MathUtils.damp(this.nodIntensity, 1.0, 8, delta);
      const amplitude = isSpeaking ? 0.035 : 0.022; // subtle, calm micro-nod
      nodOffset = this.nodIntensity * Math.sin(this.nodPhase) * amplitude;
      if (this.nodPhase > Math.PI * 4) {
        this.isNodding = false;
        this.nodIntensity = 0;
      }
    }

    // Agent behavioral tilt
    let agentTiltZ = 0;
    let agentTiltX = 0;
    if (agentStatus === 'thinking' || agentStatus === 'executing_tool') {
      agentTiltZ = 0.035; // thoughtful tilt
      agentTiltX = -0.015;
    } else if (agentStatus === 'listening') {
      agentTiltX = 0.025; // subtle attentive forward posture
      agentTiltZ = 0.015; // natural engaged head angle
    } else if (agentStatus === 'awaiting_confirmation') {
      agentTiltZ = 0.025;
    }

    // Natural cervical head & neck rotation (neck 30%, head 70%)
    if (this.bones.neck) {
      this.bones.neck.rotation.x = this.initialNeckRotX + 
        (Math.sin(this.headSwayPhaseX) * 0.004 + nodOffset * 0.3 + agentTiltX * 0.3) * this.settleAmount;
      this.bones.neck.rotation.y = this.initialNeckRotY + 
        Math.sin(this.headSwayPhaseY) * 0.006 * this.settleAmount;
      this.bones.neck.rotation.z = this.initialNeckRotZ + 
        (Math.sin(this.headSwayPhaseZ) * 0.003 + agentTiltZ * 0.3) * this.settleAmount;
    }

    if (this.bones.head) {
      this.bones.head.rotation.x = this.initialHeadRotX + 
        (Math.sin(this.headSwayPhaseX) * 0.010 + this.saccadeOffset.y * 0.10 + nodOffset * 0.7 + agentTiltX * 0.7) * this.settleAmount;
      this.bones.head.rotation.y = this.initialHeadRotY + 
        (Math.sin(this.headSwayPhaseY) * 0.014 + this.saccadeOffset.x * 0.10) * this.settleAmount;
      this.bones.head.rotation.z = this.initialHeadRotZ + 
        (Math.sin(this.headSwayPhaseZ) * 0.004 + agentTiltZ * 0.7) * this.settleAmount;
    }
  }

  private updateExpression(delta: number, isSpeaking: boolean, agentStatus = 'idle'): void {
    // Warm, friendly subtle resting smile matching Image 2
    const targetSmile = isSpeaking ? 0.06 : 0.12;
    this.applyBlendShape('mouthSmileLeft', targetSmile);
    this.applyBlendShape('mouthSmileRight', targetSmile);

    // Subtle eyebrow lift on open vowels during speech OR while thinking
    let targetInnerUp = 0;
    if (agentStatus === 'thinking' || agentStatus === 'executing_tool') {
      targetInnerUp = 0.16; // curious/thinking eyebrow raise
    } else if (isSpeaking) {
      let jawOpen = 0;
      if (this.meshes.length > 0 && this.meshes[0].morphTargetDictionary) {
        const idx = this.meshes[0].morphTargetDictionary['jawOpen'];
        if (idx !== undefined && this.meshes[0].morphTargetInfluences) {
          jawOpen = this.meshes[0].morphTargetInfluences[idx];
        }
      }
      if (jawOpen > 0.35) {
        targetInnerUp = 0.15;
      }
    }
    
    let currentInnerUp = 0;
    if (this.meshes.length > 0 && this.meshes[0].morphTargetDictionary) {
      const idx = this.meshes[0].morphTargetDictionary['browInnerUp'];
      if (idx !== undefined && this.meshes[0].morphTargetInfluences) {
        currentInnerUp = this.meshes[0].morphTargetInfluences[idx];
      }
    }

    const nextInnerUp = THREE.MathUtils.damp(currentInnerUp, targetInnerUp, 10, delta);
    this.applyBlendShape('browInnerUp', nextInnerUp);
  }

  private updateGaze(delta: number, agentStatus = 'idle'): void {
    this.saccadeTimer -= delta;
    if (this.saccadeTimer <= 0) {
      if (agentStatus === 'thinking' || agentStatus === 'executing_tool') {
        // Thoughtful gaze: slightly up and away
        this.saccadeTarget = {
          x: 0.02,
          y: 0.025
        };
        this.saccadeTimer = 1.2;
      } else if (agentStatus === 'listening') {
        // Attentive center gaze
        this.saccadeTarget = {
          x: (Math.random() - 0.5) * 0.01,
          y: (Math.random() - 0.5) * 0.01
        };
        this.saccadeTimer = 2.0;
      } else {
        this.saccadeTarget = {
          x: (Math.random() - 0.5) * 0.03,
          y: (Math.random() - 0.5) * 0.03
        };
        this.saccadeTimer = 2.0 + Math.random() * 3.0;
      }
    }

    this.saccadeOffset.x = THREE.MathUtils.damp(this.saccadeOffset.x, this.saccadeTarget.x, 15, delta);
    this.saccadeOffset.y = THREE.MathUtils.damp(this.saccadeOffset.y, this.saccadeTarget.y, 15, delta);

    if (this.saccadeOffset.x > 0) {
      this.applyBlendShape('eyeLookInLeft', this.saccadeOffset.x);
      this.applyBlendShape('eyeLookOutRight', this.saccadeOffset.x);
      this.applyBlendShape('eyeLookOutLeft', 0);
      this.applyBlendShape('eyeLookInRight', 0);
    } else {
      this.applyBlendShape('eyeLookOutLeft', -this.saccadeOffset.x);
      this.applyBlendShape('eyeLookInRight', -this.saccadeOffset.x);
      this.applyBlendShape('eyeLookInLeft', 0);
      this.applyBlendShape('eyeLookOutRight', 0);
    }

    if (this.saccadeOffset.y > 0) {
      this.applyBlendShape('eyeLookUpLeft', this.saccadeOffset.y);
      this.applyBlendShape('eyeLookUpRight', this.saccadeOffset.y);
      this.applyBlendShape('eyeLookDownLeft', 0);
      this.applyBlendShape('eyeLookDownRight', 0);
    } else {
      this.applyBlendShape('eyeLookDownLeft', -this.saccadeOffset.y);
      this.applyBlendShape('eyeLookDownRight', -this.saccadeOffset.y);
      this.applyBlendShape('eyeLookUpLeft', 0);
      this.applyBlendShape('eyeLookUpRight', 0);
    }
  }

  /**
   * EXACT NATURAL STANDING POSE (Matching User Reference Image 2):
   * Uses quaternion rotation around local bone axis directly from initial bind pose.
   * This guarantees arms hang straight down along the sides of the torso,
   * hands rest beside the thighs, and never twist or point up.
   */
  private updateNaturalStandingPose(delta: number, _isSpeaking: boolean): void {
    const { leftArm, rightArm, fingerBones } = this.bones;

    const breathMotion = Math.sin(this.breathPhase) * 0.003 * this.settleAmount;
    const slerpSpeed = 8.0;

    // Rotate LeftArm on its local X axis by +0.42 rad to bring it from A-pose down to side of torso
    if (leftArm && this.initialLeftArmQuat) {
      const qTargetL = this.initialLeftArmQuat.clone();
      qTargetL.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.42 + breathMotion));
      leftArm.quaternion.slerp(qTargetL, Math.min(1.0, slerpSpeed * delta));
    }

    // Rotate RightArm on its local X axis by +0.42 rad to bring it from A-pose down to side of torso
    if (rightArm && this.initialRightArmQuat) {
      const qTargetR = this.initialRightArmQuat.clone();
      qTargetR.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.42 - breathMotion));
      rightArm.quaternion.slerp(qTargetR, Math.min(1.0, slerpSpeed * delta));
    }

    // Relaxed natural human finger curl (matching Image 2)
    if (fingerBones && fingerBones.length > 0) {
      for (const f of fingerBones) {
        if (!f.name.includes('Thumb')) {
          f.rotation.x = THREE.MathUtils.damp(f.rotation.x, 0.18, 5, delta);
        } else {
          f.rotation.z = THREE.MathUtils.damp(f.rotation.z, 0.10, 5, delta);
        }
      }
    }
  }

  private applyBlendShape(shapeName: string, value: number): void {
    for (const mesh of this.meshes) {
      if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
        const index = mesh.morphTargetDictionary[shapeName];
        if (index !== undefined) {
          mesh.morphTargetInfluences[index] = value;
        }
      }
    }
  }
}
