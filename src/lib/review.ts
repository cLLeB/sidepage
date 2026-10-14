import { createEmptyCard, fsrs, Rating, type Card, type Grade } from 'ts-fsrs'
import { baseName, loadNote, saveNote, shelf } from './platform'
import { pictureCardsOf, type Box } from '../notes/PictureCards'

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
    for (const mark of highlights) {
      cards.push({ id: idOf(`${book.name}|${mark.cfi}`), book: book.name, front: mark.text, back: mark.note?.trim() || '', place: mark.cfi })
    }
    const lines = ((await loadNote(notebook, 'notes.md')) ?? '').split('\n').map(line => line.replace(/<\/?(?:span|u|sup|sub|div)\b[^>]*>/g, '').replace(/^[\s>*\-+]+/, '').trim())
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
  return next.due
}
