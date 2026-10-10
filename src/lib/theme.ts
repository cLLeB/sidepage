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

document.documentElement.dataset.theme = currentTheme()
