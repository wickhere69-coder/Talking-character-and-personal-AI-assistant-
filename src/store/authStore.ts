import { create } from 'zustand';
import { AuthUser } from '@/types/auth';
import { fetchAuthConfig, fetchCurrentUser, logoutSession } from '@/services/authService';
import { auraController } from '@/services/auraConversationController';

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isCheckingSession: boolean;
  googleClientId: string | null;
  googleConfigured: boolean;

  checkSession: () => Promise<void>;
  setAuthenticatedUser: (user: AuthUser) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isCheckingSession: true,
  googleClientId: null,
  googleConfigured: false,

  checkSession: async () => {
    set({ isCheckingSession: true });
    try {
      const [config, me] = await Promise.all([
        fetchAuthConfig(),
        fetchCurrentUser(),
      ]);
      set({
        googleClientId: config.googleClientId,
        googleConfigured: config.googleConfigured,
        user: me?.user ?? null,
        isAuthenticated: Boolean(me?.user),
        isCheckingSession: false,
      });
    } catch {
      set({
        user: null,
        isAuthenticated: false,
        isCheckingSession: false,
      });
    }
  },

  setAuthenticatedUser: (user: AuthUser) => {
    set({
      user,
      isAuthenticated: true,
      isCheckingSession: false,
    });
  },

  logout: async () => {
    try {
      auraController.stopConversation();
    } catch {}
    await logoutSession();
    set({
      user: null,
      isAuthenticated: false,
      isCheckingSession: false,
    });
  },
}));
