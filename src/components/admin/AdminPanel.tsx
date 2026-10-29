/**
 * AdminPanel — Full control center accessible only via authenticated admin access.
 * 
 * Protected by signed session tokens (HMAC-SHA256) and brute-force rate limits.
 * Shows: API keys, provider health, analytics, memory, Supabase config, tools.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, Key, BarChart3, Database, Cpu, Wrench, RefreshCw, 
  CheckCircle, XCircle, Eye, EyeOff, Save, Trash2, Activity,
  Server, Zap, Brain, Settings, LogOut, Copy, Check, AlertTriangle, Lock
} from 'lucide-react';

const API = '/api/admin';

function getStoredToken(): string {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem('admin_session_token') || '';
}

function setStoredToken(token: string): void {
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('admin_session_token', token);
  }
}

function clearStoredToken(): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('admin_session_token');
    localStorage.removeItem('admin_secret');
  }
}

async function adminFetch(path: string, opts?: RequestInit) {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { ...headers, ...(opts?.headers || {}) }
  });
  if (res.status === 401) {
    clearStoredToken();
    throw new Error('401 Unauthorized');
  }
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatusDot({ active }: { active: boolean }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${active ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-red-500/60'}`} />
  );
}

function KeyField({ label, masked, provider, onSave }: { 
  label: string; masked: string | null; provider: string;
  onSave: (provider: string, key: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!val.trim()) return;
    setSaving(true);
    try {
      await onSave(provider, val.trim());
      setSaved(true);
      setVal('');
      setEditing(false);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[#A7A9AF]">{label}</span>
        <div className="flex items-center gap-2">
          {masked ? (
            <span className="text-xs font-mono text-[#6E8BFF] bg-[#6E8BFF]/10 px-2 py-0.5 rounded">{masked}</span>
          ) : (
            <span className="text-xs text-red-400">Not configured</span>
          )}
          <StatusDot active={!!masked} />
        </div>
      </div>
      {editing ? (
        <div className="flex gap-2">
          <input
            type="password"
            value={val}
            onChange={e => setVal(e.target.value)}
            placeholder="Enter new key..."
            className="flex-1 bg-[#0B0D12] border border-[#2A2C33] rounded-lg px-3 py-1.5 text-xs text-[#F2F2F2] focus:outline-none focus:border-[#6E8BFF]/60 font-mono"
          />
          <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 bg-[#6E8BFF] hover:bg-[#7B9BFF] rounded-lg text-xs font-medium text-white transition flex items-center gap-1.5 disabled:opacity-50">
            {saved ? <Check size={12} /> : saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
            {saved ? 'Saved' : 'Save'}
          </button>
          <button onClick={() => setEditing(false)} className="px-2 py-1.5 rounded-lg text-xs text-[#A7A9AF] hover:text-[#F2F2F2] hover:bg-white/5 transition">
            Cancel
          </button>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="text-left text-xs text-[#6E8BFF] hover:text-[#7B9BFF] transition w-fit">
          + Update Key
        </button>
      )}
    </div>
  );
}

// ── Admin Login Screen ───────────────────────────────────────────────────────

interface AdminPanelProps {
  onBack?: () => void;
}

function AdminLoginScreen({
  onAuthenticated,
  onBack
}: {
  onAuthenticated: (token: string) => void;
  onBack?: () => void;
}) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.trim() })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Invalid credentials');
      }

      setStoredToken(data.token);
      onAuthenticated(data.token);
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please check your admin secret.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#07090E] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#0F1117] border border-white/[0.08] rounded-2xl p-8 shadow-2xl shadow-black/80 relative overflow-hidden">
        {/* Subtle decorative gradient */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />
        
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-3">
            <Shield size={24} />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">Aura Studio Admin</h1>
          <p className="text-xs text-[#8A8F98] mt-1">Restricted management console. Authenticate to proceed.</p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-red-400 text-xs">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-[#8A8F98] block mb-1.5">Admin Secret Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter ADMIN_SECRET..."
                required
                className="w-full bg-[#07090E] border border-white/[0.08] focus:border-indigo-500/60 rounded-xl px-4 py-2.5 pr-10 text-sm text-white placeholder-white/20 focus:outline-none transition font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 transition"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !password.trim()}
            className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
          >
            {loading ? <RefreshCw size={15} className="animate-spin" /> : <Lock size={15} />}
            <span>{loading ? 'Authenticating...' : 'Unlock Admin Console'}</span>
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-white/[0.06] text-center">
          <button
            type="button"
            onClick={() => {
              if (onBack) {
                onBack();
              } else if (typeof window !== 'undefined') {
                window.location.href = '/';
              }
            }}
            className="text-xs text-[#8A8F98] hover:text-white transition"
          >
            ← Return to Main Application
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main AdminPanel Component ───────────────────────────────────────────────

export default function AdminPanel({ onBack }: AdminPanelProps = {}) {
  const [token, setToken] = useState<string>(() => getStoredToken());
  const [verifying, setVerifying] = useState<boolean>(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<'dashboard' | 'keys' | 'analytics' | 'memory' | 'tools' | 'database'>('dashboard');
  const [dashboard, setDashboard] = useState<any>(null);
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [keys, setKeys] = useState<any>(null);
  const [memory, setMemory] = useState<any>(null);
  const [tools, setTools] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);

  // Clean URL to prevent query parameter key leakage
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  // Verify stored session token on load
  useEffect(() => {
    const verifyToken = async () => {
      const currentToken = getStoredToken();
      if (!currentToken) {
        setIsAuthenticated(false);
        setVerifying(false);
        return;
      }

      try {
        const res = await fetch(`${API}/verify`, {
          headers: { Authorization: `Bearer ${currentToken}` }
        });
        if (res.ok) {
          setIsAuthenticated(true);
        } else {
          clearStoredToken();
          setIsAuthenticated(false);
        }
      } catch {
        setIsAuthenticated(false);
      } finally {
        setVerifying(false);
      }
    };

    verifyToken();
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadDashboard = useCallback(async () => {
    try {
      const data = await adminFetch('/dashboard');
      setDashboard(data);
    } catch (err: any) {
      if (err.message.includes('401')) {
        setIsAuthenticated(false);
      }
    }
  }, []);

  const loadKeys = useCallback(async () => {
    try {
      const data = await adminFetch('/keys');
      setKeys(data);
    } catch {}
  }, []);

  const loadAnalytics = useCallback(async () => {
    try {
      const data = await adminFetch('/analytics');
      setAnalyticsData(data);
    } catch {}
  }, []);

  const loadMemory = useCallback(async () => {
    try {
      const data = await adminFetch('/memory');
      setMemory(data);
    } catch {}
  }, []);

  const loadTools = useCallback(async () => {
    try {
      const data = await adminFetch('/tools');
      setTools(data);
    } catch {}
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (activeTab === 'dashboard') loadDashboard();
    if (activeTab === 'keys') loadKeys();
    if (activeTab === 'analytics') loadAnalytics();
    if (activeTab === 'memory') loadMemory();
    if (activeTab === 'tools') loadTools();
    if (activeTab === 'database') loadDashboard();
  }, [activeTab, isAuthenticated, loadDashboard, loadKeys, loadAnalytics, loadMemory, loadTools]);

  const handleSaveKey = async (provider: string, apiKey: string) => {
    try {
      await adminFetch('/keys', { method: 'POST', body: JSON.stringify({ provider, apiKey }) });
      showToast(`${provider.toUpperCase()} key updated securely`);
      loadKeys();
    } catch (e: any) {
      showToast(`Error: ${e.message}`);
    }
  };

  const handleClearMemory = async () => {
    if (!confirm('Are you sure you want to clear all memory and conversation history?')) return;
    try {
      await adminFetch('/memory', { method: 'DELETE' });
      showToast('All memory cleared');
      loadMemory();
    } catch (e: any) {
      showToast(`Error: ${e.message}`);
    }
  };

  const handleLogout = () => {
    clearStoredToken();
    setToken('');
    setIsAuthenticated(false);
  };

  if (verifying) {
    return (
      <div className="min-h-screen bg-[#07090E] flex items-center justify-center">
        <div className="text-indigo-400 text-sm animate-pulse flex items-center gap-2">
          <RefreshCw size={16} className="animate-spin" />
          <span>Verifying admin authorization...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <AdminLoginScreen
        onAuthenticated={(newToken) => {
          setToken(newToken);
          setIsAuthenticated(true);
        }}
        onBack={onBack}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#07090E] text-[#F2F2F2] flex flex-col font-sans">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-indigo-600/90 backdrop-blur border border-indigo-400/30 text-white text-xs px-4 py-2.5 rounded-xl shadow-xl animate-fade-in flex items-center gap-2">
          <CheckCircle size={14} />
          {toast}
        </div>
      )}

      {/* Top Bar */}
      <header className="border-b border-white/[0.06] bg-[#0F1117] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Shield size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-white tracking-tight">Aura Studio Admin</h1>
              <span className="text-[10px] font-mono bg-indigo-500/15 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/20">
                Authenticated
              </span>
            </div>
            <p className="text-[11px] text-[#8A8F98]">Protected by token session and rate-limiting safeguards</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (activeTab === 'dashboard') loadDashboard();
              if (activeTab === 'keys') loadKeys();
              if (activeTab === 'analytics') loadAnalytics();
              if (activeTab === 'memory') loadMemory();
              if (activeTab === 'tools') loadTools();
            }}
            className="p-2 rounded-xl text-[#8A8F98] hover:text-white hover:bg-white/[0.04] transition"
            title="Refresh"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 transition"
          >
            <LogOut size={13} />
            <span>Sign Out</span>
          </button>
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[#8A8F98] hover:text-white hover:bg-white/[0.04] border border-white/[0.08] transition"
            >
              <span>Exit to App</span>
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Nav */}
        <aside className="w-56 border-r border-white/[0.06] bg-[#0A0C11] p-3 flex flex-col gap-1 shrink-0">
          {[
            { id: 'dashboard', label: 'Overview', icon: BarChart3 },
            { id: 'keys', label: 'API Keys', icon: Key },
            { id: 'analytics', label: 'Analytics', icon: Activity },
            { id: 'memory', label: 'Memory', icon: Brain },
            { id: 'tools', label: 'Tools', icon: Wrench },
            { id: 'database', label: 'Database', icon: Database },
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition text-left ${
                  active
                    ? 'bg-indigo-600/15 text-indigo-400 border border-indigo-500/25'
                    : 'text-[#8A8F98] hover:text-white hover:bg-white/[0.03]'
                }`}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-6">
          {/* ── Overview ── */}
          {activeTab === 'dashboard' && dashboard && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-[#10131B] border border-white/[0.06] rounded-2xl p-4">
                  <div className="flex items-center justify-between text-[#8A8F98] mb-2">
                    <span className="text-xs">System Status</span>
                    <Server size={14} />
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusDot active={dashboard.system?.status === 'healthy'} />
                    <span className="text-base font-semibold text-white capitalize">{dashboard.system?.status || 'Unknown'}</span>
                  </div>
                  <p className="text-[11px] text-[#8A8F98] mt-1 font-mono">{dashboard.system?.platform} • {dashboard.system?.nodeVersion}</p>
                </div>

                <div className="bg-[#10131B] border border-white/[0.06] rounded-2xl p-4">
                  <div className="flex items-center justify-between text-[#8A8F98] mb-2">
                    <span className="text-xs">Active AI Model</span>
                    <Brain size={14} />
                  </div>
                  <p className="text-sm font-semibold text-white truncate">{dashboard.providers?.active || 'gemini'}</p>
                  <p className="text-[11px] text-indigo-400 mt-1 truncate">{dashboard.providers?.modelInfo?.name}</p>
                </div>

                <div className="bg-[#10131B] border border-white/[0.06] rounded-2xl p-4">
                  <div className="flex items-center justify-between text-[#8A8F98] mb-2">
                    <span className="text-xs">Tools Active</span>
                    <Wrench size={14} />
                  </div>
                  <p className="text-lg font-semibold text-white">{dashboard.tools?.registered ?? 0}</p>
                  <p className="text-[11px] text-[#8A8F98] mt-1">Permission-guarded execution</p>
                </div>

                <div className="bg-[#10131B] border border-white/[0.06] rounded-2xl p-4">
                  <div className="flex items-center justify-between text-[#8A8F98] mb-2">
                    <span className="text-xs">Supabase DB</span>
                    <Database size={14} />
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusDot active={dashboard.database?.supabase?.configured} />
                    <span className="text-sm font-semibold text-white">
                      {dashboard.database?.supabase?.configured ? 'Connected' : 'Offline'}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#8A8F98] mt-1 font-mono truncate">{dashboard.database?.supabase?.url || 'Local storage active'}</p>
                </div>
              </div>

              {/* Key Status Overview */}
              <div className="bg-[#10131B] border border-white/[0.06] rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-white mb-4">API Service Keys</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {Object.entries(dashboard.keyStatus || {}).map(([service, configured]) => (
                    <div key={service} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                      <span className="text-xs uppercase font-medium text-[#8A8F98]">{service}</span>
                      <div className="flex items-center gap-1.5">
                        <StatusDot active={Boolean(configured)} />
                        <span className="text-xs text-white/70">{configured ? 'Configured' : 'Missing'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── API Keys ── */}
          {activeTab === 'keys' && (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h2 className="text-base font-semibold text-white">API Credentials & Keys</h2>
                <p className="text-xs text-[#8A8F98] mt-1">
                  Sensitive keys are masked and stored securely in backend server environment variables.
                </p>
              </div>

              {keys ? (
                <div className="bg-[#10131B] border border-white/[0.06] rounded-2xl p-5 space-y-4">
                  <KeyField label="Google Gemini API Key" masked={keys.gemini?.masked} provider="gemini" onSave={handleSaveKey} />
                  <KeyField label="xAI Grok API Key" masked={keys.grok?.masked} provider="grok" onSave={handleSaveKey} />
                  <KeyField label="ElevenLabs API Key" masked={keys.elevenlabs?.masked} provider="elevenlabs" onSave={handleSaveKey} />
                  <KeyField label="Admin Secret Password" masked={keys.adminSecret?.masked} provider="admin" onSave={handleSaveKey} />
                </div>
              ) : (
                <div className="text-center py-10 text-[#8A8F98] text-sm flex items-center justify-center gap-2">
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Loading API keys...</span>
                </div>
              )}
            </div>
          )}

          {/* ── Analytics ── */}
          {activeTab === 'analytics' && analyticsData && (
            <div className="space-y-6">
              <h2 className="text-base font-semibold text-white">Runtime Analytics</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-[#10131B] border border-white/[0.06] rounded-2xl p-4">
                  <span className="text-xs text-[#8A8F98]">Total Requests</span>
                  <p className="text-2xl font-bold text-white mt-1">{analyticsData.totalRequests || 0}</p>
                </div>
                <div className="bg-[#10131B] border border-white/[0.06] rounded-2xl p-4">
                  <span className="text-xs text-[#8A8F98]">Avg Response Latency</span>
                  <p className="text-2xl font-bold text-white mt-1">{analyticsData.avgResponseTimeMs || 0} ms</p>
                </div>
                <div className="bg-[#10131B] border border-white/[0.06] rounded-2xl p-4">
                  <span className="text-xs text-[#8A8F98]">Error Rate</span>
                  <p className="text-2xl font-bold text-emerald-400 mt-1">{analyticsData.errorRate || '0%'}</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Memory ── */}
          {activeTab === 'memory' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">Persistent Agent Memory</h2>
                  <p className="text-xs text-[#8A8F98] mt-1">Context stored across sessions</p>
                </div>
                <button
                  onClick={handleClearMemory}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-red-400 hover:bg-red-500/10 border border-red-500/20 transition"
                >
                  <Trash2 size={12} /> Clear Context
                </button>
              </div>

              {memory && (
                <div className="space-y-4">
                  <div className="bg-[#10131B] border border-white/[0.06] rounded-2xl p-5">
                    <h3 className="text-xs font-semibold text-white uppercase tracking-wider mb-3">
                      Stored Memories ({memory.memories?.length || 0})
                    </h3>
                    {memory.memories?.length ? (
                      <div className="space-y-2">
                        {memory.memories.map((m: any) => (
                          <div key={m.id} className="flex items-start justify-between py-2 border-b border-white/[0.04] last:border-0">
                            <div>
                              <p className="text-xs font-medium text-indigo-400">{m.key}</p>
                              <p className="text-xs text-[#8A8F98] mt-0.5">{m.value}</p>
                            </div>
                            <span className="text-[10px] text-white/40 font-mono">{m.category}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-[#8A8F98]">No memories stored yet.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Tools ── */}
          {activeTab === 'tools' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold text-white">Registered Tools & Sandboxes ({tools?.total || 0})</h2>
                <p className="text-xs text-[#8A8F98] mt-1">Filesystem, OS, web search, and productivity capability suite</p>
              </div>
              {tools?.tools && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {tools.tools.map((tool: any) => (
                    <div key={tool.name} className="bg-[#10131B] border border-white/[0.06] rounded-xl p-4">
                      <div className="flex items-start justify-between mb-2">
                        <span className="text-sm font-medium text-white font-mono">{tool.name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                          tool.permission === 'READ_ONLY' ? 'bg-emerald-500/15 text-emerald-400'
                          : tool.permission === 'SAFE_WRITE' ? 'bg-indigo-500/15 text-indigo-400'
                          : tool.permission === 'DESTRUCTIVE' ? 'bg-red-500/15 text-red-400'
                          : 'bg-amber-500/15 text-amber-400'
                        }`}>{tool.permission}</span>
                      </div>
                      <p className="text-xs text-[#8A8F98] leading-relaxed">{tool.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Database ── */}
          {activeTab === 'database' && dashboard && (
            <div className="space-y-6 max-w-xl">
              <div>
                <h2 className="text-base font-semibold text-white">Database Configuration</h2>
                <p className="text-xs text-[#8A8F98] mt-1">Manage cloud synchronization credentials</p>
              </div>

              <div className="bg-[#10131B] border border-white/[0.06] rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <StatusDot active={dashboard.database?.supabase?.configured} />
                  <h3 className="text-sm font-semibold text-white">Supabase Cloud Sync</h3>
                  {dashboard.database?.supabase?.configured && (
                    <span className="text-xs text-emerald-400 font-mono ml-auto">{dashboard.database.supabase.url}</span>
                  )}
                </div>

                <SupabaseConfig onSave={async (url, key) => {
                  await adminFetch('/supabase', { method: 'POST', body: JSON.stringify({ url, key }) });
                  showToast('Supabase settings updated');
                  loadDashboard();
                }} />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function SupabaseConfig({ onSave }: { onSave: (url: string, key: string) => Promise<void> }) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const handleSave = async () => {
    if (!url.trim() || !key.trim()) return;
    setSaving(true);
    try {
      await onSave(url.trim(), key.trim());
      setUrl('');
      setKey('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-[#8A8F98] mb-1 block">Supabase Project URL</label>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://xxxx.supabase.co"
          className="w-full bg-[#07090E] border border-white/[0.08] focus:border-indigo-500/60 rounded-xl px-3 py-2 text-xs text-white focus:outline-none font-mono"
        />
      </div>
      <div>
        <label className="text-xs text-[#8A8F98] mb-1 block">Secret Service Role / Anon Key</label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="eyJh..."
            className="w-full bg-[#07090E] border border-white/[0.08] focus:border-indigo-500/60 rounded-xl px-3 py-2 pr-9 text-xs text-white focus:outline-none font-mono"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !url.trim() || !key.trim()}
        className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl text-xs font-semibold text-white transition shadow-lg shadow-indigo-600/20"
      >
        {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
        {saving ? 'Connecting...' : 'Save & Connect'}
      </button>
    </div>
  );
}
