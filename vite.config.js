import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { devAirtableProxy } from './devAirtableProxy.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      tailwindcss(),
      devAirtableProxy(env),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false,
        manifest: {
          name: 'FreeBird Recon',
          short_name: 'FB Recon',
          description: 'FreeBird Auto recon tracker — lot to front line',
          theme_color: '#0D2440',
          background_color: '#0D2440',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
      }),
    ],
  }
})
