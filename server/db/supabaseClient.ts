import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;
let currentUrl: string = process.env.SUPABASE_URL || '';
let currentKey: string = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

export function getSupabaseCredentials(): { url: string; key: string } {
  return {
    url: currentUrl || process.env.SUPABASE_URL || '',
    key: currentKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
  };
}

export function isSupabaseConfigured(): boolean {
  const { url, key } = getSupabaseCredentials();
  return Boolean(url && key && url.startsWith('http'));
}

export function initSupabaseClient(): SupabaseClient | null {
  const { url, key } = getSupabaseCredentials();
  if (!url || !key || !url.startsWith('http')) {
    supabaseInstance = null;
    return null;
  }

  try {
    supabaseInstance = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    return supabaseInstance;
  } catch (err: any) {
    console.warn('Failed to initialize Supabase client:', err.message);
    supabaseInstance = null;
    return null;
  }
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!supabaseInstance && isSupabaseConfigured()) {
    return initSupabaseClient();
  }
  return supabaseInstance;
}

export function updateSupabaseCredentials(url: string, key: string): SupabaseClient | null {
  currentUrl = (url || '').trim();
  currentKey = (key || '').trim();
  process.env.SUPABASE_URL = currentUrl;
  process.env.SUPABASE_ANON_KEY = currentKey;
  return initSupabaseClient();
}

/**
 * Validates connection to the Supabase project and checks database tables.
 */
export async function testSupabaseConnection(): Promise<{
  connected: boolean;
  message: string;
  url?: string;
  tables?: {
    memories: boolean;
    tasks: boolean;
    notes: boolean;
    reminders: boolean;
    conversations: boolean;
  };
  error?: string;
}> {
  const client = getSupabaseClient();
  const { url } = getSupabaseCredentials();
  if (!client) {
    return {
      connected: false,
      message: 'Supabase credentials not configured. Please supply your Supabase URL and Anon/Service Key in settings.'
    };
  }

  const tableStatus = {
    memories: false,
    tasks: false,
    notes: false,
    reminders: false,
    conversations: false
  };

  try {
    // 1. Basic ping / connection test by checking auth or a table
    const [memRes, taskRes, noteRes, remRes, convRes] = await Promise.allSettled([
      client.from('memories').select('id', { head: true, count: 'exact' }),
      client.from('tasks').select('id', { head: true, count: 'exact' }),
      client.from('notes').select('id', { head: true, count: 'exact' }),
      client.from('reminders').select('id', { head: true, count: 'exact' }),
      client.from('conversations').select('id', { head: true, count: 'exact' })
    ]);

    tableStatus.memories = memRes.status === 'fulfilled' && !memRes.value.error;
    tableStatus.tasks = taskRes.status === 'fulfilled' && !taskRes.value.error;
    tableStatus.notes = noteRes.status === 'fulfilled' && !noteRes.value.error;
    tableStatus.reminders = remRes.status === 'fulfilled' && !remRes.value.error;
    tableStatus.conversations = convRes.status === 'fulfilled' && !convRes.value.error;

    // Check if any error indicates invalid API key / bad URL
    const firstFulfilled = [memRes, taskRes, noteRes, remRes, convRes].find(r => r.status === 'fulfilled') as PromiseFulfilledResult<any> | undefined;
    if (firstFulfilled?.value?.error) {
      const err = firstFulfilled.value.error;
      // 401 or 403 means auth failure
      if (err.code === 'PGRST301' || err.message?.toLowerCase().includes('jwt') || err.message?.toLowerCase().includes('apikey')) {
        return {
          connected: false,
          url,
          message: `Supabase authentication error: ${err.message}`,
          tables: tableStatus,
          error: err.message
        };
      }
    }

    const anyTableFound = Object.values(tableStatus).some(Boolean);

    return {
      connected: true,
      url,
      message: anyTableFound
        ? 'Successfully connected to Supabase Database!'
        : 'Connected to Supabase project, but tables are not yet created. Run schema.sql in Supabase SQL Editor.',
      tables: tableStatus
    };
  } catch (err: any) {
    return {
      connected: false,
      url,
      message: `Failed to connect to Supabase: ${err.message}`,
      error: err.message
    };
  }
}
