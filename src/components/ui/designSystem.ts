/**
 * Unified Design System Tokens & Utility Classes
 * Minimal, Compact, Dark Human Aesthetic
 * Target: Dark-mode reference system across the entire application
 */

// ── Color Constants ──
export const COLORS = {
  bgApp: '#0B0D12',
  sidebar: '#181818',
  panel: '#0D0F17',
  surface: '#202126',
  card: '#131622',
  input: '#11131C',
  border: '#2A2C33',
  borderSubtle: 'rgba(255, 255, 255, 0.08)',
  textPrimary: '#F2F2F2',
  textMuted: '#A7A9AF',
  accent: '#A78BFA', // Soft violet-purple from Aura logo
  indicator: '#6E8BFF', // Existing thin active indicator
  success: '#34D399',
  warning: '#FBBF24',
  destructive: '#F43F5E',
} as const;

// ── Typography ──
export const TYPO = {
  label: 'font-mono text-[11px] font-medium uppercase tracking-wider text-[#A7A9AF]',
  body: 'font-sans text-[13px] text-[#F2F2F2]/90 leading-relaxed font-normal',
  title: 'font-sans text-[15px] font-semibold text-[#F2F2F2] tracking-tight',
  heading: 'font-sans text-xl md:text-2xl font-semibold text-[#F2F2F2] tracking-tight',
  subheading: 'font-sans text-xs md:text-sm font-normal text-[#A7A9AF] leading-relaxed',
  mono: 'font-mono text-[11px] text-[#A7A9AF]',
  caption: 'font-sans text-[11px] text-[#A7A9AF]/70 leading-normal',
} as const;

// ── Button Variants ──
export const BUTTONS = {
  // Primary CTA: Slim, rounded dark charcoal pill with white text
  primary:
    'bg-[#202126] hover:bg-[#2A2C33] active:scale-[0.98] border border-white/[0.08] hover:border-white/[0.14] text-white font-medium rounded-full text-xs shadow-sm transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A78BFA]/40 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',

  // Secondary Pill: Frosted glass pill with hairline border
  secondary:
    'bg-white/[0.04] hover:bg-white/[0.08] active:scale-[0.98] border border-white/[0.08] hover:border-white/[0.16] text-[#F2F2F2] font-medium rounded-full text-xs transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A78BFA]/30 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',

  // Ghost: Transparent with soft hover
  ghost:
    'bg-transparent hover:bg-white/[0.05] active:scale-[0.98] text-[#A7A9AF] hover:text-[#F2F2F2] font-medium rounded-full text-xs transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',

  // Destructive: Rose tint for clear / delete
  destructive:
    'bg-rose-500/10 hover:bg-rose-500/20 active:scale-[0.98] border border-rose-500/20 hover:border-rose-500/35 text-rose-400 hover:text-rose-300 font-medium rounded-full text-xs transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',

  // Icon Button: Clean circular trigger
  icon:
    'w-8 h-8 rounded-full flex items-center justify-center text-[#A7A9AF] hover:text-[#F2F2F2] hover:bg-white/[0.06] active:scale-[0.95] transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A78BFA]/30',
} as const;

// ── Surface & Card Elevation Tiers ──
export const SURFACES = {
  // Main Panel Shell (16px radius, dark, compact)
  panelShell:
    'bg-[#0D0F17]/95 backdrop-blur-2xl border border-white/[0.08] rounded-[16px] shadow-[0_16px_48px_rgba(0,0,0,0.8)]',

  // Modal Dialog Shell (16px radius)
  modalShell:
    'bg-[#0D0F17]/95 backdrop-blur-2xl border border-white/[0.08] rounded-[16px] shadow-[0_24px_64px_rgba(0,0,0,0.85)]',

  // Inline Section Card (14px radius, #131622 background, #2A2C33 border)
  card:
    'bg-[#131622] border border-[#2A2C33] rounded-[14px] p-4 flex flex-col gap-3 shadow-sm',

  // Compact Inline Card (14px radius)
  cardCompact:
    'bg-[#131622] border border-[#2A2C33] rounded-[14px] p-3 flex flex-col gap-2.5 shadow-sm',

  // Interactive Card Item (Unselected)
  cardInteractive:
    'bg-[#131622] hover:bg-[#202126] border border-[#2A2C33] hover:border-white/[0.12] text-[#A7A9AF] hover:text-[#F2F2F2] rounded-[14px] transition-all duration-150 ease-out active:scale-[0.99] cursor-pointer shadow-sm',

  // Interactive Card Item (Selected with soft violet highlight + hairline border)
  cardSelected:
    'bg-[#202126] border-white/[0.14] text-[#F2F2F2] rounded-[14px] ring-1 ring-[#A78BFA]/40 transition-all duration-150 ease-out cursor-pointer',
} as const;

// ── Inputs & Form Controls ──
export const FORMS = {
  // Input Base (Pill for search / standard inputs)
  input:
    'bg-[#11131C] border border-[#2A2C33] focus:border-[#A78BFA]/60 focus:ring-1 focus:ring-[#A78BFA]/20 rounded-full px-3.5 py-2 text-[13px] text-[#F2F2F2] placeholder:text-[#A7A9AF]/45 focus:outline-none transition-all duration-150 ease-out shadow-inner font-sans',

  // Rectangular input (14px radius for textareas and multi-field forms)
  inputRect:
    'bg-[#11131C] border border-[#2A2C33] focus:border-[#A78BFA]/60 focus:ring-1 focus:ring-[#A78BFA]/20 rounded-[14px] px-3.5 py-2.5 text-[13px] text-[#F2F2F2] placeholder:text-[#A7A9AF]/45 focus:outline-none transition-all duration-150 ease-out shadow-inner font-sans',

  // Range Slider
  range:
    'w-full h-1.5 bg-[#202126] rounded-full appearance-none cursor-pointer accent-[#A78BFA]',

  // Chip / Pill Badge
  chip:
    'px-3 py-1 rounded-full text-[11px] font-medium border border-white/[0.08] transition-all duration-150 ease-out',
} as const;

// ── Status Indicators ──
export const STATUS_DOTS = {
  success: 'w-1.5 h-1.5 rounded-full bg-emerald-400',
  warning: 'w-1.5 h-1.5 rounded-full bg-amber-400',
  danger: 'w-1.5 h-1.5 rounded-full bg-rose-400',
  accent: 'w-1.5 h-1.5 rounded-full bg-[#A78BFA]',
  hero: 'w-1.5 h-1.5 rounded-full bg-[#6E8BFF]',
  neutral: 'w-1.5 h-1.5 rounded-full bg-white/30',
} as const;
