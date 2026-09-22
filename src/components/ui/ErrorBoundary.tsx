import React, { Component, ErrorInfo, ReactNode } from 'react';
import { TYPO, BUTTONS } from './designSystem';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#09090B] p-6 z-50 text-center">
          <div className="max-w-md w-full bg-[#0F0F12] border border-rose-500/20 rounded-2xl p-6 shadow-[0_24px_48px_rgba(0,0,0,0.7)] flex flex-col items-center">
            <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-3.5">
              <AlertCircle size={24} strokeWidth={1.5} className="text-rose-400" />
            </div>
            <h2 className={`${TYPO.title} mb-1.5`}>
              3D Scene Error
            </h2>
            <p className="text-[13px] text-white/70 leading-relaxed mb-5 max-w-sm">
              {this.state.error?.message || 'An error occurred while loading the 3D character scene.'}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className={`px-5 py-2.5 ${BUTTONS.primary} text-xs`}
            >
              Reload Scene
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
