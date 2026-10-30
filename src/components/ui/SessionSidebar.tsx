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
  MoreVertical
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
        className={`group relative px-2.5 py-2 rounded-[14px] transition-all duration-150 cursor-pointer flex flex-col gap-1 active:scale-[0.99] select-none ${
          isActive
            ? 'bg-[#A78BFA]/10 border border-white/[0.08] shadow-sm'
            : 'bg-[#131622] hover:bg-[#202126] border border-[#2A2C33] hover:border-white/[0.12]'
        }`}
      >
        {/* Left active thin indicator bar */}
        {isActive && (
          <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-[#6E8BFF] rounded-r-full" />
        )}

        {/* Title row */}
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-1.5 w-full" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveRename(e, session.id)}
                className="flex-1 bg-[#11131C] border border-[#A78BFA]/60 rounded-full px-2.5 py-0.5 text-xs text-[#F2F2F2] focus:outline-none font-sans"
                autoFocus
              />
              <button
                type="button"
                onClick={(e) => handleSaveRename(e, session.id)}
                className="w-5 h-5 rounded-full bg-[#A78BFA] text-[#0B0D12] flex items-center justify-center shrink-0"
              >
                <Check size={11} strokeWidth={2.5} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingId(null);
                }}
                className="w-5 h-5 rounded-full bg-white/[0.08] text-[#A7A9AF] hover:text-[#F2F2F2] flex items-center justify-center shrink-0"
              >
                <X size={11} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {session.pinned && (
                <Pin size={10} className="text-amber-400 shrink-0 fill-amber-400" />
              )}
              <span
                className={`text-xs font-sans truncate ${
                  isActive ? 'text-[#F2F2F2] font-semibold' : 'text-[#F2F2F2]/85 group-hover:text-[#F2F2F2]'
                }`}
                title={session.title}
              >
                {session.title}
              </span>
            </div>
          )}

          {/* Three-dot Action Menu (fully visible inside the row, never cut off) */}
          {!isEditing && (
            <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpenId(isMenuOpen ? null : session.id);
                }}
                className={`p-1 rounded-full transition ${
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
                  className="absolute right-0 top-6 z-50 w-36 bg-[#181818] border border-[#2A2C33] rounded-[14px] shadow-2xl p-1 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePinSession(session.id);
                      setMenuOpenId(null);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs text-[#F2F2F2] hover:bg-white/[0.06] flex items-center gap-2 transition"
                  >
                    <Pin size={12} className={session.pinned ? 'text-amber-400' : 'text-[#A7A9AF]'} />
                    <span>{session.pinned ? 'Unpin' : 'Pin to top'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => handleStartRename(e, session)}
                    className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs text-[#F2F2F2] hover:bg-white/[0.06] flex items-center gap-2 transition"
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
                    className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs text-[#F2F2F2] hover:bg-white/[0.06] flex items-center gap-2 transition"
                  >
                    {session.archived ? (
                      <>
                        <ArchiveRestore size={12} className="text-[#A78BFA]" />
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

        {/* Preview / Topic & Message Count Pill */}
        <div className="flex items-center justify-between gap-2 text-[11px] text-[#A7A9AF] font-sans min-w-0">
          <span className="truncate text-[#A7A9AF]/80 flex-1">
            {session.topic || 'General'}
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-[#A7A9AF] shrink-0">
            {session.messageCount || 0} msgs
          </span>
        </div>
      </div>
    );
  };

  const renderSection = (title: string, items: ChatSession[], icon?: React.ReactNode) => {
    if (items.length === 0) return null;

    return (
      <div className="space-y-1 pt-1">
        <div className="px-2 py-1 flex items-center justify-between text-[11px] uppercase font-mono tracking-wider text-[#A7A9AF] font-medium">
          <div className="flex items-center gap-1.5">
            {icon}
            <span>{title}</span>
          </div>
          <span className="text-[10px] text-[#A7A9AF]/60">({items.length})</span>
        </div>
        <div className="space-y-1">
          {items.map(renderSessionItem)}
        </div>
      </div>
    );
  };

  return (
    <div className={`flex flex-col h-full ${compact ? 'p-1' : 'p-2.5'} space-y-2 select-none`}>
      {/* ── Slim New Session Pill ── */}
      <button
        type="button"
        onClick={handleCreateNew}
        className="w-full py-2 px-3 rounded-full bg-[#202126] hover:bg-[#2A2C33] active:scale-[0.98] border border-white/[0.08] hover:border-white/[0.14] text-white font-medium text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm group"
      >
        <Plus size={14} strokeWidth={2.5} className="text-[#A78BFA] group-hover:rotate-90 transition-transform duration-200" />
        <span className="tracking-tight font-sans">New Session</span>
      </button>

      {/* ── Slim Search chats Pill ── */}
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A7A9AF]/60 pointer-events-none" />
        <input
          type="text"
          value={sessionSearchQuery}
          onChange={(e) => setSessionSearchQuery(e.target.value)}
          placeholder="Search chats..."
          className="w-full pl-8 pr-7 py-1.5 rounded-full bg-[#11131C] border border-[#2A2C33] text-xs text-[#F2F2F2] placeholder-[#A7A9AF]/45 focus:outline-none focus:border-[#A78BFA]/60 transition font-sans shadow-inner"
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
          <div className="py-6 text-center text-xs text-[#A7A9AF]/60 font-sans">
            Loading sessions...
          </div>
        ) : (
          <>
            {renderSection('Pinned', grouped.pinned, <Pin size={11} className="text-amber-400" />)}
            {renderSection('Today', grouped.today, <Clock size={11} className="text-[#A78BFA]" />)}
            {renderSection('Previous 7 Days', grouped.previous7Days)}
            {renderSection('Older', grouped.older)}

            {/* Archived Toggle & Section */}
            <div className="pt-2 border-t border-[#2A2C33]">
              <button
                type="button"
                onClick={() => setShowArchived(!showArchived)}
                className="w-full flex items-center justify-between px-2 py-1 text-[11px] font-mono uppercase tracking-wider text-[#A7A9AF] hover:text-[#F2F2F2] transition"
              >
                <div className="flex items-center gap-1.5">
                  <Archive size={11} />
                  <span>Archived Chats</span>
                </div>
                <span className="text-[10px] text-[#A7A9AF]/60">{grouped.archived.length}</span>
              </button>

              {showArchived && (
                <div className="space-y-1 mt-1.5">
                  {grouped.archived.length === 0 ? (
                    <p className="px-2 py-2 text-[11px] text-[#A7A9AF]/50 italic font-sans">
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
