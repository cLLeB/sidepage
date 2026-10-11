import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { baseName, extensionOf, loadNote, saveNote } from './platform'

// ── Bookmarks: places the reader wants to come back to, kept with the book's notes. The file is named after
// the book's kind (bookmarks-pdf.json), so a PDF and an EPUB of the same title keep separate bookmarks. ──
export const bookmarksFile = (fileName: string) => `bookmarks-${extensionOf(fileName)}.json`
export type Bookmark = { place: string; label: string }

export function useBookmarks(fileName: string) {
  const notebook = baseName(fileName)
  const [list, setList] = useState<Bookmark[]>([])
  useEffect(() => {
    let cancelled = false
    void loadNote(notebook, bookmarksFile(fileName)).then(saved => { if (!cancelled) setList(saved ? JSON.parse(saved) : []) })
    return () => { cancelled = true }
  }, [notebook, fileName])
  const keep = useCallback((next: Bookmark[]) => {
    setList(next)
    void saveNote(notebook, bookmarksFile(fileName), JSON.stringify(next))
  }, [notebook, fileName])
  return {
    list,
    has: (place: string) => list.some(mark => mark.place === place),
    toggle: (mark: Bookmark) => keep(list.some(m => m.place === mark.place) ? list.filter(m => m.place !== mark.place) : [...list, mark]),
    remove: (place: string) => keep(list.filter(mark => mark.place !== place)),
  }
}

// ── How far into each book the reader is (0–1), shown on the home screen ──
export const setProgress = (fileName: string, fraction: number) =>
  localStorage.setItem(`sidepage:progress:${fileName}`, String(Math.max(0, Math.min(1, fraction))))
export const progressOf = (fileName: string) => Number(localStorage.getItem(`sidepage:progress:${fileName}`)) || 0

// ── A small picture of each book's cover, for the home screen ──
export async function saveCover(fileName: string, picture: Blob | HTMLCanvasElement | null | undefined) {
  if (!picture) return
  try {
    const source = picture instanceof Blob ? await createImageBitmap(picture) : picture
    const scale = Math.min(1, 320 / source.width)
    const small = document.createElement('canvas')
    small.width = Math.round(source.width * scale)
    small.height = Math.round(source.height * scale)
    small.getContext('2d')!.drawImage(source, 0, 0, small.width, small.height)
    const { set } = await import('idb-keyval')
    await set(`cover:${fileName}`, small.toDataURL('image/jpeg', 0.8))
  } catch {
    // A book without a usable cover simply shows none.
  }
}
export async function coverOf(fileName: string): Promise<string | undefined> {
  const { get } = await import('idb-keyval')
  return get<string>(`cover:${fileName}`)
}

// ── How book text is set: size, line spacing and typeface. One choice for every book. ──
export const FONTS = {
  book: { name: "The book's own", css: '' },
  serif: { name: 'Serif', css: "Georgia, 'Times New Roman', serif" },
  sans: { name: 'Sans-serif', css: "system-ui, 'Segoe UI', Roboto, sans-serif" },
  mono: { name: 'Typewriter', css: "'Courier New', ui-monospace, monospace" },
} as const
export type TextStyle = { size: number; spacing: number; font: keyof typeof FONTS }
const DEFAULT_TEXT: TextStyle = { size: 100, spacing: 1.6, font: 'book' }

let textStyle: TextStyle = { ...DEFAULT_TEXT, ...JSON.parse(localStorage.getItem('sidepage:text') ?? '{}') }
const listeners = new Set<() => void>()
export function setTextStyle(change: Partial<TextStyle>) {
  textStyle = { ...textStyle, ...change }
  textStyle.size = Math.max(70, Math.min(220, textStyle.size))
  textStyle.spacing = Math.max(1.2, Math.min(2.4, Math.round(textStyle.spacing * 10) / 10))
  localStorage.setItem('sidepage:text', JSON.stringify(textStyle))
  listeners.forEach(listener => listener())
}
export const useTextStyle = () => useSyncExternalStore(
  listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  () => textStyle,
)
