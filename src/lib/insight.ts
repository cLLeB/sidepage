import { shelf } from './platform'
import type { Stretch } from './library'

// A study guide worked out from the words of the books themselves, on this device, with no service asked:
// the gist of a page, the terms a book turns on, and the places in your other books that speak of the same
// thing. It is arithmetic over words (how often, how rare), not understanding, so it points; it does not explain.

const STOP = new Set(('a about above after again against all also am an and any are as at be because been before being below between both but by can cannot ' +
  'could did do does doing down during each few for from further had has have having he her here hers herself him himself his how however i if in into is it its ' +
  'itself just may me might more most must my myself no nor not now of off on once one only or other our ours ourselves out over own same shall she should so some ' +
  'such than that the their theirs them themselves then there these they this those through thus to too two under until up upon us very was we were what when where ' +
  'which while who whom why will with within without would you your yours yourself yourselves been being get got like many much new see use used using well ' +
  'page chapter figure table fig also et al ie eg vs per ' +
  // The small change of reference lists, which would otherwise pass for a book's favourite words.
  'vol doi art pp no ed eds rev nat adv mater eng med sci proc ieee int conf trans http https www org com pdf isbn issn press univ journal accessed retrieved available online jan feb mar apr jun jul aug sep sept oct nov dec').split(' '))

// Words that carry meaning, in the order written. A light stemmer folds plurals and "-ing"/"-ed" together.
const stem = (word: string) => word.replace(/(ies)$/, 'y').replace(/(sses)$/, 'ss').replace(/([^s])s$/, '$1').replace(/(ing|ed)$/, match => (word.length - match.length >= 4 ? '' : match))
const plainWords = (text: string) => (text.toLowerCase().match(/[\p{L}][\p{L}'’-]{2,}/gu) ?? []).filter(word => !STOP.has(word))
export const wordsOf = (text: string) => plainWords(text).map(stem)

const sentencesOf = (text: string) => {
  const clean = text.replace(/\s+/g, ' ').trim()
  const parts = 'Segmenter' in Intl
    ? [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(clean)].map(part => part.segment.trim())
    : clean.match(/[^.!?]+[.!?]+/g) ?? [clean]
  return parts.filter(sentence => sentence.length > 30 && sentence.split(' ').length >= 6)
}

const cache = new Map<string, Stretch[]>()

// Running heads and feet (a copyright line, the course name, the date on every slide) say nothing about any one
// page, yet would pass for a book's favourite words. Any run of four words found on many of its pages is taken out.
function withoutRunningLines(stretches: Stretch[]): Stretch[] {
  if (stretches.length < 6) return stretches
  const words = stretches.map(stretch => stretch.text.split(/\s+/).filter(Boolean))
  const fold = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  const pagesWith = new Map<string, number>()
  for (const page of words) {
    const seen = new Set<string>()
    for (let i = 0; i + 4 <= page.length; i++) seen.add(page.slice(i, i + 4).map(fold).join(' '))
    for (const gram of seen) pagesWith.set(gram, (pagesWith.get(gram) ?? 0) + 1)
  }
  const often = Math.max(4, stretches.length * 0.35)
  const running = new Set([...pagesWith].filter(([gram, count]) => count >= often && gram.replace(/ /g, '').length > 6).map(([gram]) => gram))
  if (!running.size) return stretches
  return stretches.map((stretch, n) => {
    const page = words[n]
    const drop = new Array(page.length).fill(false)
    for (let i = 0; i + 4 <= page.length; i++) if (running.has(page.slice(i, i + 4).map(fold).join(' '))) drop.fill(true, i, i + 4)
    return { ...stretch, text: page.filter((_, i) => !drop[i]).join(' ') }
  })
}
export async function stretchesOf(book: string): Promise<Stretch[]> {
  if (!cache.has(book)) {
    const { get } = await import('idb-keyval')
    const found = (await get<Stretch[]>(`text:${book}`)) ?? []
    if (!found.length) return found
    cache.set(book, withoutRunningLines(found))
  }
  return cache.get(book)!
}

// How rare each word is across a set of stretches: a word on every page says little about any one of them.
function rarity(stretches: string[][]) {
  const pagesWith = new Map<string, number>()
  for (const words of stretches) for (const word of new Set(words)) pagesWith.set(word, (pagesWith.get(word) ?? 0) + 1)
  return (word: string) => Math.log(1 + stretches.length / (1 + (pagesWith.get(word) ?? 0)))
}

// ── The gist: the few sentences of a passage that carry most of its weight, in the order they were written ──
export async function gistOf(book: string, place: string, howMany = 3): Promise<string[]> {
  const all = await stretchesOf(book)
  const here = all.find(stretch => stretch.place === place)
  if (!here) return []
  const rare = rarity(all.map(stretch => wordsOf(stretch.text)))
  const counts = new Map<string, number>()
  for (const word of wordsOf(here.text)) counts.set(word, (counts.get(word) ?? 0) + 1)
  const sentences = sentencesOf(here.text)
  const scored = sentences.map((sentence, index) => {
    const words = wordsOf(sentence)
    const weight = words.reduce((sum, word) => sum + (counts.get(word) ?? 0) * rare(word), 0) / Math.pow(Math.max(6, words.length), 0.6)
    // Opening sentences tend to say what the passage is about.
    // …and a sentence that runs on for a paragraph is a list, not a gist.
    return { sentence, index, weight: weight * (index < 2 ? 1.25 : 1) * (sentence.length > 380 ? 0.45 : 1) }
  })
  return scored.sort((a, b) => b.weight - a.weight).slice(0, howMany).sort((a, b) => a.index - b.index).map(found => found.sentence)
}

// ── The terms a book turns on, each with the places it is thickest ──
export type Term = { term: string; count: number; places: { place: string; count: number }[]; everywhere: string[] }
export async function termsOf(book: string, howMany = 36): Promise<Term[]> {
  const all = await stretchesOf(book)
  if (!all.length) return []
  const tokens = all.map(stretch => wordsOf(stretch.text))
  // Each folded word is shown as the form of it the book uses most ("stretchable", not "stretchabl").
  const forms = new Map<string, Map<string, number>>()
  for (const stretch of all) for (const word of plainWords(stretch.text)) {
    const seen = forms.get(stem(word)) ?? forms.set(stem(word), new Map()).get(stem(word))!
    seen.set(word, (seen.get(word) ?? 0) + 1)
  }
  const shown = (term: string) => term.split(' ').map(part => [...(forms.get(part) ?? [[part, 1]])].sort((a, b) => b[1] - a[1])[0][0]).join(' ')
  // A term is a word or a pair of words that keep company ("kinetic energy").
  const perPlace = tokens.map(words => {
    const counts = new Map<string, number>()
    words.forEach((word, i) => {
      counts.set(word, (counts.get(word) ?? 0) + 1)
      if (i + 1 < words.length) counts.set(`${word} ${words[i + 1]}`, (counts.get(`${word} ${words[i + 1]}`) ?? 0) + 1)
    })
    return counts
  })
  const total = new Map<string, number>(), spread = new Map<string, number>()
  for (const counts of perPlace) for (const [term, count] of counts) {
    total.set(term, (total.get(term) ?? 0) + count)
    spread.set(term, (spread.get(term) ?? 0) + 1)
  }
  const scored = [...total].filter(([term, count]) => count >= (term.includes(' ') ? 3 : 4) && term.length > 3)
    .map(([term, count]) => {
      // Often said, but not everywhere: said thickly in some places. Pairs are worth more than single words.
      const share = (spread.get(term) ?? 1) / all.length
      return { term, count, score: count * Math.log(1 + 1 / (share + 0.02)) * (term.includes(' ') ? 2.2 : 1) }
    })
    .sort((a, b) => b.score - a.score)
  // A pair makes its two words redundant on their own.
  const kept: typeof scored = []
  for (const found of scored) {
    if (kept.length >= howMany) break
    if (kept.some(other => other.term.includes(' ') && other.term.split(' ').includes(found.term))) continue
    if (found.term.split(' ')[0] === found.term.split(' ')[1]) continue
    kept.push(found)
  }
  return kept.map(({ term, count }) => ({
    term: shown(term), count,
    places: perPlace.map((counts, i) => ({ place: all[i].place, count: counts.get(term) ?? 0 })).filter(found => found.count).sort((a, b) => b.count - a.count).slice(0, 8),
    everywhere: perPlace.flatMap((counts, i) => (counts.get(term) ? [all[i].place] : [])),
  }))
}

// ── Elsewhere: the places in your other books closest in subject to a passage ──
export type Kin = { book: string; place: string; line: string; closeness: number }
export async function kinOf(book: string, place: string, most = 6): Promise<Kin[]> {
  const here = (await stretchesOf(book)).find(stretch => stretch.place === place)
  if (!here) return []
  const others: { book: string; stretch: Stretch; words: string[] }[] = []
  for (const other of await shelf()) {
    if (other.name === book) continue
    for (const stretch of await stretchesOf(other.name)) others.push({ book: other.name, stretch, words: wordsOf(stretch.text) })
  }
  if (!others.length) return []
  const rare = rarity([wordsOf(here.text), ...others.map(other => other.words)])
  const vector = (words: string[]) => {
    const weights = new Map<string, number>()
    for (const word of words) weights.set(word, (weights.get(word) ?? 0) + rare(word))
    const length = Math.sqrt([...weights.values()].reduce((sum, weight) => sum + weight * weight, 0)) || 1
    return { weights, length }
  }
  const mine = vector(wordsOf(here.text))
  const scored = others.filter(other => other.words.length > 25).map(other => {
    const theirs = vector(other.words)
    let dot = 0
    for (const [word, weight] of mine.weights) dot += weight * (theirs.weights.get(word) ?? 0)
    return { other, closeness: dot / (mine.length * theirs.length) }
  }).filter(found => found.closeness > 0.12).sort((a, b) => b.closeness - a.closeness)
  // The best few, and no more than two from any one book.
  const taken = new Map<string, number>()
  const kin: Kin[] = []
  for (const { other, closeness } of scored) {
    if (kin.length >= most) break
    if ((taken.get(other.book) ?? 0) >= 2) continue
    taken.set(other.book, (taken.get(other.book) ?? 0) + 1)
    // The sentence there that shares most with the passage here.
    const line = sentencesOf(other.stretch.text)
      .map(sentence => ({ sentence, shared: wordsOf(sentence).reduce((sum, word) => sum + (mine.weights.get(word) ?? 0), 0) }))
      .sort((a, b) => b.shared - a.shared)[0]?.sentence ?? other.stretch.text.replace(/\s+/g, ' ').slice(0, 200)
    kin.push({ book: other.book, place: other.stretch.place, line: line.length > 260 ? `${line.slice(0, 260)}…` : line, closeness })
  }
  return kin
}

// ── Test yourself: questions made from the page's own weightiest sentences, a key term taken out of each ──
export type Question = { before: string; after: string; answer: string; choices: string[] }
export async function quizOf(book: string, place: string, terms: Term[], most = 4): Promise<Question[]> {
  const sentences = await gistOf(book, place, 8)
  const names = terms.map(term => term.term.toLowerCase())
  const questions: Question[] = []
  for (const sentence of sentences) {
    if (questions.length >= most) break
    const lower = sentence.toLowerCase()
    // The weightiest term the sentence holds, as a whole word.
    const answer = names.find(name => new RegExp(`(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u').test(lower))
    if (!answer || questions.some(question => question.answer === answer)) continue
    const at = lower.indexOf(answer)
    const others = [...new Set(names.map(name => name.toLowerCase()))].filter(name => name !== answer && !answer.includes(name) && !name.includes(answer)).sort(() => Math.random() - 0.5).slice(0, 3)
    if (others.length < 2) continue
    questions.push({ before: sentence.slice(0, at), after: sentence.slice(at + answer.length), answer: sentence.slice(at, at + answer.length), choices: [...others, sentence.slice(at, at + answer.length)].sort(() => Math.random() - 0.5) })
  }
  return questions
}

// ── How a book's ideas connect: two terms are joined when they keep turning up in the same places ──
export function termLinks(terms: Term[], most = 60) {
  const links: { source: string; target: string; strength: number }[] = []
  for (let i = 0; i < terms.length; i++) for (let j = i + 1; j < terms.length; j++) {
    const a = new Set(terms[i].everywhere), b = terms[j].everywhere
    const both = b.filter(place => a.has(place)).length
    const strength = both / (a.size + b.length - both || 1)
    if (both >= 2 && strength >= 0.18) links.push({ source: terms[i].term, target: terms[j].term, strength })
  }
  return links.sort((x, y) => y.strength - x.strength).slice(0, most)
}

// ── A glossary: each key term with the sentence in the book that says what it is ──
// A sentence that defines reads "X is …", "X are …", "X means …", "X refers to …", "… is called X", "… known as X".
export type Entry = { term: string; meaning: string; place: string }
export async function glossaryOf(book: string, terms: Term[], most = 24): Promise<Entry[]> {
  const all = await stretchesOf(book)
  const byPlace = new Map(all.map(stretch => [stretch.place, stretch.text]))
  const entries: Entry[] = []
  for (const term of terms) {
    if (entries.length >= most) break
    const name = term.term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const defines = [
      new RegExp(`(^|[^\\p{L}])(an? |the )?${name}s? (is|are|was|were|means|refers to|denotes|describes|is defined as|can be defined as)\\b`, 'iu'),
      new RegExp(`(is|are) (called|known as|termed|named) (an? |the )?${name}`, 'iu'),
    ]
    const mentions = new RegExp(`(^|[^\\p{L}])${name}`, 'iu')
    let best: { sentence: string; place: string; score: number } | null = null
    // The places it is thickest come first; the first defining sentence found there wins, and failing that,
    // the shortest sentence there that names it.
    for (const { place } of term.places) {
      for (const sentence of sentencesOf(byPlace.get(place) ?? '')) {
        if (sentence.length > 320 || !mentions.test(sentence)) continue
        const score = defines.some(pattern => pattern.test(sentence)) ? 2 : 1 / sentence.length
        if (!best || score > best.score) best = { sentence, place, score }
      }
      if (best && best.score >= 2) break
    }
    if (best) entries.push({ term: term.term, meaning: best.sentence, place: best.place })
  }
  return entries
}

// ── Ask your books: the passages across the whole library that best answer a question ──
// Ranked the way search engines rank (BM25): a passage scores for each word of the question it holds, more for
// rare words, less as the passage grows long. The best sentence in each passage is the one shown.
export type Answer = { book: string; place: string; sentence: string; score: number; words: string[] }
export async function askBooks(question: string, most = 8): Promise<Answer[]> {
  const asked = [...new Set(wordsOf(question))]
  if (!asked.length) return []
  const passages: { book: string; stretch: Stretch; words: string[] }[] = []
  for (const book of await shelf()) for (const stretch of await stretchesOf(book.name)) passages.push({ book: book.name, stretch, words: wordsOf(stretch.text) })
  if (!passages.length) return []
  const average = passages.reduce((sum, passage) => sum + passage.words.length, 0) / passages.length
  const holding = new Map(asked.map(word => [word, passages.filter(passage => passage.words.includes(word)).length]))
  const weight = (word: string) => Math.log(1 + (passages.length - holding.get(word)! + 0.5) / (holding.get(word)! + 0.5))
  const k = 1.2, b = 0.75
  const scored = passages.map(passage => {
    const counts = new Map<string, number>()
    for (const word of passage.words) if (holding.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1)
    let score = 0
    for (const [word, count] of counts) score += weight(word) * (count * (k + 1)) / (count + k * (1 - b + b * passage.words.length / average))
    // Holding more of the question's different words counts for more than repeating one of them.
    return { passage, score: score * (1 + counts.size / asked.length) }
  }).filter(found => found.score > 0).sort((x, y) => y.score - x.score).slice(0, most)
  return scored.map(({ passage, score }) => {
    const best = sentencesOf(passage.stretch.text)
      .map(sentence => ({ sentence, held: new Set(wordsOf(sentence).filter(word => holding.has(word))).size }))
      .sort((x, y) => y.held - x.held)[0]?.sentence ?? passage.stretch.text.slice(0, 240)
    return { book: passage.book, place: passage.stretch.place, sentence: best.length > 320 ? `${best.slice(0, 320)}…` : best, score, words: asked }
  })
}
