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
        // Primary: sky blue (bright & friendly, D-111). 500+ keep white text readable
        // (600 = 5.9:1 on white); 300/400 are for decoration, never for text.
        brand: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0284c7',
          600: '#0369a1',
          700: '#075985',
          800: '#0c4a6e',
          900: '#082f49',
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
          // Cool, near-white page and sidebar background.
          muted: '#f8fafc',
          sunken: '#f1f5f9',
          border: '#e2e8f0',
        },
        /** Data mark color for single-series charts (passes the dataviz lightness, chroma and
         *  contrast checks on the light surface). */
        chart: { DEFAULT: '#0284c7', soft: '#0284c71a', grid: '#e2e8f0' },
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
