/**
 * Unified Design System Tokens & Utility Classes
 * Established for Studio AI Broadcast Control Panel & Companion Overlays.
 *
 * Rules:
 * - Color: ONE hero accent (violet: #8B5CF6 -> #7C3AED).
 *   3 semantic states: emerald (connected/success), amber (needs-confirmation), rose (destructive/error/mic).
 * - Radius: 3-step scale: inputs/chips = rounded-lg, cards/buttons = rounded-xl, panel/modals = rounded-2xl.
 * - Elevation: flat cards, raised shell, single glow for primary CTA & selected engine card.
 * - Spacing: 4 / 8 / 12 / 16 / 24 scale (gap-1, gap-2, gap-3, gap-4, gap-6).
 * - Typography: 11px uppercase label, 13px body, 15px title, 11px mono readout.
 * - Buttons: 4 strict variants (Primary, Secondary, Ghost, Destructive) + 1 icon-button.
 * - Motion: targeted transitions with active:scale-[0.98].
 */

// ── Typography ──
export const TYPO = {
  label: 'text-[11px] font-medium uppercase tracking-wider text-white/40',
  body: 'text-[13px] text-white/90 leading-relaxed',
  title: 'text-[15px] font-semibold text-white tracking-tight',
  mono: 'text-[11px] font-mono text-white/50',
  caption: 'text-[11px] text-white/50 leading-normal',
} as const;

// ── Button Variants (Strictly 4 + Icon button) ──
export const BUTTONS = {
  // Primary: One hero CTA per view with gradient and subtle glow
  primary:
    'bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] hover:brightness-110 active:scale-[0.98] text-white font-medium rounded-xl shadow-[0_0_20px_rgba(139,92,246,0.25)] transition-[transform,filter,background-color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0F0F12] disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',

  // Secondary: Subtle fill + border for contextual actions
  secondary:
    'bg-white/[0.04] hover:bg-white/[0.08] active:scale-[0.98] border border-white/[0.08] hover:border-white/[0.14] text-white/80 hover:text-white font-medium rounded-xl transition-[transform,background-color,border-color,color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6]/50 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0F0F12] disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',

  // Ghost: Text-only with subtle hover background
  ghost:
    'bg-transparent hover:bg-white/[0.05] active:scale-[0.98] text-white/60 hover:text-white font-medium rounded-xl transition-[transform,background-color,color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',

  // Destructive: Rose tint reserved for clear / delete operations
  destructive:
    'bg-rose-500/10 hover:bg-rose-500/20 active:scale-[0.98] border border-rose-500/20 hover:border-rose-500/30 text-rose-400 hover:text-rose-300 font-medium rounded-xl transition-[transform,background-color,border-color,color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0F0F12] disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',

  // Icon Button: Standardized 28px x 28px square icon trigger
  icon:
    'w-7 h-7 rounded-lg flex items-center justify-center text-white/50 hover:text-white/90 hover:bg-white/[0.06] active:scale-[0.98] transition-[transform,background-color,color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6]/50 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0F0F12]',
} as const;

// ── Surface & Card Elevation Tiers ──
export const SURFACES = {
  // Main Panel Shell (Solid dark layer above 3D canvas - strictly NO backdrop-blur)
  panelShell:
    'bg-[#0F0F12] border border-white/[0.06] rounded-2xl shadow-[0_24px_48px_rgba(0,0,0,0.7)]',

  // Modal Dialog Shell (Transient overlay with elevated shadow)
  modalShell:
    'bg-[#0F0F12] border border-white/[0.08] rounded-2xl shadow-[0_32px_64px_rgba(0,0,0,0.8)]',

  // Inline Section Card (Flat, cleanly bordered)
  card:
    'bg-[#141417] border border-white/[0.06] rounded-xl p-4 flex flex-col gap-3',

  // Compact Inline Card (Used for tighter sub-sections)
  cardCompact:
    'bg-[#141417] border border-white/[0.06] rounded-xl p-3 flex flex-col gap-2.5',

  // Interactive Card Item (Unselected)
  cardInteractive:
    'bg-[#101013] border border-white/[0.06] hover:border-white/[0.12] text-white/70 hover:text-white rounded-xl transition-[transform,background-color,border-color,color,box-shadow] duration-150 ease-out active:scale-[0.99] cursor-pointer',

  // Interactive Card Item (Selected with Hero Violet Glow)
  cardSelected:
    'bg-[#101013] border-[#8B5CF6]/70 text-white rounded-xl shadow-[0_0_20px_rgba(139,92,246,0.18)] ring-1 ring-[#8B5CF6]/50 transition-[transform,background-color,border-color,color,box-shadow] duration-150 ease-out cursor-pointer',
} as const;

// ── Inputs & Form Controls ──
export const FORMS = {
  // Input Base (Strictly rounded-lg for input tier)
  input:
    'bg-[#0A0A0C] border border-white/[0.08] focus:border-[#8B5CF6]/60 rounded-lg px-3 py-2 text-[13px] text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-[#8B5CF6]/40 transition-[border-color,box-shadow] duration-150 ease-out',

  // Range Slider (Refined violet track & thumb)
  range:
    'w-full h-1.5 bg-[#0A0A0C] rounded-lg appearance-none cursor-pointer accent-[#8B5CF6]',

  // Chip / Pill Badge
  chip:
    'px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-[background-color,border-color,color] duration-150 ease-out',
} as const;

// ── Status Indicators ──
export const STATUS_DOTS = {
  success: 'w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]',
  warning: 'w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]',
  danger: 'w-1.5 h-1.5 rounded-full bg-rose-400 shadow-[0_0_6px_rgba(244,63,94,0.6)]',
  hero: 'w-1.5 h-1.5 rounded-full bg-[#8B5CF6] shadow-[0_0_6px_rgba(139,92,246,0.6)]',
  neutral: 'w-1.5 h-1.5 rounded-full bg-white/20',
} as const;
