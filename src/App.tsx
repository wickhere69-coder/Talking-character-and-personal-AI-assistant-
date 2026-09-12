import React, { Suspense, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { Loader } from '@react-three/drei';
import * as THREE from 'three';
import Character from '@/components/3d/Character';
import StudioScene from '@/components/3d/StudioScene';
import CameraRig from '@/components/3d/CameraRig';
import PostProcessing from '@/components/3d/PostProcessing';
import ControlPanel from '@/components/ui/ControlPanel';
import LowerThird from '@/components/ui/LowerThird';
import ConversationHistoryModal from '@/components/ui/ConversationHistoryModal';
import FullResponseModal from '@/components/ui/FullResponseModal';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useAppStore } from '@/store/appStore';

import { voiceManager } from '@/services/voiceManager';

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const { audioUrl, playbackState, setPlaybackState, setIsSpeaking, sceneTheme } = useAppStore();

  useEffect(() => {
    voiceManager.setAudioElement(audioRef.current);
    return () => {
      voiceManager.setAudioElement(null);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (playbackState === 'paused') {
      audio.pause();
    } else if (playbackState === 'idle') {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [playbackState]);

  return (
    <ErrorBoundary>
      <div className="w-full h-full relative overflow-hidden bg-[#0a0a0f]">
        <audio ref={audioRef} id="tts-audio" className="hidden" preload="auto" />

        <Canvas
          gl={{ toneMapping: THREE.NoToneMapping, antialias: true, alpha: true }}
          shadows
          camera={{ position: [0, 1.35, 2.3], fov: 34 }}
          className="!absolute inset-0"
        >
          <Suspense fallback={null}>
            <StudioScene />
            <Character />
          </Suspense>
          <CameraRig />
          <PostProcessing />
        </Canvas>

        <Loader
          containerStyles={{ background: '#0a0a0f', zIndex: 40 }}
          innerStyles={{ width: '260px', backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: '9999px' }}
          barStyles={{ backgroundColor: '#6366f1', borderRadius: '9999px' }}
          dataStyles={{ color: '#c7d2fe', fontSize: '13px', fontWeight: '500', fontFamily: 'sans-serif' }}
          dataInterpolation={(p) => `Loading 3D Studio... ${p.toFixed(0)}%`}
        />

        <ControlPanel />
        <LowerThird />
        <ConversationHistoryModal />
        <FullResponseModal />
      </div>
    </ErrorBoundary>
  );
}
