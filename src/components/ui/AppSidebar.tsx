import React from 'react';
import { useAppStore } from '@/store/appStore';
import {
  Home,
  MessageSquare,
  Mic,
  Sparkles,
  Shield
} from 'lucide-react';
import SessionSidebar from './SessionSidebar';

/**
 * AppSidebar — Minimal, compact dark sidebar
 * Target: Dark human aesthetic matching approved reference design.
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
    { id: 'home' as const, label: 'Home', icon: Home },
    { id: 'chat' as const, label: 'Chat', icon: MessageSquare },
    { id: 'voice' as const, label: 'Voice', icon: Mic },
  ];

  return (
    <>
      {/* ── Mobile Compact Top Navigation ── */}
      <header className="sm:hidden fixed top-0 left-0 right-0 h-13 bg-[#181818] border-b border-[#2A2C33] z-40 px-3.5 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#A78BFA] to-[#6E8BFF] flex items-center justify-center shadow-sm shrink-0">
            <Sparkles size={12} strokeWidth={2} className="text-white" />
          </div>
          <span className="text-sm font-semibold text-[#F2F2F2] font-sans tracking-tight">Aura</span>
        </div>

        <nav className="flex items-center gap-1" aria-label="Mobile Navigation">
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
                className={`p-2 rounded-full transition-all duration-150 relative ${
                  isActive
                    ? 'bg-[#A78BFA]/15 text-[#F2F2F2]'
                    : 'text-[#A7A9AF] hover:text-[#F2F2F2] active:scale-95'
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
            className="p-2 rounded-full text-[#A7A9AF]/70 hover:text-[#A78BFA] transition"
            title="Admin Console"
          >
            <Shield size={14} strokeWidth={1.75} />
          </button>
        </nav>
      </header>

      {/* ── Fixed Vertical Sidebar (Desktop) ── */}
      <aside
        aria-label="Main Navigation"
        className="hidden sm:flex flex-col justify-between w-[72px] md:w-[260px] lg:w-[270px] h-full z-30 bg-[#181818] border-r border-[#2A2C33] p-3 select-none shrink-0 transition-all duration-200 overflow-hidden"
      >
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden gap-3.5">
          {/* Top: Application Branding */}
          <div className="flex items-center justify-center md:justify-start gap-2.5 px-1 pt-1 pb-0.5 shrink-0">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#A78BFA] to-[#6E8BFF] flex items-center justify-center shadow-sm shrink-0">
              <Sparkles size={13} strokeWidth={2} className="text-white" />
            </div>
            <div className="hidden md:flex flex-col min-w-0">
              <span className="text-[14px] font-semibold tracking-tight text-[#F2F2F2] font-sans leading-tight">
                Aura
              </span>
              <span className="text-[10px] text-[#A7A9AF] font-sans leading-none mt-0.5">
                AI Studio
              </span>
            </div>
          </div>

          {/* Navigation Items (Slim rows, active with soft violet highlight + thin left indicator) */}
          <nav className="flex flex-col gap-1 shrink-0" aria-label="Sidebar Navigation">
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
                  className={`relative w-full flex items-center justify-center md:justify-start px-3 py-2 rounded-xl text-xs font-medium text-left transition-all duration-150 active:scale-[0.98] ${
                    isActive
                      ? 'bg-[#A78BFA]/10 text-[#F2F2F2]'
                      : 'text-[#A7A9AF] hover:text-[#F2F2F2] hover:bg-white/[0.04]'
                  }`}
                >
                  {/* Thin left indicator bar for active state */}
                  {isActive && (
                    <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#6E8BFF] rounded-r-full" />
                  )}

                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      size={15}
                      strokeWidth={1.75}
                      className={`transition-colors shrink-0 ${isActive ? 'text-[#A78BFA]' : 'text-[#A7A9AF]'}`}
                    />
                    <span className="hidden md:inline font-sans truncate">{item.label}</span>
                  </div>
                </button>
              );
            })}
          </nav>

          {/* Desktop Session Management & Grouped History */}
          <div className="hidden md:flex flex-col flex-1 min-h-0 overflow-hidden pt-2 border-t border-[#2A2C33]">
            <SessionSidebar onSessionSelect={() => onOpenTab('chat')} compact />
          </div>
        </div>

        {/* Bottom: Aura Status — Slim, quiet footer with small avatar and green Ready dot */}
        <div className="pt-2.5 border-t border-[#2A2C33] flex flex-col gap-1.5 shrink-0">
          <div className="flex items-center justify-between px-2 py-1.5 bg-[#202126] rounded-xl border border-white/[0.06]">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#A78BFA] to-[#6E8BFF] flex items-center justify-center shrink-0">
                <Sparkles size={9} strokeWidth={2} className="text-white" />
              </div>

              <div className="hidden md:flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-medium text-[#F2F2F2] truncate font-sans">
                  Aura AI
                </span>
                <span className="text-[11px] text-[#A7A9AF] font-sans flex items-center gap-1">
                  •
                  {isCharacterSpeaking ? (
                    <span className="text-[#A78BFA] flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#A78BFA]" />
                      Speaking
                    </span>
                  ) : isBusy ? (
                    <span className="text-[#A78BFA] flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#A78BFA]" />
                      Thinking
                    </span>
                  ) : isListening ? (
                    <span className="text-cyan-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                      Listening
                    </span>
                  ) : (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      Ready
                    </span>
                  )}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={openAdmin}
              className="hidden md:flex p-1 rounded-lg text-[#A7A9AF]/60 hover:text-[#F2F2F2] transition"
              title="Admin Console"
            >
              <Shield size={13} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
