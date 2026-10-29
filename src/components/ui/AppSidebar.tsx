import React from 'react';
import { useAppStore } from '@/store/appStore';
import { useSessionStore } from '@/store/sessionStore';
import {
  Home,
  MessageSquare,
  Mic,
  Sparkles,
  Shield
} from 'lucide-react';
import SessionSidebar from './SessionSidebar';

/**
 * AppSidebar — Premium frosted-glass sidebar with animated branding, navigation,
 * and integrated persistent session history grouped by time periods.
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

  // Public nav items
  const navItems = [
    { id: 'home' as const, label: 'Home', icon: Home },
    { id: 'chat' as const, label: 'Chat', icon: MessageSquare },
    { id: 'voice' as const, label: 'Voice', icon: Mic },
  ];

  return (
    <>
      {/* ── Mobile Compact Top Navigation ── */}
      <header className="sm:hidden fixed top-0 left-0 right-0 h-13 bg-[#0D0F17]/90 backdrop-blur-2xl border-b border-white/[0.08] z-40 px-3.5 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-2.5">
          {/* Animated brand orb */}
          <div className="relative w-8 h-8">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-[#6E8BFF] to-[#A78BFA] opacity-60 blur-md animate-pulse" />
            <div className="relative w-8 h-8 rounded-xl bg-gradient-to-br from-[#6E8BFF] to-[#A78BFA] flex items-center justify-center shadow-lg">
              <Sparkles size={13} strokeWidth={2} className="text-white" />
            </div>
          </div>
          <span className="text-sm font-bold text-[#F2F2F2] font-sans tracking-tight">Aura</span>
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
                className={`p-2 rounded-xl transition-all duration-200 ${
                  isActive
                    ? 'bg-white/[0.08] text-[#6E8BFF] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
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
            className="p-2 rounded-xl text-[#A7A9AF]/60 hover:text-[#6E8BFF] transition"
            title="Admin Console"
          >
            <Shield size={14} strokeWidth={1.75} />
          </button>
        </nav>
      </header>

      {/* ── Fixed Vertical Sidebar (Desktop) ── */}
      <aside
        aria-label="Main Navigation"
        className="hidden sm:flex flex-col justify-between w-[72px] md:w-[260px] lg:w-[280px] h-full z-30 bg-[#0D0F17]/85 backdrop-blur-2xl border-r border-white/[0.08] p-3 md:p-4 select-none shrink-0 transition-all duration-200 shadow-[4px_0_24px_rgba(0,0,0,0.5)] overflow-hidden"
      >
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden gap-4">
          {/* Top: Application Branding */}
          <div className="flex items-center justify-center md:justify-start gap-3 px-1 md:px-2 pt-1 pb-1 shrink-0">
            <div className="relative w-9 h-9 shrink-0">
              <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-[#6E8BFF] via-[#A78BFA] to-[#F472B6] opacity-40 blur-lg animate-[pulse_3s_ease-in-out_infinite]" />
              <div className="relative w-9 h-9 rounded-2xl bg-gradient-to-br from-[#6E8BFF] to-[#A78BFA] flex items-center justify-center shadow-[0_4px_20px_rgba(110,139,255,0.4)]">
                <Sparkles size={17} strokeWidth={2} className="text-white" />
              </div>
            </div>
            <div className="hidden md:flex flex-col min-w-0">
              <span className="text-[14px] font-bold tracking-tight text-[#F2F2F2] font-sans leading-tight">
                Aura
              </span>
              <span className="text-[10px] text-[#A7A9AF]/80 font-sans leading-none mt-0.5">
                AI Studio
              </span>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="flex flex-col gap-1 shrink-0" aria-label="Sidebar Navigation">
            {navItems.map((item, index) => {
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
                  style={{ animationDelay: `${index * 60}ms` }}
                  className={`w-full flex items-center justify-center md:justify-between px-2.5 md:px-3 py-2 rounded-xl text-xs font-medium text-left active:scale-[0.98] ${
                    isActive
                      ? 'bg-white/[0.08] text-[#F2F2F2] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_3px_rgba(0,0,0,0.3)]'
                      : 'text-[#A7A9AF] hover:text-[#F2F2F2] hover:bg-white/[0.04]'
                  } transition-all duration-200`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon
                      size={16}
                      strokeWidth={1.75}
                      className={`transition-colors shrink-0 ${isActive ? 'text-[#6E8BFF]' : 'text-[#A7A9AF]'}`}
                    />
                    <span className="hidden md:inline font-sans">{item.label}</span>
                  </div>

                  {isActive && (
                    <span className="hidden md:inline-block w-1.5 h-1.5 rounded-full bg-[#6E8BFF] shadow-[0_0_8px_rgba(110,139,255,0.8)]" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Desktop Session Management & Grouped History */}
          <div className="hidden md:flex flex-col flex-1 min-h-0 overflow-hidden pt-2 border-t border-white/[0.06]">
            <SessionSidebar onSessionSelect={() => onOpenTab('chat')} compact />
          </div>
        </div>

        {/* Bottom: Aura Status — reactive live avatar card */}
        <div className="pt-3 border-t border-white/[0.06] flex flex-col gap-2 shrink-0">
          <div className="flex items-center justify-between px-1 md:px-2 py-1.5 bg-[#131622]/60 rounded-2xl border border-white/[0.05] p-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative w-7 h-7 shrink-0">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-[#6E8BFF] via-[#A78BFA] to-[#F472B6] p-[1.5px] animate-[spin_8s_linear_infinite]">
                  <div className="w-full h-full rounded-full bg-[#0D0F17]" />
                </div>
                <div className="absolute inset-[2px] rounded-full bg-gradient-to-br from-[#6E8BFF] to-[#A78BFA] flex items-center justify-center">
                  <Sparkles size={10} strokeWidth={2.5} className="text-white" />
                </div>
                <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-[1.5px] border-[#0D0F17] ${
                  isCharacterSpeaking
                    ? 'bg-[#6E8BFF] shadow-[0_0_8px_rgba(110,139,255,1)] animate-ping'
                    : isBusy
                    ? 'bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,1)] animate-pulse'
                    : isListening
                    ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,1)] animate-pulse'
                    : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]'
                }`} />
              </div>

              <div className="hidden md:block text-left min-w-0">
                <span className="block text-xs font-semibold text-[#F2F2F2] truncate font-sans leading-tight">
                  Aura AI
                </span>
                <span className="text-[10px] font-sans leading-none flex items-center gap-1 mt-0.5">
                  {isCharacterSpeaking ? (
                    <span className="text-[#6E8BFF] font-medium">Speaking...</span>
                  ) : isBusy ? (
                    <span className="text-violet-400 font-medium">Thinking...</span>
                  ) : isListening ? (
                    <span className="text-cyan-400 font-medium">Listening...</span>
                  ) : (
                    <span className="text-emerald-400">Ready</span>
                  )}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={openAdmin}
              className="hidden md:flex p-1.5 rounded-lg text-[#A7A9AF]/50 hover:text-[#6E8BFF] transition"
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
