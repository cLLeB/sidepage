import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isTauri } from './lib/platform'

// Excalidraw loads its fonts from here instead of a CDN, so the app works offline.
Object.assign(window, { EXCALIDRAW_ASSET_PATH: new URL('excalidraw/', document.baseURI).href })

// Offline support for the installed web app. The desktop shell already ships every file.
if (import.meta.env.PROD && !isTauri) void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }))

createRoot(document.getElementById('root')!).render(<App />)
