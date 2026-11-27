import { createRoot } from 'react-dom/client'
import './index.css'
import './lib/theme'
import './lib/language'
import App from './App.tsx'
import { isTauri } from './lib/platform'

// Excalidraw loads its fonts from here instead of a CDN, so the app works offline.
Object.assign(window, { EXCALIDRAW_ASSET_PATH: new URL('excalidraw/', document.baseURI).href })

// Offline support for the installed web app. The desktop shell already ships every file.
if (import.meta.env.PROD && !isTauri) void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }))

// A pinch on a touchpad arrives as the wheel turned with Ctrl held. Left to itself, the window would magnify as a
// whole and cut off its edges: only the page under the pointer zooms (see lib/pinch.ts), never the app.
document.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) e.preventDefault() }, { capture: true, passive: false })

// On a touch screen, a finger resting on the divider between two panels is a long press, which the divider took as
// a reason to let go mid-drag. The long press on the divider is never a menu: it keeps the drag going.
window.addEventListener('contextmenu', e => {
  if ((e.target as Element | null)?.closest?.('.dv-sash')) { e.preventDefault(); e.stopImmediatePropagation() }
}, { capture: true })

createRoot(document.getElementById('root')!).render(<App />)
