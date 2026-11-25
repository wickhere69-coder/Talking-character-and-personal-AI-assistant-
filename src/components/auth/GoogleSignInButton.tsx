import React, { useEffect, useRef, useState } from 'react';

interface GoogleAccountsId {
  initialize: (config: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
    ux_mode?: 'popup' | 'redirect';
    use_fedcm_for_prompt?: boolean;
  }) => void;
  renderButton: (
    parent: HTMLElement,
    options: {
      theme?: 'outline' | 'filled_blue' | 'filled_black';
      size?: 'large' | 'medium' | 'small';
      width?: number;
      text?: 'signin_with' | 'signup_with' | 'continue_with';
      shape?: 'pill' | 'rectangular';
    }
  ) => void;
  prompt: (cb?: (notification: any) => void) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: GoogleAccountsId;
      };
    };
  }
}

let gsiLoadPromise: Promise<void> | null = null;

function loadGoogleGsiScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Window unavailable'));
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gsiLoadPromise) return gsiLoadPromise;

  gsiLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      if (window.google?.accounts?.id) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => {
        gsiLoadPromise = null;
        reject(new Error('Failed to load Google Sign-In SDK.'));
      }, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gsiLoadPromise = null;
      reject(new Error('Failed to load Google Sign-In SDK.'));
    };
    document.head.appendChild(script);
  });

  return gsiLoadPromise;
}

interface GoogleSignInButtonProps {
  clientId: string | null;
  disabled?: boolean;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}

export default function GoogleSignInButton({
  clientId,
  disabled = false,
  onCredential,
  onError,
}: GoogleSignInButtonProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onCredential);
  const onErrorRef = useRef(onError);
  const [gsiReady, setGsiReady] = useState(false);

  callbackRef.current = onCredential;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!clientId) {
      setGsiReady(false);
      return;
    }

    let cancelled = false;
    loadGoogleGsiScript()
      .then(() => {
        if (cancelled) return;
        const gsi = window.google?.accounts?.id;
        if (!gsi || !overlayRef.current) return;

        gsi.initialize({
          client_id: clientId,
          callback: (resp) => {
            if (resp?.credential) {
              callbackRef.current(resp.credential);
            } else {
              onErrorRef.current('Google Sign-In did not return a credential.');
            }
          },
          ux_mode: 'popup',
          use_fedcm_for_prompt: true,
        });

        overlayRef.current.innerHTML = '';
        gsi.renderButton(overlayRef.current, {
          theme: 'outline',
          size: 'large',
          width: 400,
          text: 'continue_with',
          shape: 'pill',
        });
        setGsiReady(true);
      })
      .catch((err) => {
        if (!cancelled) {
          setGsiReady(false);
          onErrorRef.current(err?.message || 'Unable to load Google Sign-In.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const handleFallbackClick = () => {
    if (disabled) return;
    if (!clientId) {
      onError('Google Sign-In requires GOOGLE_CLIENT_ID in your .env file. Add your Google Web Client ID and restart the backend, or sign in with email & password.');
      return;
    }

    const gsi = window.google?.accounts?.id;
    if (gsi) {
      gsi.prompt((notification: any) => {
        if (notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.()) {
          const reason = notification?.getNotDisplayedReason?.() || notification?.getSkippedReason?.() || '';
          onErrorRef.current(
            reason
              ? `Google prompt unavailable (${reason}). Click directly on Continue with Google or confirm ${window.location.origin} is added in Google Cloud Console Authorized JavaScript origins.`
              : `Confirm ${window.location.origin} is added in Google Cloud Console Authorized JavaScript origins and popups are allowed.`
          );
        }
      });
    } else {
      onErrorRef.current('Google Sign-In is still initializing. Please try again in a moment.');
    }
  };

  return (
    <div className="relative w-full h-[42px] xl:h-[48px] overflow-hidden rounded-full">
      <button
        type="button"
        disabled={disabled}
        onClick={handleFallbackClick}
        className="w-full h-full rounded-full bg-white hover:bg-[#f8f5ef] border border-[#e5ddd0] text-[#111111] font-semibold text-[13.5px] xl:text-[14px] flex items-center justify-center gap-2.5 shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[#7a5cff] focus-visible:outline-offset-2"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
          <path
            fill="#4285F4"
            d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.3 0 6.08-1.09 8.11-2.96l-3.88-3.05c-1.08.72-2.46 1.16-4.23 1.16-3.26 0-6.02-2.2-7-5.16H1.01v3.14C3.05 21.2 7.24 24 12 24Z"
          />
          <path
            fill="#FBBC05"
            d="M5 13.99c-.25-.72-.39-1.49-.39-2.29s.14-1.57.39-2.29V6.27H1.01C.37 7.55 0 8.98 0 10.7c0 1.72.37 3.15 1.01 4.43l3.99-3.14Z"
          />
          <path
            fill="#EA4335"
            d="M12 4.75c1.79 0 3.4.62 4.67 1.82l3.5-3.5C18.07 1.19 15.3 0 12 0 7.24 0 3.05 2.8 1.01 6.87l3.99 3.14c.98-2.96 3.74-5.16 7-5.16Z"
          />
        </svg>
        <span>Continue with Google</span>
      </button>

      {/* Transparent GSI interactive overlay so clicks hit Google's trusted iframe directly */}
      {clientId && !disabled && (
        <div
          ref={overlayRef}
          aria-hidden="true"
          className={`absolute inset-0 flex items-center justify-center overflow-hidden rounded-[28px] transition-opacity ${
            gsiReady ? 'opacity-[0.01] pointer-events-auto cursor-pointer scale-x-[1.35] scale-y-[1.45]' : 'opacity-0 pointer-events-none'
          }`}
        />
      )}
    </div>
  );
}
