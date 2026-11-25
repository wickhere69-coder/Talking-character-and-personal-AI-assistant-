import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2, X } from 'lucide-react';
import auraLoginBg from '@/assets/aura-login-bg.png';
import auraLoginOrb from '@/assets/aura-login-orb.svg';
import GoogleSignInButton from '@/components/auth/GoogleSignInButton';
import TermsModal from '@/components/auth/TermsModal';
import { useModalDialog } from '@/hooks/useModalDialog';
import {
  loginWithGoogleCredential,
  loginWithPassword,
  registerWithPassword,
  requestPasswordReset,
} from '@/services/authService';
import { useAuthStore } from '@/store/authStore';

export default function LoginPage() {
  const { googleClientId, setAuthenticatedUser } = useAuthStore();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; name?: string; terms?: string }>({});
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isTermsOpen, setIsTermsOpen] = useState(false);
  const [isForgotOpen, setIsForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [forgotSubmitting, setForgotSubmitting] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const termsRef = useRef<HTMLInputElement>(null);
  const forgotDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (isForgotOpen) {
      setForgotEmail(email.trim());
      setForgotMessage(null);
    }
  }, [isForgotOpen, email]);

  const handleForgotClose = useCallback(() => {
    setIsForgotOpen(false);
  }, []);

  useModalDialog(forgotDialogRef, isForgotOpen, handleForgotClose);

  const validateField = (field: 'email' | 'password' | 'name'): string | undefined => {
    if (field === 'email') {
      const clean = email.trim();
      if (!clean) return 'Email address is required.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return 'Enter a valid email address.';
    }
    if (field === 'password') {
      if (!password) return 'Password is required.';
      if (mode === 'signup' && password.length < 8) return 'Use at least 8 characters for your password.';
    }
    if (field === 'name' && mode === 'signup') {
      const cleanName = displayName.trim();
      if (cleanName && cleanName.length > 80) return 'Name must be 80 characters or fewer.';
    }
    return undefined;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;

    setStatusError(null);
    setStatusNotice(null);

    const nextErrors: typeof fieldErrors = {};
    const emailErr = validateField('email');
    const pwErr = validateField('password');
    const nameErr = validateField('name');
    if (emailErr) nextErrors.email = emailErr;
    if (pwErr) nextErrors.password = pwErr;
    if (nameErr) nextErrors.name = nameErr;
    if (mode === 'signup' && !termsAccepted) {
      nextErrors.terms = 'Please accept the Terms & Conditions to create an account.';
    }

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      if (nextErrors.email) emailRef.current?.focus();
      else if (nextErrors.password) passwordRef.current?.focus();
      else if (nextErrors.name) nameRef.current?.focus();
      else if (nextErrors.terms) termsRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    try {
      const res =
        mode === 'signin'
          ? await loginWithPassword({
              email: email.trim(),
              password,
              rememberMe,
            })
          : await registerWithPassword({
              email: email.trim(),
              password,
              displayName: displayName.trim() || undefined,
              rememberMe,
              termsAccepted,
            });
      setAuthenticatedUser(res.user);
    } catch (err: any) {
      setStatusError(err?.message || 'Authentication failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleCredential = useCallback(
    async (credential: string) => {
      setStatusError(null);
      setStatusNotice(null);
      setIsSubmitting(true);
      try {
        const res = await loginWithGoogleCredential(credential, rememberMe);
        setAuthenticatedUser(res.user);
      } catch (err: any) {
        setStatusError(err?.message || 'Google Sign-In failed.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [rememberMe, setAuthenticatedUser]
  );

  const handleGoogleError = useCallback((msg: string) => {
    setStatusError(msg);
  }, []);

  const handleForgotSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const clean = forgotEmail.trim();
    if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setForgotMessage('Please enter a valid email address.');
      return;
    }
    setForgotSubmitting(true);
    try {
      const res = await requestPasswordReset(clean);
      setForgotMessage(res.message);
    } catch (err: any) {
      setForgotMessage(err?.message || 'Could not process recovery request.');
    } finally {
      setForgotSubmitting(false);
    }
  };

  const toggleMode = () => {
    setMode((prev) => (prev === 'signin' ? 'signup' : 'signin'));
    setFieldErrors({});
    setStatusError(null);
    setStatusNotice(null);
  };

  return (
    <div className="relative h-[100dvh] w-screen overflow-y-auto lg:overflow-hidden bg-[#0b0d12] font-sans antialiased select-none flex items-center justify-center">
      {/* Full-bleed Figma atmospheric background artwork */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <img
          src={auraLoginBg}
          alt=""
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b0d12]/70 via-transparent to-[#0b0d12]/35 lg:bg-none" />
      </div>

      {/* Main Two-Column Stage scaled cleanly for laptop & desktop web viewports */}
      <div className="relative z-10 w-full max-w-[1240px] lg:h-full lg:max-h-[760px] mx-auto px-5 sm:px-8 lg:px-12 py-5 sm:py-6 lg:py-8 flex flex-col lg:flex-row items-center justify-between gap-6 lg:gap-10">
        {/* Left Presentation Column */}
        <section className="w-full lg:flex-1 lg:h-full flex flex-col justify-between gap-4 lg:gap-5 py-1 min-w-0">
          {/* Top-left Figma Wordmark */}
          <div className="flex items-center justify-between">
            <span className="text-[24px] sm:text-[26px] xl:text-[30px] font-bold leading-none text-white tracking-tight">
              Aura
            </span>
          </div>

          {/* Centerpiece Particle Ring Orb (downloaded SVG from Figma 53:7) */}
          <div className="flex items-center justify-center lg:justify-start lg:pl-12 xl:pl-16 my-1 lg:my-0">
            <div className="relative w-[220px] h-[220px] sm:w-[270px] sm:h-[270px] lg:w-[300px] lg:h-[300px] xl:w-[370px] xl:h-[370px] [@media(max-height:660px)]:w-[270px] [@media(max-height:660px)]:h-[270px] flex items-center justify-center overflow-visible">
              <img
                src={auraLoginOrb}
                alt=""
                width={446}
                height={446}
                className="max-w-none pointer-events-none select-none shrink-0 scale-[0.52] sm:scale-[0.64] lg:scale-[0.74] xl:scale-[0.92] [@media(max-height:740px)]:scale-[0.78] [@media(max-height:640px)]:scale-[0.68]"
              />
            </div>
          </div>

          {/* Bottom-left Headline + Feature Chips */}
          <div className="flex flex-col gap-3.5 xl:gap-4">
            <h2 className="text-[19px] sm:text-[22px] xl:text-[26px] font-bold leading-[1.24] text-white max-w-[420px] tracking-tight">
              Talk to Aura, your expressive AI companion
            </h2>

            <div className="flex flex-wrap lg:flex-nowrap items-center gap-2 sm:gap-2.5">
              <div className="h-[34px] xl:h-[38px] px-3 xl:px-3.5 rounded-[10px] bg-[#d8d8d8] text-[#1a1a1a] text-[12px] font-normal inline-flex items-center gap-2 whitespace-nowrap">
                <span aria-hidden="true">●</span>
                <span>Natural conversation</span>
              </div>
              <div className="h-[34px] xl:h-[38px] px-3 xl:px-3.5 rounded-[10px] bg-[#d8d8d8] text-[#1a1a1a] text-[12px] font-normal inline-flex items-center gap-2 whitespace-nowrap">
                <span aria-hidden="true">▦</span>
                <span>Memory-aware</span>
              </div>
              <div className="h-[34px] xl:h-[38px] px-3 xl:px-3.5 rounded-[10px] bg-[#d8d8d8] text-[#1a1a1a] text-[12px] font-normal inline-flex items-center gap-2 whitespace-nowrap">
                <span aria-hidden="true">◉</span>
                <span>Expressive voice</span>
              </div>
            </div>
          </div>
        </section>

        {/* Right Warm Cream Card (Figma #fbf6ec, border #efe8dc, proportional for web & laptop) */}
        <main className="w-full max-w-[420px] xl:max-w-[460px] shrink-0 flex items-center justify-center">
          <div className="w-full lg:max-h-[calc(100dvh-36px)] overflow-y-auto overflow-x-hidden custom-scrollbar bg-[#fbf6ec] border border-[#efe8dc] rounded-[22px] px-6 sm:px-7 xl:px-8 py-5 sm:py-6 xl:py-7 flex flex-col justify-between shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
            <div>
              {/* Card Title */}
              <div className="mb-4 xl:mb-5">
                <h1 className="text-[24px] sm:text-[26px] xl:text-[30px] font-bold leading-[1.15] text-[#0f0f0f] tracking-tight">
                  {mode === 'signin' ? 'Welcome back' : 'Create your account'}
                </h1>
                <p className="mt-1.5 text-[13px] xl:text-[13.5px] text-[#6b6b70] font-normal leading-normal">
                  {mode === 'signin'
                    ? 'Sign in to continue your conversation with Aura'
                    : 'Join Aura to save your voice chats and memory securely'}
                </p>
              </div>

              {/* Status Feedback Banner */}
              {(statusError || statusNotice) && (
                <div
                  role="status"
                  aria-live="polite"
                  className={`mb-3.5 px-3.5 py-2.5 rounded-[12px] text-[12px] sm:text-[12.5px] leading-snug border ${
                    statusError
                      ? 'bg-rose-50 border-rose-200 text-rose-800'
                      : 'bg-violet-50 border-violet-200 text-violet-900'
                  }`}
                >
                  {statusError || statusNotice}
                </div>
              )}

              {/* Primary Credentials Form */}
              <form onSubmit={handleSubmit} method="POST" noValidate className="flex flex-col gap-3 xl:gap-3.5">
                {mode === 'signup' && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="register-name" className="text-[13px] font-semibold text-[#111111]">
                      Name
                    </label>
                    <input
                      ref={nameRef}
                      id="register-name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      enterKeyHint="next"
                      maxLength={80}
                      value={displayName}
                      onChange={(e) => {
                        setDisplayName(e.target.value);
                        if (fieldErrors.name) setFieldErrors((p) => ({ ...p, name: undefined }));
                      }}
                      onBlur={() => {
                        const err = validateField('name');
                        setFieldErrors((p) => ({ ...p, name: err }));
                      }}
                      placeholder="Your name"
                      aria-invalid={fieldErrors.name ? 'true' : undefined}
                      className="w-full h-[42px] xl:h-[46px] px-3.5 rounded-[11px] bg-[#fffefa] border border-[#e5ddd0] focus:border-[#8b7cff] text-base md:text-[13.5px] text-[#0f0f0f] placeholder-[#8a8a8a] focus:outline-none focus-visible:outline-2 focus-visible:outline-[#7a5cff] transition-colors"
                    />
                    {fieldErrors.name && (
                      <p className="text-[11.5px] text-rose-700">{fieldErrors.name}</p>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="login-email" className="text-[13px] font-semibold text-[#111111]">
                    Email
                  </label>
                  <input
                    ref={emailRef}
                    id="login-email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    enterKeyHint="next"
                    required
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
                      if (statusError) setStatusError(null);
                    }}
                    onBlur={() => {
                      if (email.trim()) {
                        const err = validateField('email');
                        setFieldErrors((p) => ({ ...p, email: err }));
                      }
                    }}
                    placeholder="you@email.com"
                    aria-invalid={fieldErrors.email ? 'true' : undefined}
                    aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                    className={`w-full h-[42px] xl:h-[48px] px-3.5 rounded-[11px] bg-[#fffefa] border text-base md:text-[13.5px] text-[#0f0f0f] placeholder-[#8a8a8a] focus:outline-none focus-visible:outline-2 focus-visible:outline-[#7a5cff] transition-colors ${
                      fieldErrors.email ? 'border-rose-500' : 'border-[#e5ddd0] focus:border-[#8b7cff]'
                    }`}
                  />
                  {fieldErrors.email && (
                    <p id="email-error" className="text-[11.5px] text-rose-700">
                      {fieldErrors.email}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="login-password" className="text-[13px] font-semibold text-[#111111]">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      ref={passwordRef}
                      id="login-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                      minLength={mode === 'signup' ? 8 : undefined}
                      enterKeyHint="done"
                      required
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined }));
                        if (statusError) setStatusError(null);
                      }}
                      onBlur={() => {
                        if (password) {
                          const err = validateField('password');
                          setFieldErrors((p) => ({ ...p, password: err }));
                        }
                      }}
                      placeholder="••••••••••"
                      aria-invalid={fieldErrors.password ? 'true' : undefined}
                      aria-describedby={
                        fieldErrors.password
                          ? 'password-error'
                          : mode === 'signup'
                          ? 'password-help'
                          : undefined
                      }
                      className={`w-full h-[42px] xl:h-[48px] pl-3.5 pr-10 rounded-[11px] bg-[#fffefa] border text-base md:text-[13.5px] text-[#0f0f0f] placeholder-[#8a8a8a] focus:outline-none focus-visible:outline-2 focus-visible:outline-[#7a5cff] transition-colors ${
                        fieldErrors.password ? 'border-rose-500' : 'border-[#e5ddd0] focus:border-[#8b7cff]'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-pressed={showPassword}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-describedby="password-toggle-warning"
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center text-[#8a8a8a] hover:text-[#111111] cursor-pointer focus-visible:outline-2 focus-visible:outline-[#7a5cff]"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                    <span id="password-toggle-warning" className="visually-hidden">
                      Warning: showing your password will display it visibly on the screen.
                    </span>
                  </div>
                  {mode === 'signup' && !fieldErrors.password && (
                    <p id="password-help" className="text-[11px] text-[#6b6b70]">
                      At least 8 characters. Password managers and pasting are supported.
                    </p>
                  )}
                  {fieldErrors.password && (
                    <p id="password-error" className="text-[11.5px] text-rose-700">
                      {fieldErrors.password}
                    </p>
                  )}
                </div>

                {/* Remember me + Forgot password / Terms acceptance */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="remember-me" className="inline-flex items-center gap-2 cursor-pointer py-0.5">
                      <input
                        id="remember-me"
                        name="rememberMe"
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="w-4 h-4 rounded-[4px] border border-[#c9c2b8] bg-white accent-[#8b7cff] cursor-pointer"
                      />
                      <span className="text-[12.5px] xl:text-[13px] text-[#333333]">Remember me</span>
                    </label>

                    {mode === 'signin' && (
                      <button
                        type="button"
                        onClick={() => setIsForgotOpen(true)}
                        className="text-[12.5px] xl:text-[13px] font-semibold text-[#7a5cff] hover:text-[#6646eb] cursor-pointer rounded-md px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-[#7a5cff]"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>

                  {mode === 'signup' && (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-start gap-2">
                        <input
                          ref={termsRef}
                          id="terms-accepted"
                          name="termsAccepted"
                          type="checkbox"
                          checked={termsAccepted}
                          onChange={(e) => {
                            setTermsAccepted(e.target.checked);
                            if (fieldErrors.terms) setFieldErrors((p) => ({ ...p, terms: undefined }));
                          }}
                          className="mt-0.5 w-4 h-4 rounded-[4px] border border-[#c9c2b8] bg-white accent-[#8b7cff] cursor-pointer shrink-0"
                        />
                        <label htmlFor="terms-accepted" className="text-[12px] text-[#333333] leading-snug">
                          I agree to the{' '}
                          <button
                            type="button"
                            onClick={() => setIsTermsOpen(true)}
                            className="font-semibold text-[#7a5cff] hover:text-[#6646eb] underline cursor-pointer"
                          >
                            Terms &amp; Privacy Notice
                          </button>
                        </label>
                      </div>
                      {fieldErrors.terms && (
                        <p className="text-[11.5px] text-rose-700">{fieldErrors.terms}</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Primary Violet CTA */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-[44px] xl:h-[50px] mt-0.5 rounded-full bg-[#8b7cff] hover:bg-[#7b6bf6] active:scale-[0.99] text-white font-bold text-[14.5px] xl:text-[15px] flex items-center justify-center gap-2 shadow-[0_8px_24px_rgba(139,124,255,0.32)] transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[#5b3ef0] focus-visible:outline-offset-2"
                >
                  {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                  <span>{mode === 'signin' ? 'Sign in' : 'Create account'}</span>
                </button>
              </form>

              {/* Divider */}
              <div className="flex items-center gap-3.5 my-3.5 xl:my-4">
                <div className="h-px flex-1 bg-[#ddd6cb]" />
                <span className="text-[12px] text-[#7a7d86] whitespace-nowrap">or continue with</span>
                <div className="h-px flex-1 bg-[#ddd6cb]" />
              </div>

              {/* Google OAuth Button */}
              <GoogleSignInButton
                clientId={googleClientId}
                disabled={isSubmitting}
                onCredential={handleGoogleCredential}
                onError={handleGoogleError}
              />
            </div>

            {/* Footer Switch Link */}
            <div className="pt-3.5 xl:pt-5 text-center text-[13px] text-[#111111]">
              {mode === 'signin' ? (
                <span>
                  New to Aura?{' '}
                  <button
                    type="button"
                    onClick={toggleMode}
                    className="font-semibold text-[#7a5cff] hover:text-[#6646eb] cursor-pointer rounded-md px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-[#7a5cff]"
                  >
                    Create an account
                  </button>
                </span>
              ) : (
                <span>
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={toggleMode}
                    className="font-semibold text-[#7a5cff] hover:text-[#6646eb] cursor-pointer rounded-md px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-[#7a5cff]"
                  >
                    Sign in
                  </button>
                </span>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Native <dialog> for Terms & Conditions */}
      <TermsModal
        open={isTermsOpen}
        onClose={() => setIsTermsOpen(false)}
        onAccept={() => {
          setTermsAccepted(true);
          setFieldErrors((p) => ({ ...p, terms: undefined }));
        }}
      />

      {/* Native <dialog> for Forgot Password */}
      <dialog
        ref={forgotDialogRef}
        {...({ closedby: 'any' } as Record<string, string>)}
        aria-labelledby="forgot-dialog-title"
        className="m-auto w-[min(92vw,440px)] rounded-[24px] border border-[#23252F] bg-[#14161E] p-6 text-[#F2F2F2] shadow-[0_32px_80px_rgba(0,0,0,0.9)]"
      >
        <div className="flex items-center justify-between mb-3">
          <h1 id="forgot-dialog-title" className="text-[17px] font-bold text-white">
            Reset your password
          </h1>
          <button
            type="button"
            onClick={() => forgotDialogRef.current?.close('')}
            aria-label="Close reset password dialog"
            className="w-8 h-8 rounded-full bg-[#1A1D27] hover:bg-[#232733] border border-[#2A2E3B] flex items-center justify-center text-[#C9CBD3] hover:text-white cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
        <p className="text-[13px] text-[#A7A9AF] mb-4 leading-relaxed">
          Enter your account email below. If your account uses Google Sign-In, continue directly with the Google button.
        </p>
        <form onSubmit={handleForgotSubmit} method="POST" className="flex flex-col gap-3">
          <label htmlFor="forgot-email" className="text-[12px] font-semibold text-[#C9CBD3]">
            Email address
          </label>
          <input
            id="forgot-email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            required
            value={forgotEmail}
            onChange={(e) => setForgotEmail(e.target.value)}
            placeholder="you@email.com"
            className="w-full h-[48px] px-3.5 rounded-[12px] bg-[#1A1D27] border border-[#2A2E3B] focus:border-[#8B7CFF] text-[15px] text-white placeholder-[#7A7D86] focus:outline-none"
          />
          {forgotMessage && (
            <p role="status" aria-live="polite" className="text-[12px] text-[#A78BFA] bg-[#8B7CFF]/10 border border-[#8B7CFF]/25 rounded-[10px] px-3 py-2">
              {forgotMessage}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => forgotDialogRef.current?.close('')}
              className="px-4 py-2 rounded-full border border-[#2A2E3B] bg-[#1A1D27] text-xs font-medium text-[#C9CBD3] hover:text-white cursor-pointer"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={forgotSubmitting}
              className="px-5 py-2 rounded-full bg-[#8B7CFF] hover:bg-[#7b6bf6] text-xs font-semibold text-white cursor-pointer disabled:opacity-60"
            >
              {forgotSubmitting ? 'Sending...' : 'Request Reset'}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
