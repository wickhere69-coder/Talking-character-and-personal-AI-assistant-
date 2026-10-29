import React, { useState } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { ChatSession } from '@/types/session';
import {
  Plus,
  Search,
  Pin,
  Archive,
  Trash2,
  Edit2,
  Check,
  X,
  Clock,
  ArchiveRestore,
  MoreVertical,
  MessageSquare,
  Sparkles
} from 'lucide-react';

interface SessionSidebarProps {
  onSessionSelect?: (sessionId: string) => void;
  compact?: boolean;
}

export default function SessionSidebar({ onSessionSelect, compact = false }: SessionSidebarProps) {
  const {
    activeSessionId,
    sessionSearchQuery,
    setSessionSearchQuery,
    showArchived,
    setShowArchived,
    createNewSession,
    selectSession,
    renameSession,
    togglePinSession,
    toggleArchiveSession,
    setDeletingSession,
    getGroupedSessions,
    isLoadingSessions
  } = useSessionStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const grouped = getGroupedSessions();

  const handleStartRename = (e: React.MouseEvent, session: ChatSession) => {
    e.stopPropagation();
    setMenuOpenId(null);
    setEditingId(session.id);
    setEditTitle(session.title);
  };

  const handleSaveRename = async (e: React.MouseEvent | React.KeyboardEvent, id: string) => {
    e.stopPropagation();
    if (editTitle.trim()) {
      await renameSession(id, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleSelect = async (id: string) => {
    setMenuOpenId(null);
    await selectSession(id);
    onSessionSelect?.(id);
  };

  const handleCreateNew = async () => {
    const created = await createNewSession('New Conversation', 'General');
    onSessionSelect?.(created.id);
  };

  const renderSessionItem = (session: ChatSession) => {
    const isActive = session.id === activeSessionId;
    const isEditing = editingId === session.id;
    const isMenuOpen = menuOpenId === session.id;

    return (
      <div
        key={session.id}
        onClick={() => !isEditing && handleSelect(session.id)}
        className={`group relative px-3 py-2.5 rounded-xl transition-all duration-150 cursor-pointer flex flex-col gap-1 active:scale-[0.99] ${
          isActive
            ? 'bg-[#181C2C] border border-[#6E8BFF]/40 shadow-[0_0_24px_rgba(110,139,255,0.12)]'
            : 'bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.04] hover:border-white/[0.08]'
        }`}
      >
        {/* Left active glowing indicator */}
        {isActive && (
          <div className="absolute left-0 top-2.5 bottom-2.5 w-1 bg-[#6E8BFF] rounded-r-full shadow-[0_0_10px_#6E8BFF]" />
        )}

        {/* Title row */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-1.5 w-full" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveRename(e, session.id)}
                className="flex-1 bg-white/[0.08] border border-[#6E8BFF] rounded-lg px-2 py-1 text-xs text-[#F2F2F2] focus:outline-none"
                autoFocus
              />
              <button
                type="button"
                onClick={(e) => handleSaveRename(e, session.id)}
                className="w-6 h-6 rounded-md bg-[#6E8BFF] text-[#0B0D12] flex items-center justify-center shrink-0"
              >
                <Check size={12} strokeWidth={2.5} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingId(null);
                }}
                className="w-6 h-6 rounded-md bg-white/[0.08] text-[#A7A9AF] hover:text-[#F2F2F2] flex items-center justify-center shrink-0"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {session.pinned && (
                <Pin size={11} className="text-amber-400 shrink-0 fill-amber-400" />
              )}
              <span
                className={`text-xs font-sans truncate ${
                  isActive ? 'text-[#F2F2F2] font-semibold' : 'text-[#F2F2F2]/80 group-hover:text-[#F2F2F2]'
                }`}
                title={session.title}
              >
                {session.title}
              </span>
            </div>
          )}

          {/* Clean Menu Action Dropdown (replaces congested micro-buttons) */}
          {!isEditing && (
            <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpenId(isMenuOpen ? null : session.id);
                }}
                className={`p-1 rounded-lg transition ${
                  isMenuOpen || isActive
                    ? 'text-[#F2F2F2] bg-white/[0.08]'
                    : 'text-[#A7A9AF]/60 opacity-0 group-hover:opacity-100 hover:text-[#F2F2F2] hover:bg-white/[0.06]'
                }`}
                title="Session options"
              >
                <MoreVertical size={13} />
              </button>

              {/* Floating Action Menu */}
              {isMenuOpen && (
                <div
                  className="absolute right-0 top-6 z-50 w-36 bg-[#131622] border border-white/[0.12] rounded-xl shadow-2xl p-1 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePinSession(session.id);
                      setMenuOpenId(null);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs text-[#F2F2F2] hover:bg-white/[0.08] flex items-center gap-2 transition"
                  >
                    <Pin size={12} className={session.pinned ? 'text-amber-400' : 'text-[#A7A9AF]'} />
                    <span>{session.pinned ? 'Unpin' : 'Pin to top'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => handleStartRename(e, session)}
                    className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs text-[#F2F2F2] hover:bg-white/[0.08] flex items-center gap-2 transition"
                  >
                    <Edit2 size={12} className="text-[#A7A9AF]" />
                    <span>Rename</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleArchiveSession(session.id);
                      setMenuOpenId(null);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs text-[#F2F2F2] hover:bg-white/[0.08] flex items-center gap-2 transition"
                  >
                    {session.archived ? (
                      <>
                        <ArchiveRestore size={12} className="text-cyan-400" />
                        <span>Unarchive</span>
                      </>
                    ) : (
                      <>
                        <Archive size={12} className="text-[#A7A9AF]" />
                        <span>Archive</span>
                      </>
                    )}
                  </button>

                  <div className="h-px bg-white/[0.06] my-0.5" />

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(null);
                      setDeletingSession(session);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 transition"
                  >
                    <Trash2 size={12} />
                    <span>Delete</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Clean Meta: Topic Badge & Count */}
        <div className="flex items-center justify-between text-[10px] text-[#A7A9AF]/70 font-mono">
          <span className="truncate max-w-[150px] text-[#A7A9AF]">
            {session.topic || 'General'}
          </span>
          <span className="text-[10px] text-[#A7A9AF]/50 shrink-0">
            {session.messageCount || 0} msgs
          </span>
        </div>
      </div>
    );
  };

  const renderSection = (title: string, items: ChatSession[], icon?: React.ReactNode) => {
    if (items.length === 0) return null;

    return (
      <div className="space-y-1 pt-1.5">
        <div className="px-2 py-1 flex items-center justify-between text-[10px] uppercase font-mono tracking-wider text-[#A7A9AF]/60 font-semibold">
          <div className="flex items-center gap-1.5">
            {icon}
            <span>{title}</span>
          </div>
          <span className="text-[9px] text-[#A7A9AF]/40">({items.length})</span>
        </div>
        <div className="space-y-1">
          {items.map(renderSessionItem)}
        </div>
      </div>
    );
  };

  return (
    <div className={`flex flex-col h-full ${compact ? 'p-1' : 'p-3'} space-y-2.5 select-none`}>
      {/* ── New Chat Action Button ── */}
      <button
        type="button"
        onClick={handleCreateNew}
        className="w-full py-2.5 px-3.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] active:scale-[0.98] border border-white/[0.08] hover:border-white/[0.16] text-[#F2F2F2] font-semibold text-xs transition-all flex items-center justify-center gap-2 shadow-sm group"
      >
        <Plus size={15} strokeWidth={2.5} className="text-[#6E8BFF] group-hover:rotate-90 transition-transform duration-200" />
        <span className="tracking-tight font-sans">New Session</span>
      </button>

      {/* ── Search Input ── */}
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A7A9AF]/60" />
        <input
          type="text"
          value={sessionSearchQuery}
          onChange={(e) => setSessionSearchQuery(e.target.value)}
          placeholder="Search chats..."
          className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-xs text-[#F2F2F2] placeholder-[#A7A9AF]/40 focus:outline-none focus:border-[#6E8BFF]/50 transition font-sans"
        />
        {sessionSearchQuery && (
          <button
            type="button"
            onClick={() => setSessionSearchQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#A7A9AF] hover:text-[#F2F2F2]"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* ── Scrollable Grouped Session List ── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-0.5">
        {isLoadingSessions ? (
          <div className="py-8 text-center text-xs text-[#A7A9AF]/60 font-sans">
            Loading sessions...
          </div>
        ) : (
          <>
            {renderSection('Pinned', grouped.pinned, <Pin size={11} className="text-amber-400" />)}
            {renderSection('Today', grouped.today, <Clock size={11} className="text-[#6E8BFF]" />)}
            {renderSection('Previous 7 Days', grouped.previous7Days)}
            {renderSection('Older', grouped.older)}

            {/* Archived Toggle & Section */}
            <div className="pt-2 border-t border-white/[0.06]">
              <button
                type="button"
                onClick={() => setShowArchived(!showArchived)}
                className="w-full flex items-center justify-between px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-[#A7A9AF]/60 hover:text-[#A7A9AF] transition"
              >
                <div className="flex items-center gap-1.5">
                  <Archive size={11} />
                  <span>Archived Chats</span>
                </div>
                <span>{grouped.archived.length}</span>
              </button>

              {showArchived && (
                <div className="space-y-1 mt-1.5">
                  {grouped.archived.length === 0 ? (
                    <p className="px-2 py-2 text-[11px] text-[#A7A9AF]/40 italic">
                      No archived sessions.
                    </p>
                  ) : (
                    grouped.archived.map(renderSessionItem)
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
