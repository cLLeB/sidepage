import { useSyncExternalStore } from 'react'

export const THEMES = ['light', 'sepia', 'dark'] as const
export type Theme = (typeof THEMES)[number]

const listeners = new Set<() => void>()
export const currentTheme = (): Theme => (localStorage.getItem('sidepage:theme') as Theme) || 'light'

export function setTheme(theme: Theme) {
  localStorage.setItem('sidepage:theme', theme)
  document.documentElement.dataset.theme = theme
  listeners.forEach(listener => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// The reading theme, shared by every reader and note so the whole workspace changes together.
export const useTheme = () => useSyncExternalStore(subscribe, currentTheme)

// How a page that is already drawn (a PDF page, say) is shaded for each theme. Dark turns the page light-on-dark;
// pictures on it are then turned back (see PdfView), so photographs keep their real colours.
export const pageFilter = (theme: Theme) =>
  theme === 'dark' ? 'invert(1) hue-rotate(180deg)' : theme === 'sepia' ? 'sepia(0.35) brightness(0.97)' : 'none'

document.documentElement.dataset.theme = currentTheme()
