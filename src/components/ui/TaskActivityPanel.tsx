import React from 'react';
import { useAppStore } from '@/store/appStore';
import { CheckCircle2, Loader2, Circle } from 'lucide-react';

export default function TaskActivityPanel() {
  const activeTaskSteps = useAppStore((state) => state.activeTaskSteps);

  if (!activeTaskSteps || activeTaskSteps.length === 0) return null;

  return (
    <div className="bg-[#1A1A1F] border border-white/[0.06] rounded-xl p-3 space-y-2 transition-all">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-[#686873] uppercase tracking-wider flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.6)]" />
          Task Execution
        </span>
        <span className="text-[10px] text-cyan-400 font-mono">
          {activeTaskSteps.filter(s => s.status === 'completed').length}/{activeTaskSteps.length}
        </span>
      </div>

      <div className="space-y-1.5">
        {activeTaskSteps.map((step, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            {step.status === 'completed' ? (
              <CheckCircle2 size={13} strokeWidth={1.5} className="text-emerald-400 shrink-0" />
            ) : step.status === 'in_progress' ? (
              <Loader2 size={13} strokeWidth={1.5} className="text-cyan-400 animate-spin shrink-0" />
            ) : (
              <Circle size={13} strokeWidth={1.5} className="text-white/20 shrink-0" />
            )}
            <span className={step.status === 'completed' ? 'text-[#9898A3] line-through' : step.status === 'in_progress' ? 'text-cyan-300 font-medium' : 'text-[#686873]'}>
              {step.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
