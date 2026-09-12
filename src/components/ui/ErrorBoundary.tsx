import React, { Component, ErrorInfo, ReactNode } from 'react';
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
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a0f] p-6 z-50 text-center">
          <div className="max-w-md bg-[#111113] border border-rose-500/30 rounded-2xl p-6 shadow-2xl">
            <AlertCircle size={32} strokeWidth={1.5} className="text-rose-400 mb-3 mx-auto" />
            <h2 className="text-lg font-semibold text-[#F5F5F7] mb-2">3D Scene Error</h2>
            <p className="text-xs text-[#9898A3] mb-4">
              {this.state.error?.message || 'An error occurred while loading the 3D character scene.'}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
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
