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
        // Rubik: rounded, friendly, full Hebrew support.
        sans: ['Rubik', 'system-ui', 'Arial', 'sans-serif'],
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
        // Accent: warm coral for highlights, progress and friendly touches. Never for errors.
        accent: {
          50: '#fff3ee',
          100: '#ffe3d7',
          200: '#ffc5ad',
          300: '#fd9f7c',
          400: '#f77f57',
          500: '#ec6640',
          600: '#d4502d',
          700: '#b04024',
        },
        ink: {
          DEFAULT: '#1f2933',
          muted: '#5f6b74',
          subtle: '#929ca3',
        },
        surface: {
          DEFAULT: '#ffffff',
          // Warm cream page background.
          muted: '#f8f5f0',
          sunken: '#f1ece4',
          border: '#e9e2d7',
        },
        danger: { 50: '#fdf0ee', 600: '#c0392b', 700: '#a32e22' },
        success: { 50: '#ecf7f0', 600: '#2e7d4f' },
        warning: { 50: '#fff7e6', 600: '#946200' },
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.25rem', '3xl': '1.75rem' },
      boxShadow: {
        card: '0 1px 2px rgba(60, 45, 25, 0.04), 0 4px 16px -6px rgba(60, 45, 25, 0.08)',
        lift: '0 2px 4px rgba(60, 45, 25, 0.05), 0 12px 32px -10px rgba(60, 45, 25, 0.16)',
      },
    },
  },
  plugins: [],
} satisfies Config;
