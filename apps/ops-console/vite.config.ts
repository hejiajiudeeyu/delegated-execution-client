import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const supervisorTarget = `http://127.0.0.1:${process.env.OPS_PORT_SUPERVISOR || '8079'}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/auth/session': supervisorTarget,
      '/auth/register-caller': supervisorTarget,
      '/setup': supervisorTarget,
      '/status': supervisorTarget,
      '/healthz': supervisorTarget,
      '/runtime': supervisorTarget,
      '/catalog': supervisorTarget,
      '/calls': supervisorTarget,
      '/requests': supervisorTarget,
      '/responder': supervisorTarget,
      '/preferences': supervisorTarget,
      '/caller': {
        target: supervisorTarget,
        // Skip proxy for browser page navigations (Accept: text/html);
        // let Vite serve index.html so React Router handles the route.
        bypass(req) {
          if (req.headers.accept?.includes('text/html')) return '/index.html'
        },
      },
      '/debug': supervisorTarget,
    },
  },
})
