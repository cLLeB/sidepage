import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Relative paths, so the same build runs in Tauri, at a site root, or under a sub-path such as GitHub Pages.
  base: './',
  plugins: [
    react(),
    // Installable web app for phones, tablets, iPads and Chromebooks; works offline once opened.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'excalidraw/**/*', 'libarchive/*'],
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      manifest: {
        name: 'Sidepage',
        short_name: 'Sidepage',
        description: 'Read books, documents and slides with your notes alongside',
        display: 'standalone',
        start_url: '.',
        background_color: '#f2f3f5',
        theme_color: '#2e3035',
        icons: [
          { src: 'icon-256.png', sizes: '256x256', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  // Tauri expects a fixed port and its own console output left alone.
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  optimizeDeps: {
    // The viewers load lazily; listing them stops Vite re-bundling mid-session.
    include: [
      'pptxviewjs', 'jszip', 'chart.js', 'docx-preview', 'page-flip', 'pdfjs-dist',
      'pdfjs-dist/web/pdf_viewer.mjs', '@excalidraw/excalidraw', 'mind-elixir',
      '@milkdown/crepe', '@milkdown/kit/utils', '@milkdown/kit/core', '@milkdown/kit/prose/state',
      'idb-keyval', 'dockview-react', 'rtf.js', 'odf-kit/odt/to-html', 'dompurify', 'libarchive.js',
    ],
  },
})
