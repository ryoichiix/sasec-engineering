/**
 * SASEC Engineering — Design Tokens
 *
 * Single source of truth for colors, used wherever JS-level theme
 * access is required (recharts, inline styles, dynamic gradients).
 *
 * For everything else, use Tailwind utilities — the equivalent CSS
 * tokens are defined in src/index.css under @theme.
 */

export const COLORS = {
  // Surfaces
  pageBg:     '#F8FAFC',
  bgAlt:      '#F1F5F9',
  card:       '#FFFFFF',
  cardHover:  '#FFF1F1',
  sidebar:    '#0F172A',
  sidebarAlt: '#1E293B',
  sidebarTxt: '#94A3B8',
  border:     '#E2E8F0',

  // Text
  textPri:    '#0F172A',
  textSec:    '#64748B',
  textMute:   '#94A3B8',
  textOnDark: '#FFFFFF',

  // Brand
  brand:      '#C0272D',
  brandHover: '#A01E23',
  brandSoft:  '#FFF1F1',

  // Semantic
  success:    '#10B981',
  successBg:  '#D1FAE5',
  warning:    '#F59E0B',
  warningBg:  '#FEF3C7',
  error:      '#EF4444',
  errorBg:    '#FEE2E2',
  info:       '#3B82F6',
  infoBg:     '#DBEAFE',

  // Money / value highlights
  gold:       '#D97706',
  goldBg:     '#FEF3C7',
}

export const RADIUS = {
  sm:  '6px',
  md:  '8px',
  lg:  '12px',
  xl:  '16px',
  pill: '9999px',
}

export const SHADOW = {
  sm: '0 1px 2px rgba(15, 23, 42, 0.06)',
  md: '0 1px 3px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.04)',
  lg: '0 10px 32px -8px rgba(15, 23, 42, 0.12), 0 4px 12px rgba(15, 23, 42, 0.06)',
  glow: '0 0 0 4px rgba(192, 39, 45, 0.12)',
}

// Recharts-friendly palette
export const CHART_PALETTE = [
  '#C0272D', // brand red
  '#10B981', // success green
  '#F59E0B', // warning amber
  '#3B82F6', // info blue
  '#D97706', // gold
  '#8B5CF6', // violet
]
