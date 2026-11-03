/**
 * Aura — Premium UI Design System Tokens & Utility Classes
 * Extracted directly from Figma: "Aura — Premium UI Design"
 * Frame 13:2 ("Aura — Mixed Design Tokens") & Frames 13:28, 13:80, 3:2, 1:2
 *
 * System Specs:
 * - App background: #0B0D12
 * - Sidebar / cards: #14161E
 * - Surface: #1A1D27
 * - Border: #23252F / #2A2E3B
 * - Accent violet: #8B7CFF (Active item fill: #2A2350)
 * - AI message bubble: #232845 with #8B7CFF border
 * - Ready green: #34D399
 * - Text Primary: #F2F2F2 / #FFFFFF
 * - Text Secondary: #C9CBD3
 * - Text Muted: #A7A9AF
 * - Text Subtle: #7A7D86
 * - Radii: stage/sidebar 24-28px • cards 16px • pills + composer 33px
 * - Type: Inter • Title 18-22px • Body 13-14px • Labels 11px uppercase
 */

// ── Color Constants ──
export const COLORS = {
  bgApp: '#0B0D12',
  stage: '#10121A',
  sidebar: '#14161E',
  surface: '#1A1D27',
  card: '#14161E',
  cardElevated: '#1A1D27',
  composer: '#1C1F2A',
  input: '#1A1D27',
  border: '#23252F',
  borderLight: '#2A2E3B',
  borderSubtle: '#23252F',
  accent: '#8B7CFF',
  accentHover: '#9E91FF',
  accentActive: '#7868F5',
  activeBg: '#2A2350',
  aiBubble: '#232845',
  userBubble: '#1A1D27',
  ready: '#34D399',
  success: '#34D399',
  warning: '#FBBF24',
  destructive: '#F43F5E',
  textPrimary: '#F2F2F2',
  textWhite: '#FFFFFF',
  textSecondary: '#C9CBD3',
  textMuted: '#A7A9AF',
  textSubtle: '#7A7D86',
} as const;

// ── Typography ──
export const TYPO = {
  brand: 'font-sans text-[19px] font-bold tracking-tight text-[#F2F2F2]',
  brandSub: 'font-sans text-[11px] font-normal text-[#A7A9AF]',
  label: 'font-sans text-[11px] font-semibold uppercase tracking-wider text-[#7A7D86]',
  body: 'font-sans text-[13px] md:text-[14px] text-[#F2F2F2]/90 leading-relaxed font-normal',
  title: 'font-sans text-[18px] md:text-[20px] font-bold text-[#FFFFFF] tracking-tight',
  heading: 'font-sans text-[20px] md:text-[22px] font-bold text-[#FFFFFF] tracking-tight',
  subheading: 'font-sans text-[13px] font-normal text-[#A7A9AF] leading-relaxed',
  mono: 'font-mono text-[11px] text-[#C9CBD3]',
  caption: 'font-sans text-[12px] text-[#7A7D86] leading-normal',
} as const;

// ── Button Variants ──
export const BUTTONS = {
  // Primary CTA: Vibrant Violet pill with white text (Figma: #8B7CFF)
  primary:
    'bg-[#8B7CFF] hover:bg-[#9E91FF] active:scale-[0.98] text-[#FFFFFF] font-semibold rounded-[33px] text-xs px-4 py-2 shadow-[0_4px_16px_rgba(139,124,255,0.3)] transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B7CFF]/50 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',

  // Secondary Pill: Surface pill with subtle border (Figma: #1A1D27, border #2A2E3B)
  secondary:
    'bg-[#1A1D27] hover:bg-[#232733] active:scale-[0.98] border border-[#2A2E3B] hover:border-[#8B7CFF]/40 text-[#C9CBD3] hover:text-[#FFFFFF] font-medium rounded-[33px] text-xs px-3.5 py-1.5 transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B7CFF]/40 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',

  // Ghost: Transparent with soft hover
  ghost:
    'bg-transparent hover:bg-[#1A1D27] active:scale-[0.98] text-[#A7A9AF] hover:text-[#FFFFFF] font-medium rounded-[33px] text-xs px-3 py-1.5 transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#8B7CFF]/30 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',

  // Destructive: Rose tint for clear / delete
  destructive:
    'bg-rose-500/10 hover:bg-rose-500/20 active:scale-[0.98] border border-rose-500/20 hover:border-rose-500/40 text-rose-400 hover:text-rose-300 font-medium rounded-[33px] text-xs px-3.5 py-1.5 transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',

  // Circular Icon Button (Figma: #262A38 or #1A1D27)
  icon:
    'w-9 h-9 rounded-full flex items-center justify-center text-[#C9CBD3] hover:text-[#FFFFFF] bg-[#1A1D27] hover:bg-[#232733] border border-[#2A2E3B] active:scale-[0.95] transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B7CFF]/40',

  // Circular Violet Send Action (Figma: Ellipse 40x40 #8B7CFF)
  iconSend:
    'w-10 h-10 rounded-full flex items-center justify-center text-white bg-[#8B7CFF] hover:bg-[#9E91FF] active:scale-[0.95] shadow-[0_2px_12px_rgba(139,124,255,0.4)] transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B7CFF]',
} as const;

// ── Surface & Card Elevation Tiers ──
export const SURFACES = {
  // Main Panel Shell (Figma: #14161E background, border #23252F, radius 24px)
  panelShell:
    'bg-[#14161E] border border-[#23252F] rounded-[24px] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8),0_0_40px_0_rgba(139,124,255,0.05)]',

  // Modal Dialog Shell (Figma: #14161E, border #23252F, radius 24px)
  modalShell:
    'bg-[#14161E] border border-[#23252F] rounded-[24px] shadow-[0_32px_80px_rgba(0,0,0,0.95),0_0_50px_rgba(139,124,255,0.08)]',

  // Inline Section Card (Figma: #14161E or #1A1D27, radius 16px, border #23252F / #2A2E3B)
  card:
    'bg-[#14161E] border border-[#23252F] rounded-[16px] p-4 flex flex-col gap-3 shadow-sm',

  // Elevated Card / Input Surface (Figma: #1A1D27, border #2A2E3B, radius 16px)
  surface:
    'bg-[#1A1D27] border border-[#2A2E3B] rounded-[16px] p-4 flex flex-col gap-3',

  // Compact Inline Card (14px-16px radius)
  cardCompact:
    'bg-[#1A1D27] border border-[#2A2E3B] rounded-[14px] p-3 flex flex-col gap-2 shadow-sm',

  // Interactive Card Item (Unselected)
  cardInteractive:
    'bg-[#1A1D27] hover:bg-[#202431] border border-[#2A2E3B] hover:border-[#8B7CFF]/40 text-[#C9CBD3] hover:text-[#FFFFFF] rounded-[16px] transition-all duration-150 ease-out active:scale-[0.99] cursor-pointer shadow-sm',

  // Interactive Card Item (Selected: Figma #2A2350 with violet border)
  cardSelected:
    'bg-[#2A2350] border-[#8B7CFF] text-[#FFFFFF] rounded-[16px] ring-1 ring-[#8B7CFF] transition-all duration-150 ease-out cursor-pointer shadow-sm',

  // AI Message Capsule (Figma: #232845, border #8B7CFF, radius 16px)
  aiMessage:
    'bg-[#232845] border border-[#8B7CFF] text-[#F2F2F2] rounded-[16px] p-4 shadow-sm',

  // User Message Capsule (Figma: #1A1D27, border #2A2E3B, radius 16px)
  userMessage:
    'bg-[#1A1D27] border border-[#2A2E3B] text-[#F2F2F2] rounded-[16px] p-3.5 shadow-sm',

  // Composer Bar Capsule (Figma: #1C1F2A, border #2A2E3B, radius 33px)
  composerPill:
    'bg-[#1C1F2A] border border-[#2A2E3B] rounded-[33px] shadow-[0_12px_40px_rgba(0,0,0,0.6)]',
} as const;

// ── Form & Input Styles ──
export const FORMS = {
  // Floating capsule search / text input (Figma: #1A1D27, border #2A2E3B, radius 20px)
  search:
    'w-full bg-[#1A1D27] border border-[#2A2E3B] focus:border-[#8B7CFF] text-[#F2F2F2] placeholder-[#7A7D86] text-xs rounded-[20px] px-3.5 py-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#8B7CFF]/50 transition-all duration-150',

  // Standard input (radius 14px)
  input:
    'w-full bg-[#1A1D27] border border-[#2A2E3B] focus:border-[#8B7CFF] text-[#F2F2F2] placeholder-[#7A7D86] text-xs rounded-[14px] px-3 py-2.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#8B7CFF]/50 transition-all duration-150',

  // Composer textarea / main input
  composerInput:
    'w-full bg-transparent text-[#F2F2F2] placeholder-[#7A7D86] text-sm focus:outline-none resize-none leading-relaxed',
} as const;

// ── Status Dots ──
export const STATUS_DOTS = {
  ready: 'w-2 h-2 rounded-full bg-[#34D399] shadow-[0_0_8px_#34D399]',
  success: 'w-2 h-2 rounded-full bg-[#34D399] shadow-[0_0_8px_#34D399]',
  busy: 'w-2 h-2 rounded-full bg-[#8B7CFF] shadow-[0_0_8px_#8B7CFF] animate-pulse',
  hero: 'w-2 h-2 rounded-full bg-[#8B7CFF] shadow-[0_0_8px_#8B7CFF] animate-pulse',
  error: 'w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]',
  danger: 'w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]',
  idle: 'w-2 h-2 rounded-full bg-[#7A7D86]',
} as const;
