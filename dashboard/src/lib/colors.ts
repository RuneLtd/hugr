export const gray = {
  50: '#f5f5f5',
  100: '#e5e5e5',
  200: '#d4d4d4',
  300: '#b3b3b3',
  400: '#8a8a8a',
  500: '#6b6b6b',
  600: '#525252',
  700: '#3a3a3a',
  800: '#262626',
  900: '#171717',
  950: '#0d0d0d',
} as const;

export const bg = {
  primary: gray[950],
  secondary: '#171717',
  cards: '#161616',
  surface: '#111111',
  tertiary: '#1c1c1c',
  elevated: gray[800],
  hover: gray[700],
  active: gray[600],
} as const;

export const text = {
  primary: gray[50],
  secondary: gray[300],
  muted: gray[400],
  subtle: gray[500],
  placeholder: gray[400],
  inverse: gray[950],
} as const;

export const border = {
  subtle: '#212121',
  default: gray[700],
  strong: gray[600],
} as const;

export const accent = {
  green: '#22c55e',
  greenMuted: '#166534',
  greenDim: '#052e16',
  red: '#ef4444',
  redMuted: '#7f1d1d',
  redDim: '#450a0a',
  amber: '#f59e0b',
  amberMuted: '#78350f',
  amberDim: '#451a03',
  blue: '#3b82f6',
  blueMuted: '#1e3a5f',
  blueDim: '#172554',
  pink: '#ec4899',
  purple: '#a855f7',
  purpleMuted: '#581c87',
  purpleDim: '#2e1065',
  yellow: '#ffc600',
  yellowMuted: '#854d0e',
  yellowDim: '#422006',
} as const;

export const activityColors = {
  thinking: { color: '#6366f1', accent: '#818cf8' },
  reading: { color: '#8ab4f8', accent: '#bfdbfe' },
  writing: { color: '#fb923c', accent: '#fdba74' },
  editing: { color: '#f472b6', accent: '#f9a8d4' },
  running: { color: '#34d399', accent: '#6ee7b7' },
  analyzing: { color: '#f97316', accent: '#fb923c' },
  reviewing: { color: '#c084fc', accent: '#d8b4fe' },
  starting: { color: '#94a3b8', accent: '#cbd5e1' },
  default: { color: gray[400], accent: gray[300] },
} as const;

export const agentColors: Record<string, string> = {
  architect: accent.purple,
  coder: gray[400],
  frontend: accent.blue,
  backend: gray[500],
  raven: accent.green,
  reviewer: accent.blue,
  manager: gray[500],
  planner: accent.amber,
  executor: accent.blue,
  validator: accent.green,
  router: accent.pink,
  aggregator: accent.yellow,
} as const;

export const overlay = {
  subtle: 'rgba(255, 255, 255, 0.03)',
  soft: 'rgba(255, 255, 255, 0.05)',
  hover: 'rgba(255, 255, 255, 0.08)',
  strong: 'rgba(255, 255, 255, 0.12)',
  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(255, 255, 255, 0.15)',
  grid: 'rgba(255, 255, 255, 0.04)',
  shadow: 'rgba(0, 0, 0, 0.4)',
} as const;

export const scrollbar = {
  thumb: gray[700],
  thumbHover: gray[600],
  track: 'transparent',
  width: '6px',
} as const;

export const destructive = {
  redHover: 'rgba(239, 68, 68, 0.1)',
  amberHover: 'rgba(251, 146, 60, 0.1)',
} as const;

export const colors = {
  gray,
  brand: gray,
  bg,
  border,
  text,
  green: {
    50: '#f0fdf4', 100: '#dcfce7', 200: '#bbf7d0', 300: '#86efac',
    400: accent.green, 500: '#16a34a', 600: '#166534', 700: '#14532d',
    800: '#052e16', 900: '#022c22',
  },
  red: {
    50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5',
    400: accent.red, 500: '#dc2626', 600: '#991b1b', 700: '#7f1d1d',
    800: '#450a0a', 900: '#3b0000',
  },
  orange: {
    50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d',
    400: accent.amber, 500: '#d97706', 600: '#92400e', 700: '#78350f',
    800: '#451a03', 900: '#3b1500',
  },
  blue: {
    50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd',
    400: accent.blue, 500: '#2563eb', 600: '#1d4ed8', 700: '#1e3a5f',
    800: '#172554', 900: '#0f1729',
  },
  purple: {
    50: '#faf5ff', 100: '#f3e8ff', 200: '#e9d5ff', 300: '#d8b4fe',
    400: accent.purple, 500: '#9333ea', 600: '#7e22ce', 700: '#581c87',
    800: '#2e1065', 900: '#1a0533',
  },
  yellow: {
    50: '#fefce8', 100: '#fef9c3', 200: '#fef08a', 300: '#fde047',
    400: accent.yellow, 500: '#eab308', 600: '#ca8a04', 700: '#a16207',
    800: '#854d0e', 900: '#713f12',
  },
} as const;

export const lightBg = {
  primary: '#f6f5f1',
  secondary: '#f5f4f2',
  cards: '#ffffff',
  surface: '#f5f4f2',
  tertiary: '#ffffff',
  elevated: '#ffffff',
  hover: '#e8e7e3',
  active: '#dddcd8',
} as const;

export const lightText = {
  primary: '#000000',
  secondary: '#404040',
  muted: '#737373',
  subtle: '#a3a8a7',
  placeholder: '#737373',
  inverse: '#f5f5f5',
} as const;

export const lightBorder = {
  subtle: 'rgba(0, 0, 0, 0.08)',
  default: 'rgba(0, 0, 0, 0.12)',
  strong: 'rgba(0, 0, 0, 0.2)',
} as const;

export const lightOverlay = {
  subtle: 'rgba(0, 0, 0, 0.02)',
  soft: 'rgba(0, 0, 0, 0.03)',
  hover: 'rgba(0, 0, 0, 0.06)',
  strong: 'rgba(0, 0, 0, 0.08)',
  border: 'rgba(0, 0, 0, 0.08)',
  borderStrong: 'rgba(0, 0, 0, 0.15)',
  grid: 'rgba(0, 0, 0, 0.04)',
  shadow: 'rgba(0, 0, 0, 0.08)',
} as const;

export const lightScrollbar = {
  thumb: '#a3a3a3',
  thumbHover: '#8a8a8a',
  track: 'transparent',
  width: '6px',
} as const;

export const lightDestructive = {
  redHover: 'rgba(239, 68, 68, 0.08)',
  amberHover: 'rgba(251, 146, 60, 0.08)',
} as const;
