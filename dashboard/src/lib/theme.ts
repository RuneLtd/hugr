import { extendTheme, type ThemeConfig } from '@chakra-ui/react';
import {
  colors, gray, text, bg, border, overlay, scrollbar, destructive,
  lightBg, lightText, lightBorder, lightOverlay, lightScrollbar, lightDestructive,
} from './colors';

const config: ThemeConfig = {
  initialColorMode: 'system',
  useSystemColorMode: true,
};

const theme = extendTheme({
  config,
  colors,
  semanticTokens: {
    colors: {
      'bg.primary':   { default: `var(--hugr-bg-primary, ${lightBg.primary})`,   _dark: `var(--hugr-bg-primary, ${bg.primary})` },
      'bg.secondary': { default: `var(--hugr-bg-secondary, ${lightBg.secondary})`, _dark: `var(--hugr-bg-secondary, ${bg.secondary})` },
      'bg.cards':     { default: `var(--hugr-bg-cards, ${lightBg.cards})`,       _dark: `var(--hugr-bg-cards, ${bg.cards})` },
      'bg.surface':   { default: `var(--hugr-bg-surface, ${lightBg.surface})`,   _dark: `var(--hugr-bg-surface, ${bg.surface})` },
      'bg.tertiary':  { default: `var(--hugr-bg-tertiary, ${lightBg.tertiary})`, _dark: `var(--hugr-bg-tertiary, ${bg.tertiary})` },
      'bg.elevated':  { default: lightBg.elevated,  _dark: bg.elevated },
      'bg.hover':     { default: lightBg.hover,     _dark: bg.hover },
      'bg.active':    { default: lightBg.active,    _dark: bg.active },

      'text.primary':     { default: lightText.primary,     _dark: text.primary },
      'text.secondary':   { default: lightText.secondary,   _dark: text.secondary },
      'text.muted':       { default: lightText.muted,       _dark: text.muted },
      'text.subtle':      { default: lightText.subtle,      _dark: text.subtle },
      'text.placeholder': { default: lightText.placeholder, _dark: text.placeholder },
      'text.inverse':     { default: lightText.inverse,     _dark: text.inverse },

      'border.subtle':  { default: lightBorder.subtle,  _dark: border.subtle },
      'border.default': { default: lightBorder.default, _dark: border.default },
      'border.strong':  { default: lightBorder.strong,  _dark: border.strong },

      'overlay.subtle':       { default: lightOverlay.subtle,       _dark: overlay.subtle },
      'overlay.soft':         { default: lightOverlay.soft,         _dark: overlay.soft },
      'overlay.hover':        { default: lightOverlay.hover,        _dark: overlay.hover },
      'overlay.strong':       { default: lightOverlay.strong,       _dark: overlay.strong },
      'overlay.border':       { default: lightOverlay.border,       _dark: overlay.border },
      'overlay.borderStrong': { default: lightOverlay.borderStrong, _dark: overlay.borderStrong },
      'overlay.grid':         { default: lightOverlay.grid,         _dark: overlay.grid },
      'overlay.shadow':       { default: lightOverlay.shadow,       _dark: overlay.shadow },

      'scrollbar.thumb':      { default: lightScrollbar.thumb,      _dark: scrollbar.thumb },
      'scrollbar.thumbHover': { default: lightScrollbar.thumbHover, _dark: scrollbar.thumbHover },

      'destructive.redHover':   { default: lightDestructive.redHover,   _dark: destructive.redHover },
      'destructive.amberHover': { default: lightDestructive.amberHover, _dark: destructive.amberHover },
    },
  },
  fonts: {
    heading: '"Google Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    body: '"Google Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    mono: '"JetBrains Mono", "Fira Code", "SF Mono", monospace',
  },
  fontSizes: {
    '2xs': '12px',
    xs: '13px',
    sm: '14px',
    md: '15px',
    lg: '18px',
    xl: '22px',
    '2xl': '28px',
  },
  styles: {
    global: {
      'html, body': {
        bg: 'bg.primary',
        color: 'text.primary',
        fontSize: 'sm',
        lineHeight: 'tall',
      },
      '::-webkit-scrollbar': {
        width: '6px',
        height: '6px',
      },
      '::-webkit-scrollbar-track': {
        bg: 'transparent',
      },
      '::-webkit-scrollbar-thumb': {
        bg: 'scrollbar.thumb',
        borderRadius: 'full',
      },
      '::-webkit-scrollbar-thumb:hover': {
        bg: 'scrollbar.thumbHover',
      },
    },
  },
  layerStyles: {
    ghost: {
      py: 1.5,
      px: 2,
      bg: 'transparent',
      borderRadius: 'xl',
      transition: 'background 0.15s',
      cursor: 'pointer',
      _hover: { bg: 'overlay.hover' },
    },
    ghostActive: {
      py: 1.5,
      px: 2,
      bg: 'overlay.soft',
      borderRadius: 'xl',
      transition: 'background 0.15s',
      cursor: 'pointer',
      _hover: { bg: 'overlay.hover' },
    },
    icon: {
      p: 1,
      borderRadius: 'xl',
      color: 'text.subtle',
      transition: 'all 0.15s',
      cursor: 'pointer',
      _hover: { color: 'text.secondary', bg: 'overlay.hover' },
    },
    iconDanger: {
      p: 1,
      borderRadius: 'lg',
      color: 'text.subtle',
      transition: 'all 0.15s',
      cursor: 'pointer',
      _hover: { color: 'red.400', bg: 'overlay.strong' },
    },
    action: {
      p: 1,
      borderRadius: 'lg',
      color: 'text.subtle',
      transition: 'all 0.15s',
      cursor: 'pointer',
      _hover: { color: 'text.secondary', bg: 'overlay.strong' },
    },
    primary: {
      p: 2,
      borderRadius: 'full',
      bg: 'text.primary',
      color: 'text.inverse',
      transition: 'all 0.15s',
      cursor: 'pointer',
      _hover: { opacity: 0.85 },
      _disabled: {
        opacity: 0.4,
        cursor: 'not-allowed',
        _hover: { opacity: 0.4 },
      },
    },
  },
  components: {
    Button: {
      baseStyle: {
        fontWeight: '500',
        borderRadius: 'md',
        _focus: { boxShadow: 'none' },
        _focusVisible: { boxShadow: 'none' },
      },
      sizes: {
        xs: { h: 8, fontSize: 'xs', px: 3 },
        sm: { h: 9, fontSize: 'sm', px: 4 },
      },
      variants: {
        solid: {
          bg: gray[50],
          color: gray[950],
          _hover: { bg: gray[200], _disabled: { bg: gray[50] } },
          _active: { bg: gray[300] },
        },
        ghost: {
          color: 'text.muted',
          _hover: { bg: 'bg.hover', color: 'text.primary' },
          _active: { bg: 'bg.active' },
        },
      },
    },
    Input: {
      sizes: {
        xs: { field: { h: 8, fontSize: 'xs', borderRadius: 'md' } },
        sm: { field: { h: 10, fontSize: 'sm', borderRadius: 'md' } },
        md: { field: { h: 11, fontSize: 'md', borderRadius: 'md' } },
      },
      variants: {
        filled: {
          field: {
            bg: 'bg.tertiary',
            borderWidth: '1px',
            borderColor: 'border.subtle',
            _hover: { bg: 'bg.hover', borderColor: 'border.subtle' },
            _focus: { bg: 'bg.tertiary', borderColor: 'border.subtle', boxShadow: 'none' },
          },
        },
      },
      defaultProps: { variant: 'filled', size: 'sm' },
    },
    Textarea: {
      variants: {
        filled: {
          bg: 'bg.tertiary',
          borderWidth: '1px',
          borderColor: 'border.subtle',
          _hover: { bg: 'bg.hover', borderColor: 'border.subtle' },
          _focus: { bg: 'bg.tertiary', borderColor: 'border.subtle', boxShadow: 'none' },
        },
      },
      defaultProps: { variant: 'filled' },
    },
    Text: {
      baseStyle: { color: 'text.primary' },
      variants: {
        label: { fontSize: 'xs', fontWeight: 'semibold', color: 'text.muted', textTransform: 'uppercase', letterSpacing: '0.05em' },
        body: { fontSize: 'sm', fontWeight: 'medium', color: 'text.primary' },
        secondary: { fontSize: 'sm', fontWeight: 'normal', color: 'text.secondary' },
        caption: { fontSize: 'xs', fontWeight: 'normal', color: 'text.muted' },
        tiny: { fontSize: '2xs', fontWeight: 'medium', color: 'text.subtle' },
        mono: { fontSize: 'xs', fontFamily: 'mono', color: 'text.secondary' },
      },
    },
    Badge: {
      baseStyle: { fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.03em' },
    },
    Switch: {
      baseStyle: {
        track: { bg: 'bg.tertiary', _checked: { bg: gray[500] } },
      },
    },
    Tooltip: {
      baseStyle: {
        bg: 'gray.800',
        color: 'white',
        borderRadius: 'md',
        borderWidth: '1px',
        borderColor: 'whiteAlpha.200',
        px: 2,
        py: 0,
        fontSize: 'xs',
        fontWeight: 'medium',
        boxShadow: 'lg',
      },
      defaultProps: { hasArrow: false },
    },
    Menu: {
      baseStyle: {
        list: {
          bg: 'bg.secondary',
          border: '1px solid',
          borderColor: 'border.subtle',
          borderRadius: 'xl',
          py: 1.5,
          px: 0,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        },
        item: {
          bg: 'transparent',
          borderRadius: 'xl',
          fontSize: 'xs',
          fontWeight: 'normal',
          color: 'text.secondary',
          py: 1.5,
          px: 2.5,
          mx: 1.5,
          _hover: { bg: 'overlay.soft', color: 'text.primary' },
          _focus: { bg: 'overlay.soft', color: 'text.primary' },
        },
      },
    },
  },
});

export default theme;
