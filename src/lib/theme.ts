import { useSyncExternalStore } from 'react'

// What the reader can choose, and what the app is then drawn in. "auto" follows the device's own light or dark
// setting, and changes with it.
// "black" is the dark theme on pure black (kind to OLED screens); for pages and pictures it is dark.
export const THEME_CHOICES = ['auto', 'light', 'sepia', 'dark', 'black'] as const
export type ThemeChoice = (typeof THEME_CHOICES)[number]
export type Theme = 'light' | 'sepia' | 'dark'

const deviceDark = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

export const currentChoice = (): ThemeChoice => (localStorage.getItem('sidepage:theme') as ThemeChoice) || 'light'
export const currentTheme = (): Theme => {
  const choice = currentChoice()
  return choice === 'auto' ? (deviceDark.matches ? 'dark' : 'light') : choice === 'black' ? 'dark' : choice
}
// What "Follow the device" comes to just now.
export const deviceIsDark = () => deviceDark.matches

const apply = () => {
  document.documentElement.dataset.theme = currentTheme()
  document.documentElement.dataset.shade = currentChoice() === 'black' ? 'black' : ''
  listeners.forEach(listener => listener())
}

export function setTheme(choice: ThemeChoice) {
  localStorage.setItem('sidepage:theme', choice)
  apply()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// The theme in use, shared by every reader and note so the whole workspace changes together.
export const useTheme = () => useSyncExternalStore(subscribe, currentTheme)
// The reader's choice, which may be "auto".
export const useThemeChoice = () => useSyncExternalStore(subscribe, currentChoice)

// How a page that is already drawn (a PDF page, say) is shaded for each theme. Dark turns the page light-on-dark;
// pictures on it are then turned back (see PdfView), so photographs keep their real colours.
export const pageFilter = (theme: Theme) =>
  theme === 'dark' ? 'invert(1) hue-rotate(180deg)' : theme === 'sepia' ? 'sepia(0.35) brightness(0.97)' : 'none'

deviceDark.addEventListener('change', apply)
document.documentElement.dataset.theme = currentTheme()
document.documentElement.dataset.shade = currentChoice() === 'black' ? 'black' : ''
