/**
 * Unified Design System Tokens & Utility Classes
 * Luxury Dark Glass Aesthetic with Specular Highlights & Neon Accents
 */

// ── Typography ──
export const TYPO = {
  label: 'font-mono text-[11px] font-medium uppercase tracking-wider text-[#A7A9AF]',
  body: 'font-sans text-[13px] text-[#F2F2F2]/90 leading-relaxed font-normal',
  title: 'font-sans text-[15px] font-semibold text-[#F2F2F2] tracking-tight',
  heading: 'font-sans text-3xl md:text-5xl font-light text-[#F2F2F2] tracking-tight',
  subheading: 'font-sans text-sm md:text-base font-normal text-[#A7A9AF] leading-relaxed',
  mono: 'font-mono text-[11px] text-[#A7A9AF]',
  caption: 'font-sans text-[11px] text-[#A7A9AF]/70 leading-normal',
} as const;

// ── Button Variants ──
export const BUTTONS = {
  // Primary CTA: Clean glowing white pill
  primary:
    'bg-gradient-to-r from-white via-[#F5F5F7] to-white hover:brightness-105 active:scale-[0.97] text-[#0B0D12] font-semibold rounded-full shadow-[0_2px_12px_rgba(255,255,255,0.15),0_1px_3px_rgba(0,0,0,0.5)] hover:shadow-[0_4px_20px_rgba(255,255,255,0.25)] transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6E8BFF]/50 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',

  // Secondary Pill: Frosted glass pill with hairline border
  secondary:
    'bg-[#131620]/80 hover:bg-[#1A1F2C]/90 active:scale-[0.97] border border-white/[0.08] hover:border-[#6E8BFF]/50 text-[#F2F2F2] font-medium rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.4)] transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6E8BFF]/30 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',

  // Ghost: Transparent with soft glass hover
  ghost:
    'bg-transparent hover:bg-white/[0.06] active:scale-[0.97] text-[#A7A9AF] hover:text-[#F2F2F2] font-medium rounded-full transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',

  // Destructive: Rose tint for clear / delete
  destructive:
    'bg-rose-500/10 hover:bg-rose-500/20 active:scale-[0.97] border border-rose-500/20 hover:border-rose-500/35 text-rose-400 hover:text-rose-300 font-medium rounded-full transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',

  // Icon Button: Clean circular glass trigger
  icon:
    'w-9 h-9 rounded-full flex items-center justify-center text-[#A7A9AF] hover:text-[#F2F2F2] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6E8BFF]/30',
} as const;

// ── Surface & Card Elevation Tiers ──
export const SURFACES = {
  // Main Panel Shell: Luxury frosted glass with top highlight
  panelShell:
    'bg-[#0D0F17]/88 backdrop-blur-3xl border border-white/[0.08] rounded-3xl shadow-[0_24px_80px_rgba(0,0,0,0.92),inset_0_1px_1px_rgba(255,255,255,0.08)]',

  // Modal Dialog Shell
  modalShell:
    'bg-[#0D0F17]/92 backdrop-blur-3xl border border-white/[0.1] rounded-3xl shadow-[0_32px_96px_rgba(0,0,0,0.95),inset_0_1px_1px_rgba(255,255,255,0.1)]',

  // Inline Section Card
  card:
    'bg-[#131622]/80 backdrop-blur-xl border border-white/[0.07] rounded-2xl p-4 flex flex-col gap-3 shadow-[0_4px_24px_rgba(0,0,0,0.4)]',

  // Compact Inline Card
  cardCompact:
    'bg-[#131622]/80 backdrop-blur-xl border border-white/[0.07] rounded-xl p-3 flex flex-col gap-2.5 shadow-sm',

  // Interactive Card Item (Unselected)
  cardInteractive:
    'bg-[#131622]/65 hover:bg-[#1A1F2F]/85 border border-white/[0.06] hover:border-[#6E8BFF]/45 text-[#A7A9AF] hover:text-[#F2F2F2] rounded-2xl transition-all duration-150 ease-out active:scale-[0.99] cursor-pointer shadow-sm',

  // Interactive Card Item (Selected with soft blue highlight)
  cardSelected:
    'bg-[#181D30]/95 border-[#6E8BFF]/60 text-[#F2F2F2] rounded-2xl shadow-[0_0_24px_rgba(110,139,255,0.18),inset_0_1px_1px_rgba(255,255,255,0.12)] ring-1 ring-[#6E8BFF]/40 transition-all duration-150 ease-out cursor-pointer',
} as const;

// ── Inputs & Form Controls ──
export const FORMS = {
  // Input Base
  input:
    'bg-[#11131C]/90 border border-white/[0.08] focus:border-[#6E8BFF]/70 focus:ring-2 focus:ring-[#6E8BFF]/20 rounded-xl px-3.5 py-2.5 text-[13px] text-[#F2F2F2] placeholder:text-[#A7A9AF]/45 focus:outline-none transition-all duration-150 ease-out shadow-inner',

  // Range Slider
  range:
    'w-full h-1.5 bg-[#1A1E2C] rounded-lg appearance-none cursor-pointer accent-[#6E8BFF]',

  // Chip / Pill Badge
  chip:
    'px-3 py-1 rounded-full text-[11px] font-medium border border-white/[0.08] transition-all duration-150 ease-out',
} as const;

// ── Status Indicators ──
export const STATUS_DOTS = {
  success: 'w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]',
  warning: 'w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24]',
  danger: 'w-1.5 h-1.5 rounded-full bg-rose-400 shadow-[0_0_8px_#f43f5e]',
  hero: 'w-1.5 h-1.5 rounded-full bg-[#6E8BFF] shadow-[0_0_10px_rgba(110,139,255,0.9)]',
  neutral: 'w-1.5 h-1.5 rounded-full bg-white/30',
} as const;
