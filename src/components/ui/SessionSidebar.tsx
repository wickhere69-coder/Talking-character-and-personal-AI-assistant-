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
        className={`group relative p-3 rounded-[16px] transition-all duration-150 cursor-pointer flex flex-col gap-1.5 active:scale-[0.99] select-none ${
          isActive
            ? 'bg-[#2A2350] border border-[#8B7CFF] shadow-[0_2px_12px_rgba(139,124,255,0.15)] text-[#FFFFFF]'
            : 'bg-[#1A1D27] hover:bg-[#202431] border border-[#2A2E3B] hover:border-[#8B7CFF]/40 text-[#C9CBD3]'
        }`}
      >
        {/* Left active violet indicator bar */}
        {isActive && (
          <div className="absolute left-0 top-3 bottom-3 w-1 bg-[#8B7CFF] rounded-r-full" />
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
                className="w-full bg-[#14161E] border border-[#8B7CFF] rounded-lg px-2 py-0.5 text-xs text-[#F2F2F2] focus:outline-none"
                autoFocus
              />
              <button
                type="button"
                onClick={(e) => handleSaveRename(e, session.id)}
                className="p-1 text-[#34D399] hover:text-[#FFFFFF]"
              >
                <Check size={12} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingId(null);
                }}
                className="p-1 text-[#7A7D86] hover:text-[#F2F2F2]"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 min-w-0">
                {session.pinned && <Pin size={11} className="text-[#8B7CFF] shrink-0" />}
                <span className={`text-[13px] font-semibold truncate ${isActive ? 'text-[#FFFFFF]' : 'text-[#F2F2F2]'}`}>
                  {session.title || 'Untitled Session'}
                </span>
              </div>

              {/* Action controls: direct trash + kebab menu */}
              <div className="relative shrink-0 flex items-center gap-1 z-10 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeletingSession(session);
                  }}
                  className={`p-1.5 rounded-lg text-[#7A7D86] hover:text-rose-400 hover:bg-rose-500/20 transition ${
                    isActive ? 'opacity-75' : 'opacity-0'
                  } group-hover:opacity-100 hover:!opacity-100 cursor-pointer active:scale-90`}
                  title="Delete session"
                >
                  <Trash2 size={14} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(isMenuOpen ? null : session.id);
                  }}
                  className={`p-1.5 rounded-lg text-[#7A7D86] hover:text-[#FFFFFF] transition ${
                    isMenuOpen ? '!opacity-100 text-[#FFFFFF] bg-[#232733]' : isActive ? 'opacity-75' : 'opacity-0'
                  } group-hover:opacity-100 hover:!opacity-100 cursor-pointer`}
                  title="More actions"
                >
                  <MoreVertical size={14} />
                </button>

                {isMenuOpen && (
                  <div className="absolute right-0 top-6 z-50 w-36 bg-[#14161E] border border-[#23252F] rounded-xl shadow-xl py-1 text-xs text-[#C9CBD3] flex flex-col">
                    <button
                      type="button"
                      onClick={(e) => handleStartRename(e, session)}
                      className="w-full px-3 py-1.5 text-left hover:bg-[#1A1D27] hover:text-[#FFFFFF] flex items-center gap-2"
                    >
                      <Edit2 size={12} />
                      <span>Rename</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePinSession(session.id);
                        setMenuOpenId(null);
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-[#1A1D27] hover:text-[#FFFFFF] flex items-center gap-2"
                    >
                      <Pin size={12} />
                      <span>{session.pinned ? 'Unpin' : 'Pin to top'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleArchiveSession(session.id);
                        setMenuOpenId(null);
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-[#1A1D27] hover:text-[#FFFFFF] flex items-center gap-2"
                    >
                      {session.archived ? (
                        <>
                          <ArchiveRestore size={12} />
                          <span>Unarchive</span>
                        </>
                      ) : (
                        <>
                          <Archive size={12} />
                          <span>Archive</span>
                        </>
                      )}
                    </button>
                    <div className="h-px bg-[#23252F] my-1" />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingSession(session);
                        setMenuOpenId(null);
                      }}
                      className="w-full px-3 py-1.5 text-left text-rose-400 hover:bg-rose-500/10 flex items-center gap-2"
                    >
                      <Trash2 size={12} />
                      <span>Delete</span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Subtitle preview snippet */}
        {!isEditing && (
          <p className="text-[12px] text-[#A7A9AF] truncate leading-tight">
            {session.summary || session.title}
          </p>
        )}

        {/* Message count & time row matching Figma "11 msgs" & "•••" */}
        {!isEditing && (
          <div className="flex items-center justify-between text-[11px] text-[#7A7D86] pt-0.5">
            <span>{session.messageCount || 0} msgs</span>
            <span>{new Date(session.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        )}
      </div>
    );
  };

  const renderSection = (title: string, items: ChatSession[], icon?: React.ReactNode) => {
    if (items.length === 0) return null;

    return (
      <div className="space-y-1.5 pt-1">
        <div className="px-1 py-0.5 flex items-center justify-between text-[11px] uppercase tracking-wider text-[#7A7D86] font-semibold">
          <div className="flex items-center gap-1.5">
            {icon}
            <span>{title}</span>
          </div>
          <span className="text-[10px] text-[#7A7D86]/70">({items.length})</span>
        </div>
        <div className="space-y-1.5">
          {items.map(renderSessionItem)}
        </div>
      </div>
    );
  };

  return (
    <div className={`flex flex-col h-full ${compact ? 'p-0' : 'p-2.5'} space-y-3 select-none font-sans`}>
      {/* ── Figma Frame 1:2: "+ New Session" button (Rectangle 248x42 at #232733) ── */}
      <button
        type="button"
        onClick={handleCreateNew}
        className="w-full h-[42px] px-4 rounded-[10px] bg-[#232733] hover:bg-[#2F3445] active:scale-[0.98] border border-[#2A2E3B] text-[#FFFFFF] font-semibold text-[14px] transition-all flex items-center justify-center gap-2 shadow-sm group"
      >
        <Plus size={15} strokeWidth={2.5} className="text-white group-hover:rotate-90 transition-transform duration-200" />
        <span className="tracking-tight">+ New Session</span>
      </button>

      {/* ── Scrollable Grouped Session List ── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2.5 pr-0.5">
        {isLoadingSessions ? (
          <div className="py-6 text-center text-xs text-[#7A7D86] font-sans">
            Loading sessions...
          </div>
        ) : (
          <>
            {renderSection('Pinned', grouped.pinned, <Pin size={11} className="text-[#8B7CFF]" />)}
            {renderSection('Today', grouped.today, <Clock size={11} className="text-[#8B7CFF]" />)}
            {renderSection('Previous 7 Days', grouped.previous7Days)}
            {renderSection('Older', grouped.older)}

            {/* Archived Toggle & Section */}
            <div className="pt-2 border-t border-[#23252F]">
              <button
                type="button"
                onClick={() => setShowArchived(!showArchived)}
                className="w-full flex items-center justify-between px-1 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#7A7D86] hover:text-[#FFFFFF] transition"
              >
                <div className="flex items-center gap-1.5">
                  <Archive size={11} />
                  <span>ARCHIVED CHATS</span>
                </div>
                <span className="text-[10px] text-[#7A7D86]">{grouped.archived.length}</span>
              </button>

              {showArchived && (
                <div className="space-y-1.5 mt-2">
                  {grouped.archived.length === 0 ? (
                    <p className="px-2 py-2 text-[11px] text-[#7A7D86] italic font-sans">
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
