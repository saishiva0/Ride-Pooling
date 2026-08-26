/**
 * Minimal UI foundation (Phase 3.13 — MOBILE FOUNDATION).
 *
 * Deliberately small: a colors palette, a spacing scale, and a typography
 * baseline. This is NOT a design system and NOT final UI — it exists so the
 * placeholder shell and future screens share consistent primitives instead of
 * scattering magic values. Follow the existing project convention of no
 * invented product decisions: no brand exploration, no visual polish.
 */

export const colors = {
  background: '#FFFFFF',
  surface: '#F5F5F5',
  textPrimary: '#111111',
  textSecondary: '#555555',
  accent: '#1A73E8',
  danger: '#C5221F',
  success: '#2E7D32',
  warning: '#ED6C02',
  border: '#E0E0E0',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const typography = {
  title: {
    fontSize: 28,
    fontWeight: '700' as const,
  },
  body: {
    fontSize: 14,
  },
  caption: {
    fontSize: 12,
  },
} as const;
