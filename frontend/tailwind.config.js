/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Sarabun', 'sans-serif'],
      },
      colors: {
        brand: {
          DEFAULT: '#1D4ED8',
          50:  '#EFF6FF',
          100: '#DBEAFE',
          200: '#BFDBFE',
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
          800: '#1E40AF',
          900: '#1E3A8A',
        },
        surface: {
          DEFAULT: '#F8FAFC',
          raised:  '#FFFFFF',
          border:  '#E2E8F0',
        },
        ink: {
          DEFAULT: '#0F172A',
          muted:   '#64748B',
        },
        success: { DEFAULT: '#10B981', soft: '#D1FAE5' },
        warn:    { DEFAULT: '#F59E0B', soft: '#FEF3C7' },
        danger:  { DEFAULT: '#EF4444', soft: '#FEE2E2' },
        info:    { DEFAULT: '#0EA5E9', soft: '#E0F2FE' },
      },
      boxShadow: {
        soft:    '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        elevate: '0 4px 12px -2px rgb(15 23 42 / 0.08), 0 2px 6px -2px rgb(15 23 42 / 0.04)',
      },
      keyframes: {
        'slide-in': {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        'slide-in-left': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'skeleton-shimmer': {
          '0%':   { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        'fade-in-up': {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%':   { opacity: '0', transform: 'scale(0.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'shimmer': {
          '0%':   { backgroundPosition: '200% 50%' },
          '100%': { backgroundPosition: '-200% 50%' },
        },
        'pulse-ring': {
          '0%':   { transform: 'scale(1)', opacity: '0.7' },
          '100%': { transform: 'scale(2.2)', opacity: '0' },
        },
      },
      animation: {
        'slide-in': 'slide-in 0.25s ease-out',
        'slide-in-left': 'slide-in-left 0.2s ease-out',
        'fade-in-up': 'fade-in-up 0.3s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        'scale-in': 'scale-in 0.25s ease-out',
        'shimmer': 'shimmer 1.4s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 1.8s ease-out infinite',
      },
    },
  },
  plugins: [],
};
