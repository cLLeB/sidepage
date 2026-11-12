import { NATURAL_VOICES, naturalSession, naturalVoiceFor } from './natural'
import { gistOf, glossaryOf, quizOf, stretchesOf, termsOf } from './insight'
import { languageOf } from './speech'
import { placeName } from './library'

// A book to listen to away from the screen: pages read by a natural voice (Piper, on the device) and saved as an
// MP3 (LAME's encoder, through lamejs) for any music player, or the page talked over by two voices, one asking
// and one answering, made from the page's gist, its key terms and the questions the study guide asks.

// One line said by one of the voices.
export type Line = { voice: 0 | 1; text: string }

// Piper's sound comes as WAV: 16-bit samples after a "data" mark. They are taken out as they are.
function samplesOf(wav: ArrayBuffer): { samples: Int16Array; rate: number } {
  const view = new DataView(wav)
  const rate = view.getUint32(24, true)
  let at = 12
  while (at + 8 < view.byteLength) {
    const id = String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))
    const size = view.getUint32(at + 4, true)
    if (id === 'data') return { samples: new Int16Array(wav.slice(at + 8, at + 8 + size)), rate }
    at += 8 + size + (size % 2)
  }
  return { samples: new Int16Array(), rate }
}

// The lines as one recording, a short silence after each, in MP3.
export async function record(lines: Line[], language: string, onStep: (step: string) => void, stopped: () => boolean): Promise<Blob | null> {
  const offered = NATURAL_VOICES[language] ?? NATURAL_VOICES.en
  const first = naturalVoiceFor(language)
  // The second voice is another of the language's voices, of the other kind where there is one.
  const second = offered.find(voice => voice.id !== first && /male|tom|henry|ryan|alan|gilles|thorsten|faber/i.test(voice.id) !== /male|tom|henry|ryan|alan|gilles|thorsten|faber/i.test(first))?.id ?? offered.find(voice => voice.id !== first)?.id ?? first
  const voices = [first, second]
  // Each voice says all its lines in one go (changing voice means loading it again), then they are put in order.
  const made = new Array<Int16Array>(lines.length)
  let rate = 22050, done = 0
  for (const which of [0, 1] as const) {
    const mine = lines.map((line, i) => ({ line, i })).filter(({ line }) => line.voice === which)
    if (!mine.length) continue
    const speaker = await naturalSession(voices[which], onStep)
    for (const { line, i } of mine) {
      if (stopped()) return null
      const sound = samplesOf(await (await speaker.predict(line.text)).arrayBuffer())
      made[i] = sound.samples
      rate = sound.rate || rate
      onStep(`Making the sound… ${Math.round((++done / lines.length) * 100)}%`)
    }
  }
  const { Mp3Encoder } = await import('@breezystack/lamejs')
  const encoder = new Mp3Encoder(1, rate, 64)
  const parts: Uint8Array[] = []
  const pause = new Int16Array(Math.round(rate * 0.45))
  for (const samples of made) {
    for (const piece of [samples ?? new Int16Array(), pause]) {
      for (let at = 0; at < piece.length; at += 1152 * 20) parts.push(encoder.encodeBuffer(piece.subarray(at, at + 1152 * 20)))
    }
  }
  parts.push(encoder.flush())
  return new Blob(parts as BlobPart[], { type: 'audio/mpeg' })
}

// ── The text, as it is: the pages from `from`, so many of them ──
export async function readingLines(book: string, places: string[]): Promise<{ lines: Line[]; language: string }> {
  const stretches = await stretchesOf(book)
  const text = places.map(place => stretches.find(stretch => stretch.place === place)?.text ?? '').join('\n')
  const language = languageOf(text)
  const sentences = 'Segmenter' in Intl
    ? [...new Intl.Segmenter(language, { granularity: 'sentence' }).segment(text.replace(/\s+/g, ' '))].map(part => part.segment.trim())
    : text.match(/[^.!?]+[.!?]*/g) ?? []
  return { lines: sentences.filter(sentence => /\p{L}{2}/u.test(sentence)).map(text => ({ voice: 0, text })), language }
}

// ── A conversation about the pages: one voice asks, the other answers from the book ──
const SAYS: Record<string, { open(place: string): string; about: string; means(term: string): string; ask(question: string): string; answer(answer: string): string; close: string }> = {
  en: {
    open: place => `Today we look at ${place}. So, what is this part about?`,
    about: 'And what else should we keep in mind?',
    means: term => `The book keeps coming back to ${term}. What does it mean here?`,
    ask: question => `Here is a question to test yourself. ${question}`,
    answer: answer => `The answer is ${answer}.`,
    close: 'That is the heart of it. Go back over the parts you were unsure of.',
  },
  fr: {
    open: place => `Aujourd’hui, nous regardons ${place}. Alors, de quoi parle ce passage ?`,
    about: 'Et que faut-il retenir d’autre ?',
    means: term => `Le livre revient souvent à ${term}. Qu’est-ce que cela veut dire ici ?`,
    ask: question => `Voici une question pour vous tester. ${question}`,
    answer: answer => `La réponse est ${answer}.`,
    close: 'Voilà l’essentiel. Revenez sur les points dont vous n’étiez pas sûr.',
  },
}
export async function conversationLines(book: string, places: string[]): Promise<{ lines: Line[]; language: string }> {
  const stretches = await stretchesOf(book)
  const language = languageOf(places.map(place => stretches.find(stretch => stretch.place === place)?.text ?? '').join(' '))
  const say = SAYS[language] ?? SAYS.en
  const where = places.length === 1 ? placeName(places[0]) : `${placeName(places[0])} to ${placeName(places.at(-1)!)}`
  const lines: Line[] = [{ voice: 0, text: say.open(where.replace(/^p\. /, 'page ').replace(/^part /, 'part ')) }]
  const gist = (await Promise.all(places.slice(0, 6).map(place => gistOf(book, place, places.length > 2 ? 1 : 2)))).flat()
  lines.push({ voice: 1, text: gist.slice(0, 2).join(' ') })
  if (gist.length > 2) lines.push({ voice: 0, text: say.about }, { voice: 1, text: gist.slice(2, 5).join(' ') })
  const all = await termsOf(book)
  const terms = all.filter(term => term.everywhere.some(place => places.includes(place))).slice(0, 2)
  for (const entry of await glossaryOf(book, terms, 2)) lines.push({ voice: 0, text: say.means(entry.term) }, { voice: 1, text: entry.meaning })
  const questions = (await Promise.all(places.slice(0, 3).map(place => quizOf(book, place, all, 1)))).flat().slice(0, 2)
  for (const question of questions) lines.push({ voice: 0, text: say.ask(`${question.before} ${language === 'fr' ? 'blanc' : 'blank'} ${question.after}`) }, { voice: 1, text: say.answer(question.answer) })
  lines.push({ voice: 0, text: say.close })
  return { lines: lines.filter(line => line.text.trim()), language }
}
