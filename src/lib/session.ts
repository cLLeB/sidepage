import { baseName, loadNote } from './platform'
import { progressOf, spentOn } from './reading'

// A sitting with a book: what stood when it was opened, so that when it is closed the difference can be told:
// time spent, how far read, highlights and notes added, cards answered.
type Snapshot = { file: string; at: number; spent: number; progress: number; highlights: number; words: number; answers: number }
export type Sitting = { file: string; minutes: number; from: number; to: number; highlights: number; words: number; answers: number }

const open = new Map<string, Snapshot>()
const words = (text: string | null) => (text ?? '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0
async function snapshot(file: string): Promise<Snapshot> {
  const notebook = baseName(file)
  const [highlights, notes, answers] = await Promise.all([loadNote(notebook, 'highlights.json'), loadNote(notebook, 'notes.md'), loadNote('_review', 'answers.json')])
  return {
    file, at: Date.now(), spent: spentOn(file), progress: progressOf(file),
    highlights: JSON.parse(highlights ?? '[]').length, words: words(notes), answers: JSON.parse(answers ?? '[]').length,
  }
}
export const beginSitting = (file: string) => { if (!open.has(file)) void snapshot(file).then(found => open.set(file, found)) }
export async function endSitting(file: string): Promise<Sitting | null> {
  const before = open.get(file)
  open.delete(file)
  if (!before) return null
  const after = await snapshot(file)
  const sitting = {
    file,
    minutes: Math.round(Math.max(after.spent - before.spent, 0)),
    from: before.progress, to: after.progress,
    highlights: Math.max(0, after.highlights - before.highlights),
    words: Math.max(0, after.words - before.words),
    answers: Math.max(0, after.answers - before.answers),
  }
  // Worth telling only if something happened.
  return sitting.minutes >= 1 || sitting.highlights || sitting.words >= 5 || sitting.to - sitting.from >= 0.01 ? sitting : null
}
