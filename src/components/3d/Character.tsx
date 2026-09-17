import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { LipSyncController } from '@/engine/LipSyncController';
import { ProceduralAnimation, CharacterBones } from '@/engine/ProceduralAnimation';
import { useAppStore } from '@/store/appStore';

const AVATAR_URL = '/models/avatar.glb';

export default function Character({ url }: { url?: string }) {
  const { scene } = useGLTF(url || AVATAR_URL);
  
  // CRITICAL FIX: Use SkeletonUtils.clone so skinned meshes are properly re-bound to cloned bones!
  // Standard Object3D.clone() leaves bones detached, preventing any arm/body movement.
  const clonedScene = useMemo(() => {
    return skeletonClone(scene);
  }, [scene]);

  const morphMeshes = useRef<THREE.SkinnedMesh[]>([]);
  const bones = useRef<CharacterBones>({
    head: null,
    neck: null,
    spine: null,
    spine1: null,
    leftShoulder: null,
    rightShoulder: null,
    leftArm: null,
    rightArm: null,
    leftForeArm: null,
    rightForeArm: null,
    leftHand: null,
    rightHand: null,
    fingerBones: []
  });

  const lipSyncController = useRef<LipSyncController | null>(null);
  const proceduralAnimation = useRef<ProceduralAnimation | null>(null);

  useMemo(() => {
    morphMeshes.current = [];
    bones.current = {
      head: null,
      neck: null,
      spine: null,
      spine1: null,
      leftShoulder: null,
      rightShoulder: null,
      leftArm: null,
      rightArm: null,
      leftForeArm: null,
      rightForeArm: null,
      leftHand: null,
      rightHand: null,
      fingerBones: []
    };

    clonedScene.traverse((node: any) => {
      if (node.isSkinnedMesh && node.morphTargetDictionary) {
        morphMeshes.current.push(node);
      }
      if (node.isBone) {
        if (node.name === 'Head') bones.current.head = node;
        if (node.name === 'Neck') bones.current.neck = node;
        if (node.name === 'Spine') bones.current.spine = node;
        if (node.name === 'Spine1' || node.name === 'Spine2') bones.current.spine1 = node;
        if (node.name === 'LeftShoulder') bones.current.leftShoulder = node;
        if (node.name === 'RightShoulder') bones.current.rightShoulder = node;
        if (node.name === 'LeftArm') bones.current.leftArm = node;
        if (node.name === 'RightArm') bones.current.rightArm = node;
        if (node.name === 'LeftForeArm') bones.current.leftForeArm = node;
        if (node.name === 'RightForeArm') bones.current.rightForeArm = node;
        if (node.name === 'LeftHand') bones.current.leftHand = node;
        if (node.name === 'RightHand') bones.current.rightHand = node;
        if (
          node.name.includes('HandThumb') || 
          node.name.includes('HandIndex') || 
          node.name.includes('HandMiddle') || 
          node.name.includes('HandRing') || 
          node.name.includes('HandPinky')
        ) {
          bones.current.fingerBones.push(node);
        }
      }
    });
  }, [clonedScene]);

  useEffect(() => {
    lipSyncController.current = new LipSyncController(morphMeshes.current);
    const audioElement = typeof document !== 'undefined' ? (document.getElementById('tts-audio') as HTMLAudioElement | null) : null;
    if (audioElement) {
      lipSyncController.current.connectAudioElement(audioElement);
    }
    const currentDelay = useAppStore.getState().lipSyncDelayMs;
    lipSyncController.current.setSyncDelayMs(currentDelay);

    proceduralAnimation.current = new ProceduralAnimation(
      morphMeshes.current, 
      bones.current
    );
  }, [clonedScene]);

  const visemeQueue = useAppStore((state) => state.visemeQueue);
  const speechText = useAppStore((state) => state.speechText);
  const activeCharIndex = useAppStore((state) => state.activeCharIndex);
  const isSpeaking = useAppStore((state) => state.isSpeaking);
  const lipSyncDelayMs = useAppStore((state) => state.lipSyncDelayMs);
  const selectedVoice = useAppStore((state) => state.selectedVoice);
  const voices = useAppStore((state) => state.voices);

  const activeRate = useMemo(() => {
    const v = voices.find((v) => v.id === selectedVoice);
    return v?.rate || 1.0;
  }, [voices, selectedVoice]);

  useEffect(() => {
    if (lipSyncController.current) {
      lipSyncController.current.setSyncDelayMs(lipSyncDelayMs);
    }
  }, [lipSyncDelayMs]);

  useEffect(() => {
    if (lipSyncController.current) {
      lipSyncController.current.setVisemeQueue(visemeQueue);
    }
  }, [visemeQueue]);

  useEffect(() => {
    if (lipSyncController.current && speechText && isSpeaking) {
      lipSyncController.current.startSpeechTimeline(speechText, activeRate);
    } else if (!isSpeaking && lipSyncController.current) {
      lipSyncController.current.stopSpeech();
    }
  }, [speechText, isSpeaking, activeRate]);

  const audioUrl = useAppStore((state) => state.audioUrl);

  useEffect(() => {
    const audioElement = typeof document !== 'undefined' ? (document.getElementById('tts-audio') as HTMLAudioElement | null) : null;
    if (audioElement && lipSyncController.current) {
      lipSyncController.current.connectAudioElement(audioElement);
    }
  }, [audioUrl]);

  useEffect(() => {
    if (lipSyncController.current && isSpeaking) {
      lipSyncController.current.syncCharIndex(activeCharIndex);
    }
  }, [activeCharIndex, isSpeaking]);

  useFrame((state, delta) => {
    const { isSpeaking, playbackState, agentStatus } = useAppStore.getState();
    const speaking = isSpeaking || playbackState === 'playing';

    if (lipSyncController.current) {
      lipSyncController.current.update(delta, 0, speaking);
    }
    
    if (proceduralAnimation.current) {
      proceduralAnimation.current.update(delta, speaking, agentStatus);
    }
  });

  return <primitive object={clonedScene} position={[0, 0, 0]} />;
}

useGLTF.preload(AVATAR_URL);
