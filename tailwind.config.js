/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
      },
      minHeight: { touch: '48px' },
      minWidth: { touch: '48px' },
      keyframes: {
        'slide-up': {
          '0%': { transform: 'translateY(110%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scan-line': {
          '0%, 100%': { top: '4%' },
          '50%': { top: '94%' },
        },
      },
      animation: {
        'slide-up': 'slide-up 0.28s cubic-bezier(0.2, 0.9, 0.3, 1) both',
        'fade-in': 'fade-in 0.18s ease-out both',
        'scan-line': 'scan-line 2.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
