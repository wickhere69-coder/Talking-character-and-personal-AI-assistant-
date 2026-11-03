import React from 'react';
import { useAppStore } from '@/store/appStore';
import {
  Home,
  MessageSquare,
  Mic,
  Shield
} from 'lucide-react';
import SessionSidebar from './SessionSidebar';

/**
 * AppSidebar — Aura Premium Dark Design
 * Updated to match the latest changes in Figma (Frame 1:2, 1:49, 1:102):
 * - Brand: "Aura AI" in white bold text
 * - Width: 280px, background: #12141B, border-r: #23252F
 * - Navigation: Home, Chat, Voice with #8B7CFF active state & 3px indicator
 * - Bottom: "Aura AI • Ready • v2" status pill (#1A1D27)
 */
interface AppSidebarProps {
  onOpenTab: (tab: 'home' | 'chat' | 'voice' | 'settings') => void;
}

export default function AppSidebar({ onOpenTab }: AppSidebarProps) {
  const {
    activeNavTab,
    isControlPanelCollapsed,
    isSpeaking,
    playbackState,
    agentStatus,
    isListening
  } = useAppStore();

  const isBusy = agentStatus === 'thinking' || agentStatus === 'planning' || playbackState === 'loading';
  const isCharacterSpeaking = isSpeaking || playbackState === 'playing' || agentStatus === 'speaking';

  const openAdmin = () => {
    window.dispatchEvent(new CustomEvent('open-admin-panel'));
  };

  const navItems = [
    { id: 'home' as const, label: '⌂  Home', icon: Home },
    { id: 'chat' as const, label: '✉  Chat', icon: MessageSquare },
    { id: 'voice' as const, label: '◉  Voice', icon: Mic },
  ];

  return (
    <>
      {/* ── Mobile Compact Top Navigation ── */}
      <header className="sm:hidden fixed top-0 left-0 right-0 h-14 bg-[#12141B]/95 backdrop-blur-xl border-b border-[#23252F] z-40 px-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2">
          <h1 className="text-[17px] font-bold text-[#FFFFFF] tracking-tight">Aura AI</h1>
        </div>

        <nav className="flex items-center gap-1.5" aria-label="Mobile Navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === 'home'
              ? activeNavTab === 'home' || isControlPanelCollapsed
              : activeNavTab === item.id && !isControlPanelCollapsed;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenTab(item.id)}
                className={`p-2 rounded-xl transition-all duration-150 relative ${
                  isActive
                    ? 'bg-[#8B7CFF] text-[#FFFFFF]'
                    : 'text-[#C9CBD3] hover:text-[#FFFFFF] active:scale-95'
                }`}
                title={item.label}
              >
                <Icon size={16} strokeWidth={1.75} />
              </button>
            );
          })}
          <button
            type="button"
            onClick={openAdmin}
            className="p-2 rounded-xl text-[#7A7D86] hover:text-[#8B7CFF] transition"
            title="Admin Console"
          >
            <Shield size={14} strokeWidth={1.75} />
          </button>
        </nav>
      </header>

      {/* ── Desktop Sidebar matching Figma: Width 280px, Fill #12141B, Border #23252F ── */}
      <aside
        aria-label="Main Navigation"
        className="hidden sm:flex flex-col justify-between w-[74px] md:w-[280px] h-full z-30 bg-[#12141B] border-r border-[#23252F] p-4 select-none shrink-0 transition-all duration-200 overflow-hidden font-sans"
      >
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden gap-3.5">
          {/* Top Brand: Clean "Aura AI" text matching Figma Frame 1:2 */}
          <div className="flex items-center justify-center md:justify-start px-2 pt-1 pb-1 shrink-0">
            <span className="text-[18px] font-bold text-[#FFFFFF] tracking-tight">
              Aura AI
            </span>
          </div>

          {/* Navigation Items: Height 42px, radius 10px, #8B7CFF when active with 3px indicator */}
          <nav className="flex flex-col gap-1.5 shrink-0" aria-label="Sidebar Navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === 'home'
                ? activeNavTab === 'home' || isControlPanelCollapsed
                : activeNavTab === item.id && !isControlPanelCollapsed;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenTab(item.id)}
                  title={item.label}
                  className={`relative w-full h-[42px] flex items-center justify-center md:justify-start px-3.5 rounded-[10px] text-[14px] font-medium text-left transition-all duration-150 active:scale-[0.98] cursor-pointer ${
                    isActive
                      ? 'bg-[#8B7CFF] text-[#FFFFFF] font-semibold shadow-[0_2px_12px_rgba(139,124,255,0.25)]'
                      : 'text-[#C9CBD3] hover:text-[#FFFFFF] hover:bg-[#1A1D27]'
                  }`}
                >
                  {/* Left 3px indicator matching Figma */}
                  {isActive && (
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#8B7CFF] rounded-r" />
                  )}

                  <div className="flex items-center gap-3 min-w-0">
                    <Icon
                      size={16}
                      strokeWidth={1.8}
                      className={`transition-colors shrink-0 ${isActive ? 'text-white' : 'text-[#7A7D86]'}`}
                    />
                    <span className="hidden md:inline truncate">
                      {item.id === 'home' ? 'Home' : item.id === 'chat' ? 'Chat' : 'Voice'}
                    </span>
                  </div>
                </button>
              );
            })}
          </nav>

          {/* Desktop Session Management & Grouped History */}
          <div className="hidden md:flex flex-col flex-1 min-h-0 overflow-hidden pt-2 border-t border-[#23252F]">
            <SessionSidebar onSessionSelect={() => onOpenTab('chat')} compact />
          </div>
        </div>

        {/* Bottom: Status Pill matching Figma "Aura AI • Ready • v2" (Rectangle 248x52 at #1A1D27) */}
        <div className="pt-2 border-t border-[#23252F] flex flex-col gap-1.5 shrink-0">
          <div className="h-[52px] flex items-center justify-between px-3 bg-[#1A1D27] rounded-[16px] border border-[#2A2E3B]">
            <div className="flex items-center gap-2.5 min-w-0">
              {/* Green indicator dot 10x10 */}
              <div className="w-2.5 h-2.5 rounded-full bg-[#34D399] shadow-[0_0_8px_#34D399] shrink-0" />

              <div className="hidden md:flex flex-col min-w-0">
                <span className="text-[13px] font-semibold text-[#F2F2F2] leading-tight truncate">
                  Aura AI
                </span>
                <span className="text-[11px] font-medium leading-none mt-0.5">
                  {isCharacterSpeaking ? (
                    <span className="text-[#8B7CFF]">Speaking</span>
                  ) : isBusy ? (
                    <span className="text-[#8B7CFF]">Thinking</span>
                  ) : isListening ? (
                    <span className="text-amber-400">Listening</span>
                  ) : (
                    <span className="text-[#34D399]">Ready</span>
                  )}
                </span>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-2">
              <span className="text-[11px] text-[#7A7D86] font-mono">v2</span>
              <button
                type="button"
                onClick={openAdmin}
                className="p-1 rounded-lg text-[#7A7D86] hover:text-[#FFFFFF] transition"
                title="Admin Console"
              >
                <Shield size={12} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
