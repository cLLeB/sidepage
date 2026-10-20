import { useCallback, useEffect, useRef, useState } from 'react'
import { getPref } from './prefs'

// Reading aloud with the voices the device already has (the Web Speech API). Not every system offers them;
// where there are none, the readers simply do not show the button.
export const canSpeak = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'

// Long passages are spoken a sentence at a time: some voices stop on their own partway through a long one.
// Each line (a heading, a paragraph) is taken on its own, so a heading is not run into the sentence after it.
function sentences(text: string): string[] {
  return text.split(/\n+/).flatMap(sentencesOfLine)
}

function sentencesOfLine(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(clean)].map(part => part.segment.trim()).filter(Boolean)
  }
  return clean.match(/[^.!?]+[.!?]*\s*/g) ?? [clean]
}

// Which language a page is in, told from its commonest little words: enough to give French text a French voice
// and English text an English one, without asking.
const COMMON: Record<string, string[]> = {
  fr: ['le', 'la', 'les', 'des', 'est', 'une', 'et', 'du', 'que', 'dans', 'pour', 'pas', 'sur', 'qui', 'avec', 'sont', 'au', 'ce', 'ces', 'nous'],
  en: ['the', 'and', 'of', 'to', 'is', 'in', 'that', 'it', 'for', 'with', 'as', 'are', 'this', 'be', 'on', 'by', 'which', 'from', 'was', 'not'],
  es: ['el', 'la', 'los', 'las', 'de', 'que', 'y', 'en', 'un', 'una', 'es', 'por', 'con', 'para', 'del', 'se', 'no', 'su', 'al', 'lo'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'mit', 'auf', 'den', 'dem', 'des', 'zu', 'von', 'sich', 'auch', 'als', 'wird', 'für'],
  pt: ['o', 'os', 'as', 'de', 'que', 'e', 'em', 'um', 'uma', 'é', 'não', 'para', 'com', 'do', 'da', 'dos', 'das', 'se', 'por', 'mais'],
  it: ['il', 'la', 'di', 'che', 'e', 'un', 'una', 'è', 'per', 'non', 'con', 'del', 'della', 'gli', 'le', 'si', 'sono', 'nel', 'alla', 'dei'],
}
export function languageOf(text: string): string {
  const words = (text.toLowerCase().match(/[\p{L}]+/gu) ?? []).slice(0, 400)
  let best = 'en', most = 0
  for (const [code, common] of Object.entries(COMMON)) {
    const set = new Set(common)
    const hits = words.filter(word => set.has(word)).length
    if (hits > most) { best = code; most = hits }
  }
  return best
}
// The voice to read in: the one chosen in the menu if it speaks this language, otherwise the device's best voice
// for the language (its default one first).
function voiceFor(language: string): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices()
  const chosen = voices.find(found => found.name === getPref('voice', ''))
  if (chosen && chosen.lang.toLowerCase().startsWith(language)) return chosen
  const speaking = voices.filter(found => found.lang.toLowerCase().startsWith(language))
  return speaking.find(found => found.default) ?? speaking.find(found => found.localService) ?? speaking[0] ?? chosen
}
let reading = 'en'

const say = (sentence: string) => new Promise<void>(resolve => {
  const utterance = new SpeechSynthesisUtterance(sentence)
  utterance.lang = reading
  const fitting = voiceFor(reading)
  if (fitting) utterance.voice = fitting
  utterance.pitch = getPref('voice-pitch', 1)
  // The voice and pace chosen in the menu; otherwise the device's own.
  utterance.rate = getPref('voice-rate', 1)
  utterance.onend = utterance.onerror = () => resolve()
  speechSynthesis.speak(utterance)
})

// `start(next)` speaks whatever `next()` hands over, again and again, until it returns null (the end of the
// book) or `stop()` is called. A reader's `next` returns the page that is open, then turns to the following one.
export function useReadAloud() {
  const [speaking, setSpeaking] = useState(false)
  const run = useRef(0)

  const stop = useCallback(() => {
    run.current++
    if (canSpeak) speechSynthesis.cancel()
    setSpeaking(false)
  }, [])

  const start = useCallback(async (next: () => Promise<string | null>, onSentence?: (sentence: string | null) => void) => {
    if (!canSpeak) return
    speechSynthesis.cancel()
    const mine = ++run.current
    setSpeaking(true)
    // Falling asleep to a book: the voice stops by itself after the time chosen.
    const sleep = getPref('voice-sleep', 0)
    if (sleep) setTimeout(() => { if (mine === run.current) stop() }, sleep * 60_000)
    for (;;) {
      const text = await next()
      if (mine !== run.current) return
      if (text === null) break
      // Each page's language is told from its words, so a French page is read in French.
      reading = languageOf(text)
      for (const sentence of sentences(text)) {
        onSentence?.(sentence)
        await say(sentence)
        if (mine !== run.current) return
      }
    }
    onSentence?.(null)
    if (mine === run.current) setSpeaking(false)
  }, [stop])

  // Closing the book stops the voice.
  useEffect(() => stop, [stop])

  return { speaking, start, stop }
}
