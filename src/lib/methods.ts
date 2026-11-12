import { baseName, loadNote, saveNote } from './platform'
import { loadEveryday, stretchesOf, termLinks, termsOf, type Term } from './insight'

// Study methods with a long record of working, made from the book you are reading: memorising a passage by
// taking its words away a few at a time, blurting (writing all you remember, then checking), SQ3R (turning the
// headings into questions before reading), learning the terms in the order the book builds them, mnemonics for a
// list, and past exam questions matched to the pages that answer them.

// ── Cards made by these methods: they come up in Review with the others (see review.ts) ──
export type StudyCard = { front: string; back: string; place?: string; made: number }
const CARDS = 'study-cards.json'
export async function studyCards(book: string): Promise<StudyCard[]> {
  try { return JSON.parse((await loadNote(baseName(book), CARDS)) ?? '[]') } catch { return [] }
}
export async function addStudyCards(book: string, cards: Omit<StudyCard, 'made'>[]) {
  const kept = await studyCards(book)
  const fresh = cards.filter(card => card.front.trim() && card.back.trim() && !kept.some(old => old.front === card.front))
  await saveNote(baseName(book), CARDS, JSON.stringify([...kept, ...fresh.map(card => ({ ...card, made: Date.now() }))], null, 1))
  return fresh.length
}

// ── Memorise a passage: its words taken away a few more at each step ──
// Step 0 shows everything; 1 hides one word in four; 2 one in two; 3 leaves only first letters; 4 hides it all.
// The words hidden first are the longer ones, which carry the meaning; little words go last.
export type Shown = { text: string; word: boolean; hidden: boolean; hint: string }
export function fade(text: string, step: number): Shown[] {
  const pieces = text.match(/[\p{L}\p{N}'’-]+|[^\p{L}\p{N}'’-]+/gu) ?? []
  const words = pieces.map((piece, i) => ({ piece, i })).filter(({ piece }) => /[\p{L}\p{N}]/u.test(piece))
  // The order words are taken away in: every other one by a fixed stride, longer ones first within each round.
  const order = [...words].sort((a, b) => (a.i % 4) - (b.i % 4) || b.piece.length - a.piece.length || a.i - b.i).map(({ i }) => i)
  const share = [0, 0.25, 0.5, 1, 1][Math.max(0, Math.min(4, step))]
  const gone = new Set(order.slice(0, Math.round(order.length * share)))
  return pieces.map((piece, i) => {
    const word = /[\p{L}\p{N}]/u.test(piece)
    return { text: piece, word, hidden: word && gone.has(i), hint: step === 3 ? piece[0] : '' }
  })
}

// ── SQ3R: each heading turned into the question its section answers ──
export function questionFor(heading: string): string {
  const plain = heading.replace(/^(chapter|section|part|unit|lecture)\s+\w+[.:]?\s*/i, '').replace(/^\d+(\.\d+)*[.)]?\s*/, '').replace(/[:.]+$/, '').trim()
  if (!plain) return ''
  if (/\?$/.test(plain)) return plain
  if (/^(introduction|overview|summary|conclusions?|references|bibliography|appendix|acknowledg|exercises|questions|further reading|index|contents|preface|foreword)/i.test(plain)) return ''
  // Headings that already ask, put in the order of a question: "What a cell is" → "What is a cell?",
  // "How cells divide" → "How do cells divide?", "How a cell divides" → "How does a cell divide?".
  const asks = plain.match(/^(what|who|where|when|which)\s+(.+?)\s+(is|are|was|were)$/i)
  if (asks) return `${asks[1]} ${asks[3]} ${asks[2]}?`
  const how = plain.match(/^(how|why|when|where)\s+(.+?)\s+(\p{L}+)$/iu)
  if (how && !/^(do|does|did|is|are|can|will|should)$/i.test(how[2].split(' ')[0])) {
    const [, word, subject, verb] = how
    const single = /^(a|an|the|this|its|each|every)\s/i.test(subject) && !/s$/i.test(subject) || /^(it|he|she)$/i.test(subject)
    return single && /[^s]s$/.test(verb) ? `${word} does ${subject} ${verb.replace(/es$/, /(sh|ch|x|ss)es$/.test(verb) ? '' : 'e').replace(/e?s$/, '')}?`.replace(/ee\?$/, 'e?') : `${word} do ${subject} ${verb}?`
  }
  if (/^(how|why|what|when|where|which|who|is|are|can|does|do)\b/i.test(plain)) return `${plain}?`
  // Lowered at the start, unless it is an acronym ("DNA") or a name.
  const low = (text: string) => (/^\p{Lu}[\p{Lu}\d]/u.test(text) ? text : text[0].toLowerCase() + text.slice(1))
  const lower = low(plain)
  // "Energy: the mitochondria" → "How does the mitochondria relate to energy?"
  const [topic, detail] = plain.split(/\s*:\s*/)
  if (detail) return /^(how|why|what|when|where|which|who)\b/i.test(detail) ? `${detail[0].toUpperCase()}${detail.slice(1)}?` : `How does ${low(detail)} relate to ${low(topic)}?`
  // "Plant and animal cells compared" → "How do plant and animal cells compare?"
  if (/\b(compared|comparison|vs\.?|versus)\b/i.test(plain)) return `How do ${lower.replace(/\s*(compared|comparison)$/i, '').replace(/\s+(vs\.?|versus)\s+/i, ' and ')} compare?`
  if (/\b(of|in|for|and|between)\b/i.test(plain) && /\b(types?|kinds?|forms?|causes?|effects?|properties|functions?|roles?|principles?|methods?|stages?|steps?)\b/i.test(plain)) return `What are the ${lower.replace(/^the\s+/i, '')}?`
  if (/ing\b/.test(plain.split(' ')[0])) return `How does ${lower} work?`
  const words = plain.split(' ')
  const plural = /[^su]s$/i.test(words.at(-1)!) && !/(ss|us|is|sis)$/i.test(words.at(-1)!)
  // One word needs no "the" ("What is diffusion?"); a phrase does ("What is the cell membrane?").
  const named = /^(the|a|an)\s/i.test(plain) || words.length === 1 ? lower : `the ${lower}`
  return `What ${plural ? 'are' : 'is'} ${named}${words.length <= 4 ? ', and why does it matter' : ''}?`
}

// ── Learn in order: each key term after the ones it builds on ──
// A term builds on another when the book brings the other in first and keeps using the two together.
export type Step = { term: Term; first: number; after: string[] }
const firstPage = (term: Term) => Math.min(...term.everywhere.map(place => Number(place.match(/\d+/)?.[0] ?? 0)))
export async function learningOrder(book: string, most = 16): Promise<Step[]> {
  const terms = (await termsOf(book, 36)).slice(0, most)
  const links = termLinks(terms, 120)
  const steps = terms.map(term => ({ term, first: firstPage(term), after: [] as string[] }))
  const byName = new Map(steps.map(step => [step.term.term, step]))
  for (const link of links) {
    const a = byName.get(link.source)!, b = byName.get(link.target)!
    if (!a || !b || a.first === b.first) continue
    const [earlier, later] = a.first < b.first ? [a, b] : [b, a]
    if (later.after.length < 3) later.after.push(earlier.term.term)
  }
  return steps.sort((a, b) => a.first - b.first || b.term.count - a.term.count)
}
// The same order as a Mermaid diagram: an arrow from each term to the terms that build on it.
export function orderDiagram(steps: Step[]): string {
  const id = new Map(steps.map((step, i) => [step.term.term, `t${i}`]))
  const quote = (text: string) => `"${text.replace(/"/g, "'")}"`
  const lines = ['graph TD', ...steps.map(step => `  ${id.get(step.term.term)}[${quote(step.term.term)}]`)]
  for (const step of steps) for (const before of step.after) lines.push(`  ${id.get(before)} --> ${id.get(step.term.term)}`)
  return lines.join('\n')
}

// ── Mnemonics for a list: its first letters as a word, and a sentence whose words start with them ──
export async function mnemonicFor(items: string[]): Promise<{ letters: string; sentence: string[] }> {
  const letters = items.map(item => item.trim().match(/\p{L}/u)?.[0]?.toUpperCase() ?? '').join('')
  await loadEveryday()
  const { default: words } = await import('./common-words.json')
  // Vivid, everyday words: nouns, verbs and adjectives of four letters or more from the most spoken words.
  const pool = (words as string[]).slice(80, 6000).filter(word => word.length >= 4 && /^[a-z]+$/.test(word))
  const used = new Set<string>()
  const sentence = letters.split('').map((letter, i) => {
    const fits = pool.filter(word => word[0] === letter.toLowerCase() && !used.has(word))
    // Picked by the item itself, so the same list gives the same sentence, and a new one on asking again.
    const pick = fits[(items[i].length * 7 + i * 13 + seed) % Math.max(1, fits.length)] ?? letter
    used.add(pick)
    return pick[0].toUpperCase() + pick.slice(1)
  })
  return { letters, sentence }
}
let seed = 0
export const newMnemonicSeed = () => { seed += 17 }

// ── Past exam questions, each matched with the pages that answer it ──
// The paper's text is cut where a question starts: "1.", "Q2", "Question 3", "(a)" at the start of a line.
export function examQuestions(text: string): string[] {
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean)
  const starts = /^(?:Q(?:uestion)?\s*\d+[.:)]?|\d{1,2}[.)]\s|\(?[a-h]\)\s|[ivx]{1,4}[.)]\s)/i
  const out: string[] = []
  for (const line of lines) {
    if (starts.test(line) || !out.length) out.push(line)
    else out[out.length - 1] += ` ${line}`
  }
  return out.map(question => question.replace(/\s+/g, ' ').replace(/\[\s*\d+\s*marks?\s*\]|\(\s*\d+\s*marks?\s*\)/gi, '').trim())
    .filter(question => question.split(' ').length >= 5 && /\p{L}{3}/u.test(question)).slice(0, 80)
}
export async function textOfPdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const pages: string[] = []
  for (let number = 1; number <= Math.min(pdf.numPages, 60); number++) {
    const content = await (await pdf.getPage(number)).getTextContent()
    let line = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      line += item.str
      if (item.hasEOL) { pages.push(line); line = '' } else if (!/\s$/.test(item.str)) line += ' '
    }
    if (line) pages.push(line)
  }
  return pages.join('\n')
}
// The books whose words are kept, to match questions against.
export const booksWithWords = async (books: string[]) => (await Promise.all(books.map(async book => ((await stretchesOf(book)).length ? book : null)))).filter((book): book is string => !!book)
