import React from 'react';
import { useAppStore } from '@/store/appStore';
import { TYPO, STATUS_DOTS } from './designSystem';
import { CheckCircle2, Loader2, Circle } from 'lucide-react';

export default function TaskActivityPanel() {
  const activeTaskSteps = useAppStore((state) => state.activeTaskSteps);

  if (!activeTaskSteps || activeTaskSteps.length === 0) return null;

  return (
    <div className="bg-[#131622] border border-[#2A2C33] rounded-[14px] p-3.5 space-y-2.5 transition-[transform,opacity] duration-150 ease-out">
      <div className="flex items-center justify-between">
        <span className={`${TYPO.label} flex items-center gap-1.5`}>
          <span className={STATUS_DOTS.hero} />
          Task Execution
        </span>
        <span className={TYPO.mono}>
          {activeTaskSteps.filter((s) => s.status === 'completed').length}/{activeTaskSteps.length}
        </span>
      </div>

      <div className="space-y-1.5">
        {activeTaskSteps.map((step, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            {step.status === 'completed' ? (
              <CheckCircle2 size={13} strokeWidth={1.5} className="text-emerald-400 shrink-0" />
            ) : step.status === 'in_progress' ? (
              <Loader2 size={13} strokeWidth={1.5} className="text-[#A78BFA] animate-spin shrink-0" />
            ) : (
              <Circle size={13} strokeWidth={1.5} className="text-white/30 shrink-0" />
            )}
            <span
              className={
                step.status === 'completed'
                  ? 'text-white/40 line-through'
                  : step.status === 'in_progress'
                  ? 'text-white font-medium'
                  : 'text-white/50'
              }
            >
              {step.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
