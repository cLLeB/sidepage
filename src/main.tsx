import { createRoot } from 'react-dom/client'
import './index.css'
import './lib/theme'
import App from './App.tsx'
import { isTauri } from './lib/platform'

// Excalidraw loads its fonts from here instead of a CDN, so the app works offline.
Object.assign(window, { EXCALIDRAW_ASSET_PATH: new URL('excalidraw/', document.baseURI).href })

// Offline support for the installed web app. The desktop shell already ships every file.
if (import.meta.env.PROD && !isTauri) void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }))

// Android draws the app under the status bar and the gesture bar. Where the system does not report how much
// room those take, a typical amount is kept clear so the top bar is not covered by the clock.
if (isTauri && /Android/i.test(navigator.userAgent)) {
  const probe = Object.assign(document.createElement('div'), { style: 'position:fixed;top:0;height:env(safe-area-inset-top);visibility:hidden' })
  document.body.append(probe)
  if (!probe.offsetHeight) document.documentElement.style.cssText += ';--safe-top:30px;--safe-bottom:18px'
  probe.remove()
}

createRoot(document.getElementById('root')!).render(<App />)
