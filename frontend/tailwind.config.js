/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Sarabun', 'sans-serif'],
      },
      colors: {
        // Civic Navy — the structural / brand colour of the app shell
        // (sidebar, rail, brand surfaces). Deliberately separate from
        // `brand`, which stays the *action* colour (buttons, selected
        // state, links). Structure vs action must not share one token.
        navy: {
          DEFAULT: '#123B6D',
          50:  '#F1F5FA',
          100: '#DDE7F2',
          200: '#BCCDE4',
          300: '#8FA9CC',
          400: '#5C7FAE',
          500: '#2E5B92',
          600: '#1B4A7E',
          700: '#123B6D',
          800: '#0E2F58',
          900: '#0A2342',
          950: '#06172D',
        },
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
        // Drawer / modal surfaces sit above the page, so they carry the only
        // heavier shadow in the system. Still soft — no dramatic elevation.
        overlay: '0 16px 40px -12px rgb(10 35 66 / 0.28), 0 4px 12px -4px rgb(10 35 66 / 0.16)',
      },
      // Named z-index scale. Ad-hoc z-40/z-50 across files made drawer vs
      // modal vs toast ordering guesswork; these are the only layers.
      zIndex: {
        sticky:  '20',
        rail:    '30',
        drawer:  '40',
        modal:   '50',
        toast:   '60',
      },
      // Shell metrics referenced by Layout/Sidebar/TopNavbar so the numbers
      // live in one place instead of being re-typed per component.
      spacing: {
        sidebar:          '15rem',  // 240px — expanded sidebar
        'sidebar-rail':   '4.5rem', // 72px  — collapsed icon rail
        topbar:           '3.75rem',// 60px  — top navbar height
      },
      fontSize: {
        // Smallest size allowed on meaningful content (12px). Anything below
        // is decorative only.
        caption: ['0.75rem', { lineHeight: '1rem' }],
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
