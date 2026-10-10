import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Excalidraw loads its fonts from here instead of a CDN, so the app works offline.
Object.assign(window, { EXCALIDRAW_ASSET_PATH: '/excalidraw/' })

createRoot(document.getElementById('root')!).render(<App />)
