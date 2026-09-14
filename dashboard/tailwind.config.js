/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Design system tokens — Step 11
        base: '#14171C',
        surface: '#1C2129',
        border: '#2A2F38',
        'border-subtle': '#222831',
        
        // Status colors — ONLY for service/system health
        healthy: '#5FBF77',
        warning: '#E8A33D',
        critical: '#E5484D',
        
        // AI accent — ONLY for AI explanation panel and confidence
        signal: '#5B8DEF',
        
        // Text
        'text-primary': '#E8EAED',
        'text-secondary': '#9AA0A8',
        'text-muted': '#6B7280',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
