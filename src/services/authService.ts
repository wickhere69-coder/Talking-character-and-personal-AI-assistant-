import { AuthConfig, AuthResponse, LoginPayload, RegisterPayload } from '@/types/auth';

async function parseJsonOrThrow<T>(res: Response, fallbackMsg: string): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data?.detail === 'string'
      ? data.detail
      : typeof data?.error === 'string'
      ? data.error
      : fallbackMsg;
    throw new Error(detail);
  }
  return data as T;
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch('/api/auth/config', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      const envClientId = ((import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '').trim() || null;
      const clientId = data.googleClientId || envClientId;
      return {
        googleClientId: clientId,
        googleConfigured: Boolean(clientId),
      };
    }
  } catch {
    // Fall back to Vite public env if backend temporarily unreachable
  }
  const envClientId = ((import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '').trim() || null;
  return {
    googleClientId: envClientId,
    googleConfigured: Boolean(envClientId),
  };
}

export async function fetchCurrentUser(): Promise<AuthResponse | null> {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function loginWithPassword(payload: LoginPayload): Promise<AuthResponse> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<AuthResponse>(res, 'Unable to sign in. Please check your credentials.');
}

export async function registerWithPassword(payload: RegisterPayload): Promise<AuthResponse> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<AuthResponse>(res, 'Unable to create your account.');
}

export async function loginWithGoogleCredential(credential: string, rememberMe = true): Promise<AuthResponse> {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ credential, rememberMe }),
  });
  return parseJsonOrThrow<AuthResponse>(res, 'Google sign-in failed.');
}

export async function requestPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch('/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email }),
  });
  return parseJsonOrThrow(res, 'Could not process password recovery request.');
}

export async function logoutSession(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // Best-effort server logout
  }
}
