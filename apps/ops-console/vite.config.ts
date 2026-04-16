import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/auth/session': 'http://127.0.0.1:8079',
      '/auth/register-caller': 'http://127.0.0.1:8079',
      '/setup': 'http://127.0.0.1:8079',
      '/status': 'http://127.0.0.1:8079',
      '/healthz': 'http://127.0.0.1:8079',
      '/runtime': 'http://127.0.0.1:8079',
      '/catalog': 'http://127.0.0.1:8079',
      '/calls': 'http://127.0.0.1:8079',
      '/requests': 'http://127.0.0.1:8079',
      '/responder': 'http://127.0.0.1:8079',
      '/preferences': 'http://127.0.0.1:8079',
      '/caller': {
        target: 'http://127.0.0.1:8079',
        // Skip proxy for browser page navigations (Accept: text/html);
        // let Vite serve index.html so React Router handles the route.
        bypass(req) {
          if (req.headers.accept?.includes('text/html')) return '/index.html'
        },
      },
      '/debug': 'http://127.0.0.1:8079',
    },
  },
})
