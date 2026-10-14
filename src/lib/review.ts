import { createEmptyCard, fsrs, Rating, type Card, type Grade } from 'ts-fsrs'
import { baseName, loadNote, saveNote, shelf } from './platform'
import { pictureCardsOf, type Box } from '../notes/PictureCards'
import { termsOf } from './insight'

// Flashcards, made from what the reader has already written rather than typed in again:
//   • every highlight in a book: the passage on the front, the reader's comment on the back
//   • every "Q: …" line in the written notes, with the "A: …" line after it as the answer
// When each card comes up again is decided by FSRS (ts-fsrs), from how well it was remembered.
//   • every box drawn over a picture: the picture with that box covered, then uncovered
export type Flashcard = { id: string; book: string; front: string; back: string; place?: string; picture?: { notebook: string; file: string; boxes: Box[]; ask: number } }
export { Rating }

type Highlight = { cfi: string; text: string; note?: string }
const SCHEDULE = ['_review', 'schedule.json'] as const
const scheduler = fsrs()

// A short, stable name for a card, so its schedule survives the notes being edited around it.
const idOf = (text: string) => {
  let hash = 5381
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  return (hash >>> 0).toString(36)
}

export async function allCards(): Promise<Flashcard[]> {
  const cards: Flashcard[] = []
  for (const book of await shelf()) {
    const notebook = baseName(book.name)
    const highlights: Highlight[] = JSON.parse((await loadNote(notebook, 'highlights.json')) ?? '[]')
    // A highlight with a comment: the passage, then the comment. Without one, the book's weightiest term in the
    // passage is taken out of it, to be recalled.
    const terms = highlights.some(mark => !mark.note?.trim()) ? (await termsOf(book.name).catch(() => [])).map(term => term.term) : []
    for (const mark of highlights) {
      if (mark.note?.trim()) { cards.push({ id: idOf(`${book.name}|${mark.cfi}`), book: book.name, front: mark.text, back: mark.note.trim(), place: mark.cfi }); continue }
      const lower = mark.text.toLowerCase()
      const term = terms.find(name => new RegExp(`(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'iu').test(lower))
      if (!term) { cards.push({ id: idOf(`${book.name}|${mark.cfi}`), book: book.name, front: mark.text, back: '', place: mark.cfi }); continue }
      const at = lower.indexOf(term.toLowerCase())
      cards.push({
        id: idOf(`${book.name}|${mark.cfi}|C`), book: book.name, place: mark.cfi,
        front: `${mark.text.slice(0, at)}［ … ］${mark.text.slice(at + term.length)}`, back: mark.text.slice(at, at + term.length),
      })
    }
    const lines = ((await loadNote(notebook, 'notes.md')) ?? '').split('\n').map(line => line.replace(/<\/?(?:span|u|sup|sub|div)\b[^>]*>/g, '').replace(/^[\s>*\-+]+/, '').trim())
    // Words run over with the marker in the notes: the line with those words hidden, then shown.
    for (const raw of ((await loadNote(notebook, 'notes.md')) ?? '').split('\n')) {
      const marked = [...raw.matchAll(/<span style="background-color:[^"]+">(.+?)<\/span>/g)]
      if (!marked.length) continue
      const plain = (text: string) => text.replace(/<\/?(?:span|u|sup|sub|div)\b[^>]*>/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').replace(/^[\s>#\-+\d.]+/, '').trim()
      for (const [whole, words] of marked) {
        const hidden = plain(words)
        if (!hidden) continue
        const front = plain(raw.replace(whole, '［ … ］'))
        cards.push({ id: idOf(`${book.name}|C|${front}|${hidden}`), book: book.name, front, back: hidden })
      }
    }
    lines.forEach((line, i) => {
      const question = line.match(/^Q[:.]\s*(.+)/i)?.[1]
      const answer = lines.slice(i + 1).find(Boolean)?.match(/^A[:.]\s*(.+)/i)?.[1]
      if (question && answer) cards.push({ id: idOf(`${book.name}|Q|${question}`), book: book.name, front: question, back: answer })
    })
    for (const set of await pictureCardsOf(notebook)) {
      set.boxes.forEach((box, ask) => cards.push({
        id: idOf(`${book.name}|P|${set.id}|${ask}`), book: book.name, front: set.source, back: box.label ?? '', place: set.place,
        picture: { notebook, file: set.file, boxes: set.boxes, ask },
      }))
    }
  }
  return cards
}

type Schedule = Record<string, Card>
async function loadSchedule(): Promise<Schedule> {
  const saved: Schedule = JSON.parse((await loadNote(...SCHEDULE)) ?? '{}')
  // Dates come back from storage as text.
  for (const card of Object.values(saved)) {
    card.due = new Date(card.due)
    if (card.last_review) card.last_review = new Date(card.last_review)
  }
  return saved
}

// The cards to go through now: those never seen, and those whose time has come. Soonest due first.
export async function dueCards(): Promise<{ due: Flashcard[]; total: number }> {
  const [cards, schedule] = await Promise.all([allCards(), loadSchedule()])
  const now = Date.now()
  const due = cards
    .filter(card => !schedule[card.id] || schedule[card.id].due.getTime() <= now)
    .sort((a, b) => (schedule[a.id]?.due.getTime() ?? 0) - (schedule[b.id]?.due.getTime() ?? 0))
  return { due, total: cards.length }
}

// Record how well a card was remembered; returns when it will come up next.
export async function grade(card: Flashcard, rating: Grade): Promise<Date> {
  const schedule = await loadSchedule()
  const next = scheduler.next(schedule[card.id] ?? createEmptyCard(), new Date(), rating).card
  schedule[card.id] = next
  await saveNote(...SCHEDULE, JSON.stringify(schedule))
  // Every answer is written down too (when, and how it went), for the picture of how learning is going.
  const log: Answer[] = JSON.parse((await loadNote(SCHEDULE[0], 'answers.json')) ?? '[]')
  log.push({ at: Date.now(), rating })
  await saveNote(SCHEDULE[0], 'answers.json', JSON.stringify(log.slice(-5000)))
  return next.due
}

type Answer = { at: number; rating: number }

// How learning is going: the cards by how well they are known, how many fall due on each of the coming days,
// and how often cards were remembered, week by week.
export type Progress = {
  fresh: number; learning: number; known: number; total: number
  ahead: { day: Date; due: number }[]
  weeks: { from: Date; answered: number; remembered: number }[]
  remembered: number; answered: number; streak: number
}
export async function learningProgress(days = 14): Promise<Progress> {
  const [cards, schedule] = await Promise.all([allCards(), loadSchedule()])
  const log: Answer[] = JSON.parse((await loadNote(SCHEDULE[0], 'answers.json')) ?? '[]')
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
  let fresh = 0, learning = 0, known = 0
  const ahead = Array.from({ length: days }, (_, i) => ({ day: new Date(midnight.getTime() + i * 86_400_000), due: 0 }))
  for (const card of cards) {
    const state = schedule[card.id]
    if (!state) { fresh++; ahead[0].due++; continue }
    // "Known": it stays in mind three weeks or more before it needs seeing again.
    if (state.stability >= 21) known++
    else learning++
    const index = Math.max(0, Math.floor((state.due.getTime() - midnight.getTime()) / 86_400_000))
    if (index < days) ahead[index].due++
  }
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const from = new Date(midnight.getTime() - (7 - i) * 7 * 86_400_000)
    const to = from.getTime() + 7 * 86_400_000
    const inside = log.filter(answer => answer.at >= from.getTime() && answer.at < to)
    return { from, answered: inside.length, remembered: inside.filter(answer => answer.rating !== Rating.Again).length }
  })
  // Days in a row with at least one card answered.
  const dayOf = (at: number) => new Date(at).toDateString()
  const answeredOn = new Set(log.map(answer => dayOf(answer.at)))
  let streak = 0
  for (let i = answeredOn.has(midnight.toDateString()) ? 0 : 1; answeredOn.has(dayOf(midnight.getTime() - i * 86_400_000)); i++) streak++
  return {
    fresh, learning, known, total: cards.length, ahead, weeks,
    answered: log.length, remembered: log.filter(answer => answer.rating !== Rating.Again).length, streak,
  }
}
