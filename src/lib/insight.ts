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
  // Everyday words that are common in any text and say nothing about its subject.
  'every called part parts kind kinds way ways thing things make makes made take takes come comes give gives need needs keep keeps ' +
  'often around across among large small long short little great good best high low first last next number numbers lot lots ' +
  // The small change of reference lists, which would otherwise pass for a book's favourite words.
  'vol doi art pp no ed eds rev nat adv mater eng med sci proc ieee int conf trans http https www org com pdf isbn issn press univ journal accessed retrieved available online jan feb mar apr jun jul aug sep sept oct nov dec').split(' '))

// Words that carry meaning, in the order written. A light stemmer folds plurals and "-ing"/"-ed" together.
const stem = (word: string) => word.replace(/(ies)$/, 'y').replace(/(sses)$/, 'ss').replace(/([^s])s$/, '$1').replace(/(ing|ed)$/, match => (word.length - match.length >= 4 ? '' : match))
const plainWords = (text: string) => (text.toLowerCase().match(/[\p{L}][\p{L}'’-]{2,}/gu) ?? []).filter(word => !STOP.has(word))
export const wordsOf = (text: string) => plainWords(text).map(stem)

// An entry in a list of references reads like a sentence but says nothing about the subject.
const isReference = (sentence: string) =>
  /[“"][^”"]{6,}[”"]\s*,|,[”"]\s|\bet al\b|\b(Annu|Proc|Trans|Lett|Rev|Sci|Nat|Adv|Biomed|Eng)\.(\s|$)|\b(doi|arXiv|ISBN)\b|\[\d+\]\s*[A-Z]\.\s?[A-Z]/.test(sentence)
// The text of a PDF runs a heading straight into the sentence after it ("Chapter 1 In one sentence: …",
// "The cell membrane Every cell is wrapped …"): such a heading is taken off the front of the sentence.
const HEADING_LEAD = /^(?:(?:chapter|section|part|unit|lecture|slide)\s+\d+\w*[.:]?\s+|\d+(?:\.\d+)*[.)]?\s+)/i
const SENTENCE_OPENERS = /^(?:A|An|The|This|These|That|Those|In|On|At|By|For|To|From|With|Every|Each|Some|Most|All|It|Its|We|You|They|There|Here|When|While|If|As|Our|Your|One)$/
const FUNCTION_END = /\b(?:the|a|an|of|in|on|at|to|for|by|with|from|and|or|as|is|are|was|were|that|which|its|their)$/i
function withoutHeading(sentence: string): string {
  let rest = sentence.replace(HEADING_LEAD, '')
  // A few words with no punctuation, then a capital starting an ordinary sentence: the few words were a heading.
  const run = rest.match(/^([^.,;:!?]{3,60}?[a-z0-9])\s([A-Z][a-z]*(?:\s[a-z][\w'-]*){3,})/)
  // A capital inside those few words is a name ("In 1665 Robert Hooke…"), and a word like "of" at their end leads
  // on into the sentence: either way they are left alone. Unless what follows is an ordinary opening word of a
  // sentence ("The Living Cell A short guide…", "What a cell is A cell is…"): that marks a heading.
  const opens = !!run && SENTENCE_OPENERS.test(run[2].split(' ')[0])
  if (run && run[1].split(' ').length <= 6 && (opens || (!FUNCTION_END.test(run[1]) && !/\s[A-Z]/.test(run[1])))) rest = rest.slice(run[1].length + 1)
  return rest
}

export const sentencesOf = (text: string) => {
  const clean = text.replace(/\s+/g, ' ').trim()
  const parts = 'Segmenter' in Intl
    ? [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(clean)].map(part => part.segment.trim())
    : clean.match(/[^.!?]+[.!?]+/g) ?? [clean]
  return parts.map(withoutHeading).filter(sentence => sentence.length > 30 && sentence.split(' ').length >= 6 && !isReference(sentence))
}
// A sentence a question can be made from: a whole one, ending as sentences do, with ordinary words in it (not a
// title in capitals).
const isProperSentence = (sentence: string) => /[.!?]["')\]]?$/.test(sentence) && (sentence.match(/\b[a-z][a-z'-]+\b/g) ?? []).length >= 5

const cache = new Map<string, Stretch[]>()

// Running heads and feet (a copyright line, the course name, the date on every slide) say nothing about any one
// page, yet would pass for a book's favourite words. Any run of four words found on many of its pages is taken out.
const fold = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const runningOf = new Map<string, Set<string>>()
function runningGrams(stretches: Stretch[]): Set<string> {
  if (stretches.length < 6) return new Set()
  const words = stretches.map(stretch => stretch.text.split(/\s+/).filter(Boolean))
  const pagesWith = new Map<string, number>()
  for (const page of words) {
    const seen = new Set<string>()
    for (let i = 0; i + 4 <= page.length; i++) seen.add(page.slice(i, i + 4).map(fold).join(' '))
    for (const gram of seen) pagesWith.set(gram, (pagesWith.get(gram) ?? 0) + 1)
  }
  const often = Math.max(4, stretches.length * 0.35)
  return new Set([...pagesWith].filter(([gram, count]) => count >= often && gram.replace(/ /g, '').length > 6).map(([gram]) => gram))
}
// A page's text without them, and without a bare page number at its start or end.
function withoutRunning(text: string, running: Set<string>) {
  const page = text.split(/\s+/).filter(Boolean)
  const drop = new Array(page.length).fill(false)
  if (running.size) for (let i = 0; i + 4 <= page.length; i++) if (running.has(page.slice(i, i + 4).map(fold).join(' '))) drop.fill(true, i, i + 4)
  return page.filter((_, i) => !drop[i]).join(' ').replace(/^\d{1,4}\s+|\s+\d{1,4}$/g, '')
}
function withoutRunningLines(stretches: Stretch[]): Stretch[] {
  const running = runningGrams(stretches)
  return running.size ? stretches.map(stretch => ({ ...stretch, text: withoutRunning(stretch.text, running) })) : stretches
}

// What is worth reading aloud on a page: its own words, without what is repeated on every page.
export async function readableText(book: string, text: string): Promise<string> {
  if (!runningOf.has(book)) {
    const { get } = await import('idb-keyval')
    runningOf.set(book, runningGrams((await get<Stretch[]>(`text:${book}`)) ?? []))
  }
  return withoutRunning(text, runningOf.get(book)!)
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
// Worked out once per book (and again only if its words change), since cards and the guide both ask often.
const knownTerms = new Map<string, { size: number; terms: Term[] }>()
export async function termsOf(book: string, howMany = 36): Promise<Term[]> {
  const size = (await stretchesOf(book)).length
  const known = knownTerms.get(`${book}|${howMany}`)
  if (known && known.size === size) return known.terms
  const terms = await workOutTerms(book, howMany)
  knownTerms.set(`${book}|${howMany}`, { size, terms })
  return terms
}
async function workOutTerms(book: string, howMany: number): Promise<Term[]> {
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
    if (!isProperSentence(sentence)) continue
    const lower = sentence.toLowerCase()
    // The weightiest term the sentence holds, as a whole word.
    const whole = (name: string) => new RegExp(`(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[^\\p{L}]|$)`, 'u').exec(lower)
    const answer = names.find(name => whole(name))
    if (!answer || questions.some(question => question.answer === answer)) continue
    // Where it stands as a whole word: "cell" is taken out of "a cell", never out of "cells".
    const found = whole(answer)!
    const at = found.index + found[1].length
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
// The words a question is put in ("explain", "give an example", "according to the lecture") say how to answer,
// not what about, so they are not looked for.
const ASKING = new Set(['question', 'lecture', 'paper', 'according', 'mention', 'mentioned', 'give', 'name', 'example', 'explain', 'describe',
  'least', 'list', 'state', 'discuss', 'complete', 'sentence', 'answer', 'idea', 'justify', 'justified', 'scientifically', 'link', 'role', 'difference', 'synthesis', 'define', 'definition'].map(word => stem(word)))
const squashed = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

export async function askBooks(question: string, most = 8): Promise<Answer[]> {
  const meant = [...new Set(wordsOf(question))].filter(word => !ASKING.has(word))
  const asked = meant.length ? meant : [...new Set(wordsOf(question))]
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
    score *= 1 + counts.size / asked.length
    // The page the question was copied from answers nothing, and a page of questions (a quiz, a questionnaire)
    // rarely does: the pages that teach come first.
    const text = passage.stretch.text
    if (squashed(question).length > 24 && squashed(text).includes(squashed(question).slice(0, 48))) score = 0
    else if ((text.match(/\?/g)?.length ?? 0) >= 2 || /\b(questionnaire|synthesis question|exercise|quiz)\b/i.test(text)) score *= 0.15
    return { passage, score }
  }).filter(found => found.score > 0).sort((x, y) => y.score - x.score).slice(0, most)
  return scored.map(({ passage, score }) => {
    const sentences = sentencesOf(passage.stretch.text)
      .map(sentence => ({ sentence, held: new Set(wordsOf(sentence).filter(word => holding.has(word))).size }))
      .sort((x, y) => y.held - x.held)
    // Slides are written in fragments rather than sentences: then the stretch of some forty words that holds most
    // of the question's words is shown.
    const best = sentences[0]?.held ? sentences[0].sentence : (() => {
      const words = passage.stretch.text.split(/\s+/).filter(Boolean)
      let at = 0, most = -1
      for (let i = 0; i < Math.max(1, words.length - 10); i += 3) {
        const held = new Set(wordsOf(words.slice(i, i + 40).join(' ')).filter(word => holding.has(word))).size
        if (held > most) { most = held; at = i }
      }
      return `${at ? '… ' : ''}${words.slice(at, at + 40).join(' ')}${at + 40 < words.length ? ' …' : ''}`
    })()
    return { book: passage.book, place: passage.stretch.place, sentence: best.length > 320 ? `${best.slice(0, 320)}…` : best, score, words: asked }
  })
}

// ── A timeline: the years a book speaks of, each with the sentence that says what happened ──
// A year is four figures from 1000 to 2099 (or a date with one), or a "BC"/"AD" year; reference lists, page
// numbers and copyright lines are kept out by looking only at sentences that read as sentences.
export type Moment = { year: number; label: string; sentence: string; place: string }
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december'
export async function timelineOf(book: string, most = 60): Promise<Moment[]> {
  const found: Moment[] = []
  const seen = new Set<string>()
  for (const stretch of await stretchesOf(book)) {
    for (const sentence of sentencesOf(stretch.text)) {
      if (sentence.length > 300 || /doi|vol\.|pp\.|©|copyright|isbn|https?:/i.test(sentence)) continue
      for (const match of sentence.matchAll(new RegExp(`\\b(?:(?:\\d{1,2} )?(?:${MONTHS}) (?:\\d{1,2}, )?)?(1[0-9]{3}|20[0-9]{2})\\b(?!\\s*[-–]\\s*\\d)|\\b(\\d{1,4}) ?(BC|BCE|AD|CE)\\b`, 'gi'))) {
        const year = match[1] ? Number(match[1]) : Number(match[2]) * (/^bc/i.test(match[3] ?? '') ? -1 : 1)
        if (!year || year > new Date().getFullYear() + 30) continue
        const key = `${year}|${sentence.slice(0, 60)}`
        if (seen.has(key)) continue
        seen.add(key)
        found.push({ year, label: match[0], sentence, place: stretch.place })
      }
    }
  }
  // Too many to show: the years spoken of most keep their place.
  const often = new Map<number, number>()
  for (const moment of found) often.set(moment.year, (often.get(moment.year) ?? 0) + 1)
  return found
    .sort((a, b) => (often.get(b.year)! - often.get(a.year)!) || a.year - b.year)
    .filter((moment, i, all) => all.findIndex(other => other.year === moment.year) === i || i < most / 2)
    .slice(0, most)
    .sort((a, b) => a.year - b.year)
}

// ── The book's ideas as a tree: terms gathered round the ones they keep company with ──
// Each term joins the group of the term it is most strongly linked to among those already placed, strongest
// links first; a group's most frequent term names it.
export type IdeaTree = { topic: string; children: IdeaTree[] }
export function ideaTree(terms: Term[], most = 8): IdeaTree[] {
  const links = termLinks(terms, 200)
  const count = new Map(terms.map(term => [term.term, term.count]))
  const group = new Map<string, string>()
  for (const term of [...terms].sort((a, b) => b.count - a.count)) {
    const partner = links.filter(link => link.source === term.term || link.target === term.term)
      .map(link => ({ other: link.source === term.term ? link.target : link.source, strength: link.strength }))
      .filter(found => group.has(found.other))
      .sort((a, b) => b.strength - a.strength)[0]
    group.set(term.term, partner ? group.get(partner.other)! : term.term)
  }
  const groups = new Map<string, string[]>()
  for (const [term, head] of group) if (term !== head) groups.set(head, [...(groups.get(head) ?? []), term])
  return [...group.values()].filter((head, i, all) => all.indexOf(head) === i)
    .sort((a, b) => (groups.get(b)?.length ?? 0) - (groups.get(a)?.length ?? 0) || count.get(b)! - count.get(a)!)
    .slice(0, most)
    .map(head => ({ topic: head, children: (groups.get(head) ?? []).slice(0, 6).map(topic => ({ topic, children: [] })) }))
}

// ── Teach it back: an explanation in your own words, held up against what the book says ──
// The book's account of a term is the pages where it is thickest; its key words are the words those pages use
// far more than the rest of the book does. Your explanation is checked for them (folded, so "measures" counts
// for "measurement").
export type Check = { covered: string[]; missed: string[]; share: number; source: string; place: string }
export async function checkExplanation(book: string, term: Term, explanation: string): Promise<Check> {
  const all = await stretchesOf(book)
  const rare = rarity(all.map(stretch => wordsOf(stretch.text)))
  const pages = term.places.slice(0, 3).map(found => all.find(stretch => stretch.place === found.place)).filter((found): found is Stretch => !!found)
  const counts = new Map<string, number>()
  const termWords = new Set(wordsOf(term.term))
  for (const page of pages) for (const word of wordsOf(page.text)) if (!termWords.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1)
  const key = [...counts].map(([word, count]) => ({ word, weight: count * rare(word) })).sort((a, b) => b.weight - a.weight).slice(0, 14).map(found => found.word)
  const mine = new Set(wordsOf(explanation))
  const shown = (word: string) => {
    // The book's own spelling of the folded word.
    const spelled = pages.map(page => page.text.match(new RegExp(`\\b${word}\\w*`, 'i'))?.[0]).find(Boolean)
    return (spelled ?? word).toLowerCase()
  }
  const covered = key.filter(word => mine.has(word))
  const best = (await glossaryOf(book, [term], 1))[0]
  return {
    covered: covered.map(shown),
    missed: key.filter(word => !mine.has(word)).slice(0, 8).map(shown),
    share: key.length ? covered.length / key.length : 0,
    source: best?.meaning ?? pages[0]?.text.slice(0, 280) ?? '',
    place: best?.place ?? pages[0]?.place ?? '',
  }
}
