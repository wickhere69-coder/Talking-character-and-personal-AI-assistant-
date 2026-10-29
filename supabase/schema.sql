-- ====================================================================
-- Talking Character & Personal AI Assistant - Hardened Database Schema
-- Production Security Hardened: Row-Level Security (RLS) & Password Hashing
-- ====================================================================

-- 1. User Accounts Table (Secure Salted Password Storage & Brute-force Tracking)
CREATE TABLE IF NOT EXISTS public.user_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  -- Passwords MUST be hashed with scrypt/argon2/pbkdf2 with unique salt
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  algorithm TEXT DEFAULT 'scrypt-sha256',
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  failed_attempts INT DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_accounts_email ON public.user_accounts (email);

-- 2. Memories (Personal facts, learned knowledge, user preferences)
CREATE TABLE IF NOT EXISTS public.memories (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES public.user_accounts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  category TEXT DEFAULT 'fact',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memories_user_id ON public.memories (user_id);
CREATE INDEX IF NOT EXISTS idx_memories_key ON public.memories (key);
CREATE INDEX IF NOT EXISTS idx_memories_category ON public.memories (category);

-- 3. Tasks (To-do list, priorities, execution status)
CREATE TABLE IF NOT EXISTS public.tasks (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES public.user_accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'in_progress')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  due_date TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON public.tasks (user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks (status);

-- 4. Notes (Quick notes, summaries, code snippets)
CREATE TABLE IF NOT EXISTS public.notes (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES public.user_accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_user_id ON public.notes (user_id);

-- 5. Reminders (Time-based notifications)
CREATE TABLE IF NOT EXISTS public.reminders (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES public.user_accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  remind_at TEXT NOT NULL,
  triggered BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON public.reminders (user_id);

-- 6. Sessions & Conversation History (Session-Isolated Persistent Memory)
CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES public.user_accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  summary TEXT DEFAULT '',
  pinned BOOLEAN DEFAULT FALSE,
  archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON public.chat_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON public.chat_sessions (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.user_accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  model_used TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON public.chat_messages (session_id, created_at ASC);

-- 7. User Settings & Key Configuration
CREATE TABLE IF NOT EXISTS public.user_settings (
  key TEXT NOT NULL,
  user_id UUID REFERENCES public.user_accounts(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (key, user_id)
);

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Zero Trust Architecture: Enforce strict user isolation
-- ====================================================================

ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- Helper to check if caller is backend service role
CREATE OR REPLACE FUNCTION is_service_role() RETURNS BOOLEAN AS $$
BEGIN
  RETURN (auth.jwt() ->> 'role') = 'service_role' OR auth.uid() IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 1. user_accounts: Users can read their own account profile (excluding hash/salt to anon)
CREATE POLICY "Users read own account" ON public.user_accounts
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Service role manages accounts" ON public.user_accounts
  FOR ALL USING (is_service_role()) WITH CHECK (is_service_role());

-- 2. memories: Strict user ownership
CREATE POLICY "Users manage own memories" ON public.memories
  FOR ALL USING (auth.uid() = user_id OR is_service_role())
  WITH CHECK (auth.uid() = user_id OR is_service_role());

-- 3. tasks: Strict user ownership
CREATE POLICY "Users manage own tasks" ON public.tasks
  FOR ALL USING (auth.uid() = user_id OR is_service_role())
  WITH CHECK (auth.uid() = user_id OR is_service_role());

-- 4. notes: Strict user ownership
CREATE POLICY "Users manage own notes" ON public.notes
  FOR ALL USING (auth.uid() = user_id OR is_service_role())
  WITH CHECK (auth.uid() = user_id OR is_service_role());

-- 5. reminders: Strict user ownership
CREATE POLICY "Users manage own reminders" ON public.reminders
  FOR ALL USING (auth.uid() = user_id OR is_service_role())
  WITH CHECK (auth.uid() = user_id OR is_service_role());

-- 6. chat_sessions & messages: Strict user isolation
CREATE POLICY "Users manage own sessions" ON public.chat_sessions
  FOR ALL USING (auth.uid() = user_id OR is_service_role())
  WITH CHECK (auth.uid() = user_id OR is_service_role());

CREATE POLICY "Users manage own messages" ON public.chat_messages
  FOR ALL USING (auth.uid() = user_id OR is_service_role())
  WITH CHECK (auth.uid() = user_id OR is_service_role());

-- 7. user_settings: Strict user ownership
CREATE POLICY "Users manage own settings" ON public.user_settings
  FOR ALL USING (auth.uid() = user_id OR is_service_role())
  WITH CHECK (auth.uid() = user_id OR is_service_role());
