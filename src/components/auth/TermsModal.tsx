import React, { useCallback, useRef } from 'react';
import { X, ShieldCheck } from 'lucide-react';
import { useModalDialog } from '@/hooks/useModalDialog';

interface TermsModalProps {
  open: boolean;
  onClose: () => void;
  onAccept: () => void;
}

export default function TermsModal({ open, onClose, onAccept }: TermsModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const handleDialogClose = useCallback(
    (value: string) => {
      if (value === 'accept') {
        onAccept();
      }
      onClose();
    },
    [onAccept, onClose]
  );

  useModalDialog(dialogRef, open, handleDialogClose);

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      aria-labelledby="terms-dialog-title"
      className="m-auto w-[min(92vw,560px)] max-h-[85vh] overflow-hidden rounded-[24px] border border-[#23252F] bg-[#14161E] p-0 text-[#F2F2F2] shadow-[0_32px_80px_rgba(0,0,0,0.9)]"
    >
      <div className="flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#23252F]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#8B7CFF]/15 border border-[#8B7CFF]/30 flex items-center justify-center text-[#8B7CFF]">
              <ShieldCheck size={16} />
            </div>
            <h1 id="terms-dialog-title" className="text-[17px] font-bold text-white tracking-tight">
              Terms &amp; Privacy Notice
            </h1>
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close('')}
            aria-label="Close Terms & Conditions"
            className="w-8 h-8 rounded-full bg-[#1A1D27] hover:bg-[#232733] border border-[#2A2E3B] flex items-center justify-center text-[#C9CBD3] hover:text-white cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar space-y-4 text-[13px] leading-relaxed text-[#C9CBD3]">
          <section className="space-y-1">
            <h2 className="text-[14px] font-semibold text-white">1. Aura AI Conversation &amp; Voice Data</h2>
            <p>
              Messages and voice transcripts you share with Aura are stored in your local workspace database to maintain
              conversation memory across sessions. Audio streams during live mode are processed solely to generate
              real-time spoken responses.
            </p>
          </section>

          <section className="space-y-1">
            <h2 className="text-[14px] font-semibold text-white">2. Account Security &amp; No Data Sale</h2>
            <p>
              Your email, profile details, and conversation history are never sold or shared with third-party advertisers.
              Passwords are stored using salted scrypt cryptographic digests, and active sign-in sessions are protected
              via HttpOnly cookies.
            </p>
          </section>

          <section className="space-y-1">
            <h2 className="text-[14px] font-semibold text-white">3. Google Sign-In &amp; Controls</h2>
            <p>
              When signing in with Google, Aura verifies your Google ID token server-side and accesses only your basic
              profile name, verified email address, and profile photo URL. You can sign out at any time, which
              immediately revokes your session token.
            </p>
          </section>

          <section className="space-y-1">
            <h2 className="text-[14px] font-semibold text-white">4. Eligibility &amp; Responsible Use</h2>
            <p>
              You confirm that you are at least 13 years old (or the minimum digital consent age in your jurisdiction)
              and will use Aura responsibly in accordance with applicable laws.
            </p>
          </section>
        </div>

        <form method="dialog" className="px-6 py-4 border-t border-[#23252F] bg-[#10121A] flex items-center justify-end gap-3">
          <button
            type="submit"
            value="cancel"
            className="px-4 py-2 rounded-full border border-[#2A2E3B] bg-[#1A1D27] hover:bg-[#232733] text-xs font-medium text-[#C9CBD3] hover:text-white cursor-pointer"
          >
            Close
          </button>
          <button
            type="submit"
            value="accept"
            className="px-5 py-2 rounded-full bg-[#8B7CFF] hover:bg-[#7b6bf6] text-xs font-semibold text-white shadow-[0_4px_14px_rgba(139,124,255,0.35)] cursor-pointer"
          >
            Accept Terms
          </button>
        </form>
      </div>
    </dialog>
  );
}
