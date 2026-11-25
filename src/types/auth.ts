export interface AuthUser {
  id: number;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  authProvider: 'password' | 'google' | string;
  createdAt?: number;
}

export interface AuthConfig {
  googleClientId: string | null;
  googleConfigured: boolean;
}

export interface AuthResponse {
  user: AuthUser;
  rememberMe?: boolean;
}

export interface LoginPayload {
  email: string;
  password: string;
  rememberMe: boolean;
}

export interface RegisterPayload {
  email: string;
  password: string;
  displayName?: string;
  rememberMe: boolean;
  termsAccepted: boolean;
}
