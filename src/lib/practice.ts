import { baseName, loadNote, saveNote } from './platform'
import { stretchesOf } from './insight'
import { COMMON, languageOf } from './speech'
import { webFetch } from './net'

// Language practice on the page you are reading, the way language learners read (LingQ, Language Reactor,
// Readlang): every word you do not know yet stands out, the words worth learning are gathered with their
// sentence, the page can be read with its translation under each sentence, and its sentences can be written from
// dictation or said back after the voice.

// ── The words you know ──
// Kept for every book at once (a word known in one book is known in all), per language, with the flashcard
// schedule (_review/known-words.json), so they are part of backups.
export type Status = 'learning' | 'known'
type Known = Record<string, Status>
const KNOWN_FILE = ['_review', 'known-words.json'] as const
let known: Promise<Known> | null = null
const listeners = new Set<() => void>()
export const onKnownWords = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const knownWords = () => (known ??= loadNote(...KNOWN_FILE).then(text => { try { return JSON.parse(text ?? '{}') as Known } catch { return {} } }))
const keyOf = (language: string, word: string) => `${language}:${word.toLocaleLowerCase()}`
export const statusOf = (all: Known, language: string, word: string): Status | undefined => all[keyOf(language, word)]
export async function setStatus(language: string, words: string[], status: Status | null) {
  const all = { ...(await knownWords()) }
  for (const word of words) {
    if (status) all[keyOf(language, word)] = status
    else delete all[keyOf(language, word)]
  }
  known = Promise.resolve(all)
  listeners.forEach(listener => listener())
  await saveNote(...KNOWN_FILE, JSON.stringify(all))
}

// ── A page's text, in sentences and words ──
export async function pageText(book: string, place: string): Promise<string> {
  const stretches = await stretchesOf(book)
  return stretches.find(stretch => stretch.place === place)?.text ?? ''
}
export const sentencesIn = (text: string, language: string) => {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const parts = 'Segmenter' in Intl ? [...new Intl.Segmenter(language, { granularity: 'sentence' }).segment(clean)].map(part => part.segment.trim()) : clean.match(/[^.!?]+[.!?]*/g) ?? [clean]
  return parts.filter(part => /\p{L}{2}/u.test(part))
}
// The words of a passage, each as written, and the stretches between them, so the passage can be shown again
// word by word exactly as it was.
export type Piece = { text: string; word: boolean }
export const piecesOf = (text: string, language: string): Piece[] => {
  if ('Segmenter' in Intl) return [...new Intl.Segmenter(language, { granularity: 'word' }).segment(text)].map(part => ({ text: part.segment, word: !!part.isWordLike && /\p{L}/u.test(part.segment) }))
  return (text.match(/[\p{L}'’-]+|[^\p{L}'’-]+/gu) ?? []).map(part => ({ text: part, word: /\p{L}/u.test(part) }))
}
export const languageOfText = (text: string) => languageOf(text)

// ── Words to learn ──
// The words of the page you do not know yet, the most useful first: those the book uses most often (learning
// them pays off on every page after), each with the first sentence of the page it is in.
const LITTLE: Record<string, string> = {
  en: 'its his her their our your my a an at or but if so than then there these those they them we you he she him who what when where why how all any some each more most other such no nor only own same too very can will just should now has have had was were been being do does did into out up down over under again also one two',
  fr: 'un une il elle ils elles leur leurs son sa ses mon ma mes ton ta tes notre nos votre vos je tu on se ne mais ou donc car ni par plus aussi très tout tous toute toutes cette cet été être avoir fait comme sans sous entre deux ont été',
}
export type Candidate = { word: string; count: number; sentence: string }
export async function wordsToLearn(book: string, text: string, language: string, all: Known, most = 40): Promise<Candidate[]> {
  const counts = new Map<string, number>()
  for (const stretch of await stretchesOf(book)) {
    for (const piece of piecesOf(stretch.text, language)) if (piece.word) counts.set(piece.text.toLocaleLowerCase(), (counts.get(piece.text.toLocaleLowerCase()) ?? 0) + 1)
  }
  // The little words every sentence has ("and", "its", "les") are learned by reading, not from a list.
  const little = new Set([...(COMMON[language] ?? []), ...(LITTLE[language] ?? '').split(' ')])
  const lowerSeen = new Set<string>()
  for (const stretch of await stretchesOf(book)) for (const piece of piecesOf(stretch.text, language)) if (piece.word && piece.text === piece.text.toLocaleLowerCase()) lowerSeen.add(piece.text)
  const seen = new Map<string, Candidate>()
  for (const sentence of sentencesIn(text, language)) {
    for (const piece of piecesOf(sentence, language)) {
      const word = piece.text.toLocaleLowerCase()
      if (!piece.word || word.length < 3 || seen.has(word) || statusOf(all, language, word) === 'known' || /\d/.test(word) || little.has(word)) continue
      // Shown as the book writes it inside a sentence: "cell", not "Cell" from a heading.
      seen.set(word, { word: counts.has(word) && piece.text !== word && !/^\p{Lu}{2,}$/u.test(piece.text) && lowerSeen.has(word) ? word : piece.text, count: counts.get(word) ?? 1, sentence })
    }
  }
  return [...seen.values()].sort((a, b) => b.count - a.count).slice(0, most)
}

// ── Saved words, with their sentence and meaning: they become flashcards (see review.ts) ──
export type Saved = { word: string; sentence: string; meaning: string; place: string; language: string; added: number }
const VOCAB = 'vocabulary.json'
export async function savedWords(book: string): Promise<Saved[]> {
  try { return JSON.parse((await loadNote(baseName(book), VOCAB)) ?? '[]') } catch { return [] }
}
export async function saveWord(book: string, entry: Omit<Saved, 'added'>) {
  const list = (await savedWords(book)).filter(saved => saved.word.toLowerCase() !== entry.word.toLowerCase())
  await saveNote(baseName(book), VOCAB, JSON.stringify([...list, { ...entry, added: Date.now() }], null, 1))
  await setStatus(entry.language, [entry.word], 'learning')
}
export async function forgetWord(book: string, word: string) {
  await saveNote(baseName(book), VOCAB, JSON.stringify((await savedWords(book)).filter(saved => saved.word.toLowerCase() !== word.toLowerCase()), null, 1))
}

// ── Translation, a sentence at a time (MyMemory, the free service the Translate tool uses) ──
const translations = new Map<string, string>()
export async function translateSentence(sentence: string, from: string, to: string): Promise<string> {
  const key = `${from}|${to}|${sentence}`
  if (translations.has(key)) return translations.get(key)!
  const answer = await (await webFetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(sentence.slice(0, 480))}&langpair=${from}|${to}`)).json()
  const text = String(answer?.responseData?.translatedText ?? '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  if (/QUERY LENGTH LIMIT|MYMEMORY WARNING|INVALID LANGUAGE/i.test(text)) throw new Error(text)
  translations.set(key, text)
  return text
}
// The meaning of one word, in the language you read in.
export const meaningOf = (word: string, from: string, to: string) => translateSentence(word, from, to)

// ── Comparing what was written or said with the sentence ──
// Word by word (the diff library's word comparison), ignoring capitals and punctuation, so "its" for "it's" is
// an error but a missing full stop is not.
export type Marked = { text: string; kind: 'right' | 'missed' | 'extra' }
export async function compareWords(expected: string, given: string): Promise<{ marked: Marked[]; score: number }> {
  const { diffArrays } = await import('diff')
  const words = (text: string) => (text.toLocaleLowerCase().match(/[\p{L}\p{N}'’]+/gu) ?? []).map(word => word.replace(/’/g, "'"))
  const want = words(expected)
  const parts = diffArrays(want, words(given))
  const marked: Marked[] = parts.flatMap(part => part.value.map(text => ({ text, kind: part.added ? 'extra' as const : part.removed ? 'missed' as const : 'right' as const })))
  const right = marked.filter(part => part.kind === 'right').length
  return { marked, score: want.length ? right / Math.max(want.length, right + marked.filter(part => part.kind === 'extra').length) : 0 }
}
