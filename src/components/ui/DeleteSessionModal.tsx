import React, { useState } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { Trash2, AlertTriangle, X } from 'lucide-react';
import { BUTTONS } from './designSystem';

export default function DeleteSessionModal() {
  const { deletingSession, setDeletingSession, confirmDeleteSession } = useSessionStore();
  const [isDeleting, setIsDeleting] = useState(false);

  if (!deletingSession) return null;

  const handleDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await confirmDeleteSession(deletingSession.id);
    } finally {
      setIsDeleting(false);
      setDeletingSession(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in pointer-events-auto">
      <div 
        className="relative w-full max-w-md bg-[#14161E]/95 border border-[#23252F] rounded-[24px] p-6 shadow-2xl overflow-hidden pointer-events-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-session-title"
      >
        {/* Subtle red warning hairline */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-rose-500/80 to-transparent" />

        <div className="flex items-start justify-between gap-4">
          <div className="w-10 h-10 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
            <AlertTriangle size={20} strokeWidth={2} />
          </div>

          <button
            type="button"
            onClick={() => setDeletingSession(null)}
            className="w-8 h-8 rounded-full bg-[#1A1D27] hover:bg-[#202431] text-[#7A7D86] hover:text-[#F2F2F2] flex items-center justify-center transition active:scale-95 border border-[#23252F] cursor-pointer"
            title="Cancel"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          <h3 id="delete-session-title" className="text-base font-semibold text-[#F2F2F2] font-sans">
            Delete Archival Session?
          </h3>
          <p className="text-xs text-[#7A7D86] leading-relaxed font-sans">
            Are you sure you want to delete <span className="text-[#F2F2F2] font-medium">"{deletingSession.title}"</span>? All messages, transcripts, and contextual memories in this session will be permanently removed.
          </p>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-[#23252F]">
          <button
            type="button"
            onClick={() => setDeletingSession(null)}
            className={`px-4 py-2 ${BUTTONS.secondary} text-xs font-medium cursor-pointer`}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="px-4 py-2 rounded-full bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 text-xs font-semibold transition active:scale-95 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            <Trash2 size={13} strokeWidth={2} />
            <span>{isDeleting ? 'Deleting...' : 'Delete Session'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
