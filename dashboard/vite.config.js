import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3030,
    proxy: {
      '/api/faults': {
        target: process.env.VITE_GATEWAY_TARGET || 'http://frontend-gateway:3000',
        changeOrigin: true,
      },
      '/api': {
        target: process.env.VITE_ANALYSIS_TARGET || 'http://analysis-engine:3020',
        changeOrigin: true,
      },
    },
  },
});
