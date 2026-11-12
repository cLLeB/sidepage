import { baseName, loadNote, saveNote } from './platform'
import { gistOf, sentencesOf, stretchesOf } from './insight'

// What the reader marks on pages as they study: how well they know each page, and the questions a passage left
// them with. Kept with the book's notes (page-marks.json), so it travels with backups and with the book.

export type Known = 1 | 2 | 3 // not yet, partly, well
export type OpenQuestion = { id: string; place: string; passage: string; question: string; asked: number; answered?: number }
export type PageMarks = { known: Record<string, Known>; questions: OpenQuestion[] }

const FILE = 'page-marks.json'
const kept = new Map<string, PageMarks>()
const listeners = new Set<(book: string) => void>()
export const onPageMarks = (listener: (book: string) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export async function pageMarksOf(book: string): Promise<PageMarks> {
  if (!kept.has(book)) {
    let marks: PageMarks = { known: {}, questions: [] }
    try { marks = { ...marks, ...JSON.parse((await loadNote(baseName(book), FILE)) ?? '{}') } } catch { /* a damaged file starts afresh */ }
    kept.set(book, marks)
  }
  return kept.get(book)!
}
async function change(book: string, edit: (marks: PageMarks) => PageMarks) {
  const next = edit(await pageMarksOf(book))
  kept.set(book, next)
  listeners.forEach(listener => listener(book))
  await saveNote(baseName(book), FILE, JSON.stringify(next, null, 1))
}
export const markKnown = (book: string, place: string, known: Known | null) => change(book, marks => {
  const next = { ...marks.known }
  if (known) next[place] = known
  else delete next[place]
  return { ...marks, known: next }
})
export const addQuestion = (book: string, question: Omit<OpenQuestion, 'id' | 'asked'>) =>
  change(book, marks => ({ ...marks, questions: [...marks.questions, { ...question, id: Date.now().toString(36), asked: Date.now() }] }))
export const answerQuestion = (book: string, id: string, answered: boolean) =>
  change(book, marks => ({ ...marks, questions: marks.questions.map(q => (q.id === id ? { ...q, answered: answered ? Date.now() : undefined } : q)) }))
export const dropQuestion = (book: string, id: string) =>
  change(book, marks => ({ ...marks, questions: marks.questions.filter(q => q.id !== id) }))

// ── A concordance: every use of some words in the book, each with the words either side, lined up ──
export type Use = { place: string; before: string; match: string; after: string }
export async function usesOf(book: string, words: string, most = 400): Promise<Use[]> {
  const wanted = words.trim().replace(/\s+/g, ' ')
  if (wanted.length < 2) return []
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}(?:s|es|ed|ing)?(?![\\p{L}\\p{N}])`, 'giu')
  const uses: Use[] = []
  for (const { place, text } of await stretchesOf(book)) {
    const flat = text.replace(/\s+/g, ' ')
    for (const match of flat.matchAll(pattern)) {
      const at = match.index!
      uses.push({ place, before: flat.slice(Math.max(0, at - 70), at).replace(/^\S*\s/, ''), match: match[0], after: flat.slice(at + match[0].length, at + match[0].length + 70).replace(/\s\S*$/, '') })
      if (uses.length >= most) return uses
    }
  }
  return uses
}

// ── Where the book explains something: the sentence that says what it is, or failing that where it first comes ──
export type Explained = { sentence: string; place: string; defines: boolean }
export async function whereExplained(book: string, words: string): Promise<Explained | null> {
  const name = words.trim().replace(/\s+/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (name.length < 2) return null
  // A sentence that defines opens with the words ("Diffusion is the…", "A biosensor refers to…"), or names them as
  // what something is called; "…because its electronics were better" only uses them.
  const defines = [
    new RegExp(`^(\\S+\\s){0,4}(an? |the )?${name}s? (is|are|means|refers to|denotes|stands for|is defined as|can be defined as) (an?|the|one|any|how|when|what|where|that|which|made|used|\\p{L}+(ed|ing|al|ive|ion|ity|ment|ness|ance|ence))\\b`, 'iu'),
    new RegExp(`(is|are) (called|known as|termed|named|defined as) (an? |the )?["“']?${name}`, 'iu'),
    new RegExp(`(we|they|scientists|engineers) call (this |it |these |them )?(an? |the )?["“']?${name}`, 'iu'),
    new RegExp(`\\p{L}{3,}( \\p{L}+){1,5} \\(${name}\\)`, 'iu'),
  ]
  const mentions = new RegExp(`(^|[^\\p{L}])${name}`, 'iu')
  let first: Explained | null = null
  for (const { place, text } of await stretchesOf(book)) {
    for (const sentence of sentencesOf(text)) {
      if (!mentions.test(sentence)) continue
      if (defines.some(pattern => pattern.test(sentence)) && sentence.length < 400) return { sentence, place, defines: true }
      first ??= { sentence, place, defines: false }
    }
  }
  return first
}

// ── Coming back to a book: what you were reading last time, in brief ──
// Each day a book is open, the pages read that day are noted (on this device). When the book is opened again a
// few days later, the last day's pages are summed up: their gist, so you pick up the thread.
type Visit = { day: string; from: number; to: number }
const visitKey = (book: string) => `sidepage:visits:${book}`
const today = () => new Date().toISOString().slice(0, 10)
export function noteVisit(book: string, page: number) {
  let visits: Visit[] = []
  try { visits = JSON.parse(localStorage.getItem(visitKey(book)) ?? '[]') } catch { /* starts afresh */ }
  const last = visits.at(-1)
  if (last?.day === today()) { last.from = Math.min(last.from, page); last.to = Math.max(last.to, page) }
  else visits.push({ day: today(), from: page, to: page })
  localStorage.setItem(visitKey(book), JSON.stringify(visits.slice(-30)))
}
export type Recap = { daysAgo: number; from: number; to: number; gist: string[] }
export async function recapOf(book: string): Promise<Recap | null> {
  let visits: Visit[] = []
  try { visits = JSON.parse(localStorage.getItem(visitKey(book)) ?? '[]') } catch { return null }
  const earlier = visits.filter(visit => visit.day !== today()).at(-1)
  if (!earlier) return null
  const daysAgo = Math.round((Date.parse(today()) - Date.parse(earlier.day)) / 86_400_000)
  if (daysAgo < 2) return null
  // The gist of the last pages read: a sentence or two from each, the last few pages at most.
  const gist: string[] = []
  for (let page = Math.max(earlier.from, earlier.to - 3); page <= earlier.to && gist.length < 5; page++) {
    gist.push(...(await gistOf(book, `page=${page}`, page === earlier.to ? 2 : 1)))
  }
  return gist.length ? { daysAgo, from: earlier.from, to: earlier.to, gist: gist.slice(0, 5) } : null
}

// ── How hard each page is to read, for the page map: the school grade of its text ──
export async function hardnessOf(book: string, pages: number): Promise<number[]> {
  const [{ default: readability }, stretches] = await Promise.all([import('text-readability'), stretchesOf(book)])
  const grades = new Array(pages).fill(0)
  for (const { place, text } of stretches) {
    const page = Number(place.match(/^page=(\d+)/)?.[1])
    if (!page || page > pages || text.split(' ').length < 60) continue
    grades[page - 1] = readability.fleschKincaidGrade(text)
  }
  return grades
}
