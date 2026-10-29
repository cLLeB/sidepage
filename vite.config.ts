import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Relative paths, so the same build runs in Tauri, at a site root, or under a sub-path such as GitHub Pages.
  base: './',
  // The version, shown in the More menu (asked for when something goes wrong).
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '') },
  plugins: [
    react(),
    // Installable web app for phones, tablets, iPads and Chromebooks; works offline once opened.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'excalidraw/**/*', 'libarchive/*', 'djvu/*'],
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // The speech and meaning engine (ONNX Runtime, 27 MB) is fetched only when those are first used.
        globIgnores: ['**/ort-wasm*', 'docs/**'],
        // The documentation under docs/ is its own site: the app must not answer for its pages.
        navigateFallbackDenylist: [/\/docs\//],
        // A new version takes over as soon as it is fetched, in every open page, and reloads documentation pages
        // an older version had answered with the app (see public/sw-docs.js).
        skipWaiting: true,
        clientsClaim: true,
        importScripts: ['sw-docs.js'],
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
      'jszip', 'docx-preview', 'page-flip', 'pdfjs-dist',
      'pdfjs-dist/web/pdf_viewer.mjs', '@excalidraw/excalidraw', 'mind-elixir',
      '@milkdown/crepe', '@milkdown/kit/utils', '@milkdown/kit/core', '@milkdown/kit/prose/state', '@milkdown/kit/component/image-block',
      'idb-keyval', 'dockview-react', 'rtf.js', 'odf-kit/odt/to-html', 'dompurify', 'libarchive.js', '@file-viewer/doc', '@extend-ai/react-pptx', 'react-error-boundary', 'force-graph', 'ts-fsrs', 'lucide-react',
    ],
  },
})
