/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb', // Primary Blue
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a', // Deep Blue
          950: '#172554',
        },
        success: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e', // Green Success
          600: '#16a34a',
        },
        error: {
          50: '#fef2f2',
          100: '#fee2e2',
          500: '#ef4444', // Red Error
          600: '#dc2626',
        },
        warning: {
          50: '#fff7ed',
          100: '#ffedd5',
          500: '#f97316', // Orange Warning
          600: '#ea580c',
        },
        enterprise: {
          bg: '#f8fafc',
          card: '#ffffff',
          border: '#e2e8f0',
          text: '#0f172a',
          muted: '#64748b',
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      boxShadow: {
        enterprise: '0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05)',
        'enterprise-md': '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',
        'enterprise-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -4px rgba(0, 0, 0, 0.05)',
      }
    },
  },
  plugins: [],
}
