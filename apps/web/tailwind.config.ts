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
        // Primary: a deep, slightly warm teal (trust, calm).
        brand: {
          50: '#edf7f6',
          100: '#d3ece9',
          200: '#a8d8d3',
          300: '#74bdb6',
          400: '#479f98',
          500: '#2c837d',
          600: '#1f6a66',
          700: '#1b5653',
          800: '#194644',
          900: '#163b39',
        },
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
         *  contrast checks on the light surface; the brand teal reads gray as a data color). */
        chart: { DEFAULT: '#0f8f84', soft: '#0f8f841a', grid: '#e2e8f0' },
        danger: { 50: '#fdf0ee', 600: '#c0392b', 700: '#a32e22' },
        success: { 50: '#ecf7f0', 600: '#2e7d4f' },
        warning: { 50: '#fff7e6', 600: '#946200' },
      },
      borderRadius: { xl: '0.625rem', '2xl': '0.75rem', '3xl': '1rem' },
      boxShadow: {
        card: '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
        lift: '0 12px 32px -12px rgba(15, 23, 42, 0.22), 0 2px 6px -2px rgba(15, 23, 42, 0.06)',
      },
    },
  },
  plugins: [],
} satisfies Config;
