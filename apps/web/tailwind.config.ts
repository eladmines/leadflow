import type { Config } from 'tailwindcss';

/**
 * RTL rule: use logical utilities only (ms-/me-/ps-/pe-/start-/end-/text-start).
 * Never use ml-/mr-/pl-/pr-/left-/right-/text-left/text-right.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Heebo: clean, neutral, full Hebrew support (admin redesign, D-073).
        sans: ['Heebo', 'system-ui', 'Arial', 'sans-serif'],
      },
      colors: {
        // Primary: a clear, bright blue (D-114). 600 carries white text (5.2:1 on white);
        // 300/400/500 are for decoration, bars and dots, never for small text.
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        // Coral, from the logo's dot: highlights and decoration (active menu icon, progress).
        coral: { 50: '#fff4ef', 100: '#ffe4d9', 400: '#f99a79', 500: '#f77f57', 700: '#b4472a' },
        // Secondary tones are neutral slate: one accent colour (brand) carries the UI (D-073).
        accent: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
        },
        ink: {
          DEFAULT: '#0f172a',
          muted: '#64748b',
          subtle: '#94a3b8',
        },
        surface: {
          DEFAULT: '#ffffff',
          // Cool, near-white panels inside cards.
          muted: '#f8fafc',
          // The grey canvas behind the app's pages (D-114).
          canvas: '#f3f5f9',
          sunken: '#f1f5f9',
          border: '#e2e8f0',
        },
        /** Data mark color for single-series charts (passes the dataviz lightness, chroma and
         *  contrast checks on the light surface). */
        chart: { DEFAULT: '#2563eb', soft: '#2563eb1a', grid: '#e2e8f0' },
        danger: { 50: '#fdf0ee', 600: '#c0392b', 700: '#a32e22' },
        success: { 50: '#ecf7f0', 600: '#2e7d4f' },
        warning: { 50: '#fff7e6', 600: '#946200' },
      },
      borderRadius: { xl: '0.625rem', '2xl': '0.75rem', '3xl': '1rem' },
      boxShadow: {
        card: '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
        lift: '0 12px 32px -12px rgba(15, 23, 42, 0.22), 0 2px 6px -2px rgba(15, 23, 42, 0.06)',
      },
      // The help character (D-105): a slow float, a blink every few seconds, a wave on hover.
      keyframes: {
        'helper-float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-3px)' },
        },
        'helper-blink': {
          '0%, 92%, 100%': { transform: 'scaleY(1)' },
          '95%': { transform: 'scaleY(0.1)' },
        },
        'helper-wave': {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '25%': { transform: 'rotate(-28deg)' },
          '75%': { transform: 'rotate(12deg)' },
        },
        'helper-bob': {
          '0%, 100%': { transform: 'rotate(-6deg)' },
          '50%': { transform: 'rotate(6deg)' },
        },
        'helper-pop': {
          '0%': { opacity: '0', transform: 'translateY(6px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'helper-float': 'helper-float 3.2s ease-in-out infinite',
        'helper-blink': 'helper-blink 4.8s ease-in-out infinite',
        'helper-wave': 'helper-wave 0.9s ease-in-out 2',
        'helper-bob': 'helper-bob 2.4s ease-in-out infinite',
        'helper-pop': 'helper-pop 0.25s ease-out both',
      },
    },
  },
  plugins: [],
} satisfies Config;
