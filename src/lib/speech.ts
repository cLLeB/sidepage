import { useCallback, useEffect, useRef, useState } from 'react'

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

const say = (sentence: string) => new Promise<void>(resolve => {
  const utterance = new SpeechSynthesisUtterance(sentence)
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

  const start = useCallback(async (next: () => Promise<string | null>) => {
    if (!canSpeak) return
    speechSynthesis.cancel()
    const mine = ++run.current
    setSpeaking(true)
    for (;;) {
      const text = await next()
      if (mine !== run.current) return
      if (text === null) break
      for (const sentence of sentences(text)) {
        await say(sentence)
        if (mine !== run.current) return
      }
    }
    if (mine === run.current) setSpeaking(false)
  }, [])

  // Closing the book stops the voice.
  useEffect(() => stop, [stop])

  return { speaking, start, stop }
}
