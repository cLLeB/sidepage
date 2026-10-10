import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Tauri expects a fixed port and its own console output left alone.
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  optimizeDeps: {
    // The viewers load lazily; listing them stops Vite re-bundling mid-session.
    include: [
      'pptxviewjs', 'jszip', 'chart.js', 'docx-preview', 'page-flip', 'pdfjs-dist',
      'pdfjs-dist/web/pdf_viewer.mjs', '@excalidraw/excalidraw', 'mind-elixir',
      '@milkdown/crepe', '@milkdown/kit/utils', '@milkdown/kit/core', '@milkdown/kit/prose/state',
      'idb-keyval', 'dockview-react',
    ],
  },
})
