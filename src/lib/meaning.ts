import { shelf } from './platform'
import { askBooks, sentencesOf, stretchesOf, wordsOf, type Answer } from './insight'

// Asking by meaning: each passage of every book is turned into a list of numbers that stands for what it says
// (multilingual E5, an open model run on the device by transformers.js), so a question finds the passages that
// say the same thing in other words, or in another language. The model (about 120 MB) is fetched once; each
// book is read this way once and kept by the device.
const MODEL = 'Xenova/multilingual-e5-small'
type Embed = (texts: string[], options: object) => Promise<{ data: Float32Array; dims: number[] }>
let embedder: Promise<Embed> | null = null

function load(onStep: (step: string) => void): Promise<Embed> {
  if (!embedder) {
    embedder = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.allowLocalModels = false
      const seen = new Map<string, number>()
      const make = () => pipeline('feature-extraction', MODEL, {
        dtype: 'q8',
        progress_callback: (update: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (update.status !== 'progress' || !update.file || !update.total) return
          seen.set(update.file, (update.loaded ?? 0) / update.total)
          const share = [...seen.values()].reduce((sum, part) => sum + part, 0) / Math.max(seen.size, 1)
          onStep(`Fetching the meaning model… ${Math.round(share * 100)}%`)
        },
      })
      for (let attempt = 1; ; attempt++) {
        try { return await make() as unknown as Embed }
        catch (error) { if (attempt >= 3) throw error; await new Promise(resolve => setTimeout(resolve, 3000 * attempt)) }
      }
    })()
    embedder.catch(() => { embedder = null })
  }
  return embedder
}

const DIMS = 384
async function vectors(embed: Embed, texts: string[], kind: 'query' | 'passage'): Promise<Float32Array> {
  const out = new Float32Array(texts.length * DIMS)
  for (let i = 0; i < texts.length; i += 16) {
    const batch = texts.slice(i, i + 16).map(text => `${kind}: ${text}`)
    const { data } = await embed(batch, { pooling: 'mean', normalize: true })
    out.set(data, i * DIMS)
  }
  return out
}
const likeness = (a: Float32Array, at: number, b: Float32Array, bt = 0) => {
  let sum = 0
  for (let i = 0; i < DIMS; i++) sum += a[at * DIMS + i] * b[bt * DIMS + i]
  return sum
}

// A book's passages: its pages or sections, long ones cut into pieces of about 120 words.
type Piece = { place: string; text: string }
type Kept = { model: string; signature: string; pieces: Piece[]; vectors: Float32Array }
async function piecesOf(book: string): Promise<Piece[]> {
  const pieces: Piece[] = []
  for (const stretch of await stretchesOf(book)) {
    const words = stretch.text.split(/\s+/).filter(Boolean)
    for (let at = 0; at < words.length; at += 110) {
      const text = words.slice(at, at + 130).join(' ')
      if (text.length > 60) pieces.push({ place: stretch.place, text })
    }
  }
  return pieces
}

async function bookByMeaning(book: string, embed: Embed, onStep: (step: string) => void): Promise<Kept | null> {
  const { get, set } = await import('idb-keyval')
  const pieces = await piecesOf(book)
  if (!pieces.length) return null
  const signature = `${pieces.length}:${pieces.reduce((sum, piece) => sum + piece.text.length, 0)}`
  const kept = await get<Kept>(`meaning:${book}`)
  if (kept?.model === MODEL && kept.signature === signature) return kept
  const name = book.replace(/\.[^.]+$/, '')
  const out = new Float32Array(pieces.length * DIMS)
  for (let i = 0; i < pieces.length; i += 32) {
    onStep(`Reading ${name} for meaning… ${Math.round((i / pieces.length) * 100)}%`)
    out.set(await vectors(embed, pieces.slice(i, i + 32).map(piece => piece.text), 'passage'), i * DIMS)
  }
  const fresh: Kept = { model: MODEL, signature, pieces, vectors: out }
  await set(`meaning:${book}`, fresh)
  return fresh
}

const squashed = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

export async function askByMeaning(question: string, onStep: (step: string) => void, most = 8): Promise<Answer[]> {
  const embed = await load(onStep)
  const asked = vectors(embed, [question], 'query')
  // The pages that hold the question's own words count a little more: meaning first, the exact words as well.
  const byWords = await askBooks(question, 40).catch(() => [] as Answer[])
  const topWords = Math.max(...byWords.map(found => found.score), 1)
  const wordBonus = new Map(byWords.map(found => [`${found.book}|${found.place}`, 0.04 * found.score / topWords]))
  const found: { book: string; piece: Piece; score: number }[] = []
  for (const book of await shelf()) {
    const kept = await bookByMeaning(book.name, embed, onStep)
    if (!kept) continue
    const query = await asked
    kept.pieces.forEach((piece, i) => {
      let score = likeness(kept.vectors, i, query) + (wordBonus.get(`${book.name}|${piece.place}`) ?? 0)
      // As with asking by words: the page the question was copied from, and pages of questions, come last.
      if (squashed(question).length > 24 && squashed(piece.text).includes(squashed(question).slice(0, 48))) score -= 1
      else if ((piece.text.match(/\?/g)?.length ?? 0) >= 2) score -= 0.05
      found.push({ book: book.name, piece, score })
    })
  }
  onStep('Choosing the best passages…')
  const query = await asked
  const best: typeof found = []
  for (const hit of found.sort((a, b) => b.score - a.score)) {
    // Passages much further in meaning than the best one are left out rather than shown as answers.
    if (hit.score < found[0].score - 0.035) break
    // One answer from each page: the next best piece of a page already given adds little.
    if (best.some(other => other.book === hit.book && other.piece.place === hit.piece.place)) continue
    best.push(hit)
    if (best.length >= most) break
  }
  const words = [...new Set(wordsOf(question))]
  const answers: Answer[] = []
  for (const hit of best) {
    // The sentence of the passage closest in meaning to the question is the one shown.
    const sentences = sentencesOf(hit.piece.text)
    let sentence = hit.piece.text.split(/\s+/).slice(0, 45).join(' ') + ' …'
    if (sentences.length) {
      const each = await vectors(embed, sentences, 'passage')
      let top = 0
      sentences.forEach((_, i) => { if (likeness(each, i, query) > likeness(each, top, query)) top = i })
      sentence = sentences[top]
    }
    answers.push({ book: hit.book, place: hit.piece.place, sentence: sentence.length > 320 ? `${sentence.slice(0, 320)}…` : sentence, score: hit.score, words })
  }
  return answers
}
