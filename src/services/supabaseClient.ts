import { createClient, SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

export function getBrowserSupabaseClient(): SupabaseClient | null {
  if (browserClient) return browserClient;

  // Supabase interactions are routed through secure backend endpoints to prevent credential leakage.
  // This client only instantiates if a safe public anon key is explicitly configured.
  const metaEnv = (import.meta as any).env || {};
  const url = metaEnv.VITE_SUPABASE_URL || '';
  const key = metaEnv.VITE_SUPABASE_ANON_KEY || '';

  if (url && key && url.startsWith('http') && !key.startsWith('sb_secret')) {
    try {
      browserClient = createClient(url, key);
      return browserClient;
    } catch {
      return null;
    }
  }
  return null;
}

export interface SupabaseStatusResponse {
  isConfigured: boolean;
  url?: string;
  connection: {
    connected: boolean;
    message: string;
    tables?: {
      memories: boolean;
      tasks: boolean;
      notes: boolean;
      reminders: boolean;
      conversations: boolean;
    };
    error?: string;
  };
}

export async function fetchSupabaseStatus(): Promise<SupabaseStatusResponse> {
  const res = await fetch('/api/agent/supabase/status');
  if (!res.ok) {
    throw new Error(`Failed to fetch Supabase status (${res.status})`);
  }
  return await res.json();
}

export async function saveSupabaseConfig(url: string, key: string): Promise<any> {
  const res = await fetch('/api/agent/supabase/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: url.trim(), key: key.trim() })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to configure Supabase (${res.status})`);
  }

  // Clear any legacy sensitive keys from localStorage
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('supabase_anon_key');
      localStorage.setItem('supabase_url', url.trim());
    } catch { }
  }

  browserClient = null;
  return await res.json();
}

export async function triggerSupabaseSync(direction: 'push' | 'pull' | 'both' = 'both'): Promise<any> {
  const res = await fetch('/api/agent/supabase/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to sync with Supabase (${res.status})`);
  }
  return await res.json();
}
