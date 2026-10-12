import { useSyncExternalStore } from 'react'

// Small choices remembered on this device (an accent colour, how warm the screen is), shared by every part of
// the app that shows them: change one anywhere and everything using it follows.
const listeners = new Set<() => void>()
const known = new Map<string, unknown>()

export function getPref<T>(key: string, fallback: T): T {
  if (!known.has(key)) {
    const saved = localStorage.getItem(`sidepage:${key}`)
    let value: unknown = fallback
    if (saved !== null) try { value = JSON.parse(saved) } catch { /* an older, plain value: keep the default */ }
    known.set(key, value)
  }
  return known.get(key) as T
}

export function setPref<T>(key: string, value: T) {
  known.set(key, value)
  localStorage.setItem(`sidepage:${key}`, JSON.stringify(value))
  listeners.forEach(listener => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function usePref<T>(key: string, fallback: T): [T, (value: T) => void] {
  const value = useSyncExternalStore(subscribe, () => getPref(key, fallback))
  return [value, next => setPref(key, next)]
}

// The one colour the app is accented with. "Graphite" leaves each theme its own quiet grey.
export const ACCENTS = { graphite: '', blue: '#2f6fed', teal: '#0c8f9c', green: '#1f9d6b', amber: '#c77d00', rose: '#d6456b' } as const
export type Accent = keyof typeof ACCENTS
export function applyAccent(accent: Accent) {
  const root = document.documentElement.style
  if (ACCENTS[accent]) { root.setProperty('--accent', ACCENTS[accent]); root.setProperty('--on-accent', '#fff') }
  else { root.removeProperty('--accent'); root.removeProperty('--on-accent') }
}
applyAccent(getPref<Accent>('accent', 'graphite'))
