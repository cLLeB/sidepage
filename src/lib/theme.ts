import { useSyncExternalStore } from 'react'

// What the reader can choose, and what the app is then drawn in. "auto" follows the device's own light or dark
// setting, and changes with it.
export const THEME_CHOICES = ['auto', 'light', 'sepia', 'dark'] as const
export type ThemeChoice = (typeof THEME_CHOICES)[number]
export type Theme = Exclude<ThemeChoice, 'auto'>

const deviceDark = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

export const currentChoice = (): ThemeChoice => (localStorage.getItem('sidepage:theme') as ThemeChoice) || 'light'
export const currentTheme = (): Theme => {
  const choice = currentChoice()
  return choice === 'auto' ? (deviceDark.matches ? 'dark' : 'light') : choice
}

const apply = () => {
  document.documentElement.dataset.theme = currentTheme()
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
