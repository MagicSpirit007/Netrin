import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { netrinAppearanceDevPlugin } from './scripts/appearance-dev-plugin'

// netrin-cell — Vite + React, PWA-primary (platform.primarySurface = "mobile-web").
// This vite.config.ts stands in for app.json per Cell Contract Rule 3 (non-Expo cell).
const appBase = '/netrin/'

export default defineConfig({
  base: appBase,
  build: {
    modulePreload: {
      resolveDependencies: (_filename, dependencies) => dependencies.filter((dependency) =>
        !/(?:^|\/)(?:ai-pdf|ai-docx|docxPreprocess\.worker|pdf\.worker)[^/]*\.(?:js|mjs)$/.test(dependency)
      )
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          const moduleId = id.replaceAll('\\', '/')
          if (/\/node_modules\/(?:react|react-dom|react-router|react-router-dom|scheduler)\//.test(moduleId)) return 'vendor-react'
          if (moduleId.includes('/node_modules/@supabase/')) return 'vendor-supabase'
          if (moduleId.includes('/node_modules/@turf/')) return 'vendor-turf'
          if (moduleId.includes('/node_modules/i18next/') || moduleId.includes('/node_modules/react-i18next/')) return 'vendor-i18n'
          if (moduleId.includes('/node_modules/localforage/')) return 'vendor-storage'
          if (moduleId.includes('/node_modules/@amap/')) return 'vendor-amap'
          if (moduleId.includes('/node_modules/pdfjs-dist/')) return 'ai-pdf'
          if (moduleId.includes('/node_modules/mammoth/')) return 'ai-docx'
          if (
            moduleId.includes('/node_modules/fflate/') ||
            moduleId.includes('/node_modules/postcss/') ||
            moduleId.includes('/node_modules/postcss-selector-parser/') ||
            moduleId.includes('/node_modules/postcss-value-parser/')
          ) return 'vendor-appearance'
          return undefined
        }
      }
    }
  },
  plugins: [
    netrinAppearanceDevPlugin(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        // Precache app shell only. Never runtime-cache AMap basemap/tiles or other CDNs.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,txt}'],
        globIgnores: [
          '**/ai-pdf-*.js',
          '**/ai-docx-*.js',
          '**/docxPreprocess.worker-*.js',
          '**/pdf.worker*'
        ],
        runtimeCaching: []
      },
      manifest: false
    })
  ]
})
