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
        sans: ['Heebo', 'system-ui', 'Arial', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef8f8',
          100: '#d4eeee',
          200: '#aadcdd',
          300: '#76c3c5',
          400: '#46a4a7',
          500: '#2b888c',
          600: '#1f6d72',
          700: '#1c585d',
          800: '#1b484c',
          900: '#163a3e',
        },
        ink: {
          DEFAULT: '#1e2a32',
          muted: '#5b6b75',
          subtle: '#8a98a1',
        },
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f5f7f8',
          border: '#dfe5e8',
        },
        danger: { 50: '#fdf0f0', 600: '#c0362c', 700: '#a12b23' },
        success: { 50: '#eef8f1', 600: '#2f7d4a' },
        warning: { 50: '#fdf7e8', 600: '#9a6b00' },
      },
      borderRadius: { xl: '0.875rem' },
    },
  },
  plugins: [],
} satisfies Config;
