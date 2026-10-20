import { loadNote, saveNote } from '../lib/platform'

// Where each quote and clip in a note came from (the book and its page or spot), kept in anchors.json beside the
// note rather than in it: the note holds only what was copied, and "keep pace with the book" still knows where
// each piece belongs. A quote is known again by its opening words, a clip by its picture's file.
export type Anchor = { kind: 'text' | 'picture'; key: string; book: string; place: string }
export const ANCHORS = 'anchors.json'
export const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

export async function anchorsOf(notebook: string): Promise<Anchor[]> {
  return JSON.parse((await loadNote(notebook, ANCHORS)) ?? '[]')
}
// Kept one after another, so two arriving together (a quote, then a clip) cannot overwrite each other.
let queue: Promise<unknown> = Promise.resolve()
export function addAnchor(notebook: string, anchor: Anchor) {
  queue = queue.then(() => keep(notebook, anchor)).catch(() => {})
  return queue
}
async function keep(notebook: string, anchor: Anchor) {
  if (!anchor.key || !anchor.place) return
  const known = (await anchorsOf(notebook)).filter(other => !(other.kind === anchor.kind && other.key === anchor.key))
  await saveNote(notebook, ANCHORS, JSON.stringify([...known, anchor].slice(-2000)))
}
