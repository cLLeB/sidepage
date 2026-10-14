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

// ── Highlights: passages the reader marked, kept with the book's notes as highlights.json ──
// A highlight in a book is addressed by its CFI. One in a PDF is addressed by its page, and also carries where
// on the page it lies (`rects`, as fractions of the page) so it can be drawn there again.
export type Highlight = { cfi: string; index: number; text: string; color?: string; note?: string; rects?: number[][] }
type Kind = 'book' | 'pdf'
const ofKind = (kind: Kind) => (mark: Highlight) => !!mark.rects === (kind === 'pdf')

export async function loadHighlights(notebook: string, kind: Kind): Promise<Highlight[]> {
  return (JSON.parse((await loadNote(notebook, 'highlights.json')) ?? '[]') as Highlight[]).filter(ofKind(kind))
}

// A book and a PDF of the same title share a notebook, so saving one kind leaves the other kind's in place.
export async function saveHighlights(notebook: string, kind: Kind, marks: Highlight[]) {
  const others = (JSON.parse((await loadNote(notebook, 'highlights.json')) ?? '[]') as Highlight[]).filter(mark => !ofKind(kind)(mark))
  await saveNote(notebook, 'highlights.json', JSON.stringify([...others, ...marks]))
}

// ── Time spent reading, counted by the day, for the home screen ──
const day = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const minutesOn = (date: Date) => Number(localStorage.getItem(`sidepage:time:${day(date)}`)) || 0
export const addReadingTime = (minutes: number) => localStorage.setItem(`sidepage:time:${day(new Date())}`, String(minutesOn(new Date()) + minutes))

export function readingStats() {
  const back = (days: number) => new Date(Date.now() - days * 86_400_000)
  const week = Array.from({ length: 7 }, (_, i) => minutesOn(back(i))).reduce((sum, minutes) => sum + minutes, 0)
  // Days in a row with some reading. Today not having started yet does not break a run.
  let streak = 0
  for (let i = minutesOn(back(0)) >= 1 ? 0 : 1; minutesOn(back(i)) >= 1; i++) streak++
  return { today: Math.round(minutesOn(back(0))), week: Math.round(week), streak }
}
export const asTime = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`)

// Minutes read on each of the last `days` days, oldest first: what the home screen's calendar is drawn from.
export const readingDays = (days: number) =>
  Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.now() - (days - 1 - i) * 86_400_000)
    return { date, minutes: Math.round(minutesOn(date)) }
  })

// Minutes spent with each book open and in front, which also tells roughly how long the rest will take.
export const spentOn = (fileName: string) => Number(localStorage.getItem(`sidepage:spent:${fileName}`)) || 0
export const addSpent = (fileName: string, minutes: number) => localStorage.setItem(`sidepage:spent:${fileName}`, String(spentOn(fileName) + minutes))
export const timeLeft = (fileName: string) => {
  const read = progressOf(fileName), spent = spentOn(fileName)
  return read > 0.05 && read < 0.97 && spent >= 5 ? Math.max(1, Math.round((spent * (1 - read)) / read)) : 0
}

// ── Reading plans: finish a book by a day, and know each day how far to read ──
// The day's target is worked out from where the book stood when the day began, so reading ahead today
// lightens tomorrow and a day missed is shared out over the days left.
import { getPref, setPref } from './prefs'
export type Plan = { by: string }
export const plans = () => getPref<Record<string, Plan>>('plans', {})
export const setPlan = (fileName: string, by: string | null) => {
  const all = { ...plans() }
  if (by) all[fileName] = { by }
  else delete all[fileName]
  setPref('plans', all)
}
const todayKey = () => day(new Date())
// Where the book stood when today began (taken the first time it is asked for today).
const startOfDay = (fileName: string) => {
  const key = `sidepage:plan-day:${fileName}`
  const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as { day: string; progress: number } | null
  if (saved?.day === todayKey()) return saved.progress
  const progress = progressOf(fileName)
  localStorage.setItem(key, JSON.stringify({ day: todayKey(), progress }))
  return progress
}
export type PlanToday = { by: Date; daysLeft: number; target: number; read: number; done: boolean; late: boolean }
export function planToday(fileName: string): PlanToday | null {
  const plan = plans()[fileName]
  if (!plan) return null
  const by = new Date(`${plan.by}T23:59:59`)
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
  const daysLeft = Math.ceil((by.getTime() - midnight.getTime()) / 86_400_000)
  const began = startOfDay(fileName)
  const read = progressOf(fileName)
  const target = daysLeft <= 0 ? 1 : Math.min(1, began + (1 - began) / daysLeft)
  return { by, daysLeft, target, read, done: read >= target - 0.002, late: daysLeft <= 0 && read < 0.97 }
}
