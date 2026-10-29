import React, { Suspense, useRef, useEffect, lazy } from 'react';
import { Canvas } from '@react-three/fiber';
import { Loader } from '@react-three/drei';
import * as THREE from 'three';
import Character from '@/components/3d/Character';
import StudioScene from '@/components/3d/StudioScene';
import CameraRig from '@/components/3d/CameraRig';
import PostProcessing from '@/components/3d/PostProcessing';
import AppSidebar from '@/components/ui/AppSidebar';
import ConversationBar from '@/components/ui/ConversationBar';
import ControlPanel from '@/components/ui/ControlPanel';
import LowerThird from '@/components/ui/LowerThird';
import ConversationHistoryModal from '@/components/ui/ConversationHistoryModal';
import FullResponseModal from '@/components/ui/FullResponseModal';
import DeleteSessionModal from '@/components/ui/DeleteSessionModal';
import SessionMemoryModal from '@/components/ui/SessionMemoryModal';
import { useSessionStore } from '@/store/sessionStore';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useAppStore } from '@/store/appStore';
import { voiceManager } from '@/services/voiceManager';
import { auraController } from '@/services/auraConversationController';

// Admin panel — lazy loaded, only accessible via secret URL
const AdminPanel = lazy(() => import('@/components/admin/AdminPanel'));

// ── Admin Route Guard ──────────────────────────────────────────────────────────
function isAdminRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname;
  const hash = window.location.hash;
  const params = new URLSearchParams(window.location.search);
  return path === '/admin' || hash === '#admin' || params.has('admin') || !!params.get('key');
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [isAdminOpen, setIsAdminOpen] = React.useState<boolean>(() => isAdminRoute());

  React.useEffect(() => {
    const handleOpenAdmin = () => setIsAdminOpen(true);
    const handleCloseAdmin = () => {
      setIsAdminOpen(false);
      if (typeof window !== 'undefined') {
        window.history.pushState(null, '', '/');
      }
    };

    window.addEventListener('open-admin-panel', handleOpenAdmin);
    window.addEventListener('close-admin-panel', handleCloseAdmin);

    const onPopState = () => {
      setIsAdminOpen(isAdminRoute());
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      window.removeEventListener('open-admin-panel', handleOpenAdmin);
      window.removeEventListener('close-admin-panel', handleCloseAdmin);
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  // Check for admin view first — if admin, render admin panel
  if (isAdminOpen) {
    return (
      <Suspense fallback={
        <div className="min-h-screen bg-[#0B0D12] flex items-center justify-center">
          <div className="text-[#6E8BFF] text-sm animate-pulse">Loading admin panel...</div>
        </div>
      }>
        <AdminPanel onBack={() => {
          setIsAdminOpen(false);
          if (typeof window !== 'undefined') {
            window.history.pushState(null, '', '/');
          }
        }} />
      </Suspense>
    );
  }

  return <MainApp />;
}

function MainApp() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const {
    playbackState,
    setActiveNavTab,
    setIsControlPanelCollapsed,
    isControlPanelCollapsed,
    activeNavTab
  } = useAppStore();

  useEffect(() => {
    voiceManager.setAudioElement(audioRef.current);

    // Global one-time browser audio unlocker on user interaction
    const unlockAudio = () => {
      const audio = audioRef.current;
      if (audio) {
        // Unlock with 1-sample silent WAV data URI
        const prevSrc = audio.src;
        if (!prevSrc) {
          audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
        }
        audio.play().then(() => {
          audio.pause();
          if (!prevSrc) audio.removeAttribute('src');
        }).catch(() => {});
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
        } catch {}
      }
    };

    window.addEventListener('click', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });

    return () => {
      voiceManager.setAudioElement(null);
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
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

  useEffect(() => {
    auraController.initialize();
    useSessionStore.getState().loadSessions();

    const handleStop = () => auraController.stopConversation();
    window.addEventListener('studio-stop-conversation', handleStop);

    return () => {
      window.removeEventListener('studio-stop-conversation', handleStop);
      auraController.destroy();
    };
  }, []);

  const handleOpenTab = (tab: 'home' | 'chat' | 'voice' | 'settings') => {
    setActiveNavTab(tab);
    if (tab === 'home') {
      setIsControlPanelCollapsed(true);
    } else {
      setIsControlPanelCollapsed(false);
    }
  };

  return (
    <ErrorBoundary>
      {/* ── Main Application Shell ── */}
      <div className="w-screen h-screen flex overflow-hidden bg-[#0B0D12] text-[#F2F2F2] font-sans antialiased select-none">
        
        {/* Continuous Audio Element for Speech & TTS */}
        <audio 
          ref={audioRef} 
          id="tts-audio" 
          style={{ position: 'fixed', opacity: 0, pointerEvents: 'none', width: '1px', height: '1px', bottom: 0, left: 0 }} 
          preload="auto" 
        />

        {/* ── LEFT: Fixed Vertical Sidebar ── */}
        <AppSidebar onOpenTab={handleOpenTab} />

        {/* ── RIGHT: Main Conversation & Talking Character Area ── */}
        <main className="flex-1 relative h-full flex flex-col justify-end overflow-hidden bg-[#0B0D12]">

          {/* ── Layered Atmospheric Background ── */}
          <div className="absolute inset-0 pointer-events-none z-0">
            {/* Primary character backlight glow */}
            <div className="absolute top-[38%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[700px] bg-[#314B9A]/15 rounded-full blur-[160px] animate-[pulse_8s_ease-in-out_infinite]" />
            {/* Secondary warm accent — subtle purple-rose halo */}
            <div className="absolute top-[55%] left-[55%] -translate-x-1/2 -translate-y-1/2 w-[500px] h-[400px] bg-[#6E3FA0]/8 rounded-full blur-[120px]" />
            {/* Top-edge vignette for depth */}
            <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-[#0B0D12] via-[#0B0D12]/60 to-transparent" />
            {/* Bottom-edge vignette to ground the input bar */}
            <div className="absolute bottom-0 left-0 right-0 h-56 bg-gradient-to-t from-[#0B0D12] via-[#0B0D12]/80 to-transparent" />
            {/* Ultra-subtle noise texture overlay */}
            <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")', backgroundRepeat: 'repeat', backgroundSize: '128px 128px' }} />
          </div>

          {/* ── 3D Viewport Canvas ── */}
          <div className="absolute inset-0 z-0">
            <Canvas
              gl={{ toneMapping: THREE.NoToneMapping, antialias: true, alpha: true }}
              shadows
              camera={{ position: [0, 1.35, 2.3], fov: 34 }}
              className="!w-full !h-full"
            >
              <Suspense fallback={null}>
                <StudioScene />
                <Character />
              </Suspense>
              <CameraRig />
              <PostProcessing />
            </Canvas>
          </div>



          {/* ── CENTER-BOTTOM: Subtitles + Input ── */}
          <div className="relative z-20 w-full flex flex-col items-center">
            <LowerThird />
            {(activeNavTab === 'home' || isControlPanelCollapsed) && (
              <ConversationBar />
            )}
          </div>
        </main>

        {/* ── 3D Scene Loader ── */}
        <Loader
          containerStyles={{ background: '#0B0D12', zIndex: 60 }}
          innerStyles={{ width: '240px', backgroundColor: 'rgba(255, 255, 255, 0.08)', borderRadius: '9999px' }}
          barStyles={{ background: '#6E8BFF', borderRadius: '9999px' }}
          dataStyles={{ color: '#F2F2F2', fontSize: '13px', fontWeight: '400', fontFamily: 'Inter, sans-serif' }}
          dataInterpolation={(p) => `Loading... ${p.toFixed(0)}%`}
        />

        {/* ── Drawer (Chat, Voice) ── */}
        <ControlPanel />

        {/* ── Utility Modals ── */}
        <ConversationHistoryModal />
        <FullResponseModal />
        <DeleteSessionModal />
        <SessionMemoryModal />
      </div>
    </ErrorBoundary>
  );
}
