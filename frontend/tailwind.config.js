/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          900: '#050510',
          800: '#0A0A2E',
          700: '#1a1a2e',
          600: '#242448',
        },
        acid: {
          500: '#AAFF00',
          400: '#bef264',
          300: '#d9f99d',
        },
        cyan: {
          500: '#00F0FF',
        },
        magenta: {
          500: '#FF00E5',
        },
      },
      fontFamily: {
        heading: ['"Space Grotesk"', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in':  'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'blink':    'blink 1s step-end infinite',
        'pulse-cyan': 'pulseCyan 3s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:  { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(12px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        blink:   { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
        pulseCyan: {
          '0%,100%': { boxShadow: '0 0 20px rgba(0,240,255,0)' },
          '50%': { boxShadow: '0 0 30px rgba(0,240,255,0.1)' },
        },
      },
    },
  },
  plugins: [],
}