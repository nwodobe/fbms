import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'LBA Control',
        short_name: 'LBA Control',
        description:
          "Gestion des opérations d'achat agricole : financements, pisteurs, achats, stocks, transferts, TCB et marges.",
        theme_color: '#1f6f43',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'fr',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Le shell applicatif est mis en cache ; les données métier ne le sont
        // jamais ici. Elles passent par Dexie, qui gère explicitement la file
        // de synchronisation — un cache HTTP silencieux masquerait des écritures
        // non synchronisées.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/rest/v1/'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // Séparé : ExcelJS et jsPDF pèsent lourd et ne servent qu'aux exports.
          exports: ['exceljs', 'jspdf', 'jspdf-autotable'],
          charts: ['recharts'],
        },
      },
    },
  },
})
