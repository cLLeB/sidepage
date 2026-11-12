import { loadEveryday, sentencesOf, stretchesOf } from './insight'
import { webFetch } from './net'
import { languageOf } from './speech'

// A book seen from above: who is in it and who meets whom, how its mood rises and falls, the phrases it keeps
// coming back to, the places it goes, and how it is written next to your other books. All worked out on this
// device from the book's words, except finding places on the map (OpenStreetMap's Nominatim).

const placeNumber = (place: string) => Number(place.match(/\d+/)?.[0] ?? 0)

// ── Names: capitalised words (and runs of them) that are not just the first word of a sentence ──
// A name is said many times, and never in small letters ("Elizabeth", "Mr Darcy"; not "The" or "However").
// `near`: the passages (about 150 words each) the name comes in, to tell who comes with whom.
type Named = { name: string; count: number; places: Map<string, number>; near: Map<string, number>; after: Map<string, number> }
const TITLES = /^(Mr|Mrs|Ms|Miss|Dr|Sir|Lady|Lord|Captain|Uncle|Aunt|Professor|King|Queen|Prince|Princess|Saint|St|Monsieur|Madame|Mademoiselle)\.?$/
const NOT_NAMES = new Set(('I The A An And But Or If In On At To For Of From With By As It Its He She They We You His Her Their Our Your My This That These Those There Here When Where What Who Why How Then Than So Yes No Not Chapter Part Book Page Figure Table ' +
  'Heading Contents Illustration Ladyship Lordship Majesty Highness Excellency Honour Madam Sir Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December God Oh Well Now One Two Three First Second Le La Les Un Une Et Il Elle Ils Elles Je Tu Nous Vous Mais Ou Donc Ce Cette Ces Dans Pour Par Sur Avec').split(' '))
const PLACE_BEFORE = /^(in|at|to|from|near|towards|toward|into|through|across|via|à|en|vers|dans|depuis|près)$/i
async function namesOf(book: string): Promise<Named[]> {
  const stretches = await stretchesOf(book)
  const lowerSeen = new Set<string>()
  for (const { text } of stretches) for (const word of text.match(/\b\p{Ll}[\p{L}'’-]+/gu) ?? []) lowerSeen.add(word)
  const found = new Map<string, Named>()
  for (const { place, text } of stretches) {
    let said = 0
    for (const sentence of sentencesOf(text).length ? sentencesOf(text) : [text]) {
      const words = sentence.split(/\s+/)
      said += words.length
      const passage = `${place}#${Math.floor(said / 150)}`
      for (let i = 1; i < words.length; i++) {
        const clean = (word: string) => word.replace(/^[^\p{L}]+|[^\p{L}'’]+$/gu, '').replace(/['’]s$/, '')
        let word = clean(words[i])
        // A title on its own is not a name: it joins the name after it ("Mr Darcy").
        if (!/^\p{Lu}\p{Ll}+/u.test(word) || NOT_NAMES.has(word) || TITLES.test(word) || lowerSeen.has(word.toLowerCase())) continue
        // A title and the name after it, or two names in a row, are one name ("Mr Darcy", "Jane Bennet").
        let name = word
        const title = clean(words[i - 1])
        if (TITLES.test(title)) name = `${title.replace(/\.$/, '')} ${word}`
        const next = clean(words[i + 1] ?? '')
        if (/^\p{Lu}\p{Ll}+/u.test(next) && !NOT_NAMES.has(next) && !lowerSeen.has(next.toLowerCase()) && !/[.,;:!?]$/.test(words[i])) { name = `${name} ${next}`; i++ }
        word = name
        const entry = found.get(word) ?? found.set(word, { name: word, count: 0, places: new Map(), near: new Map(), after: new Map() }).get(word)!
        entry.count++
        entry.places.set(place, (entry.places.get(place) ?? 0) + 1)
        entry.near.set(passage, (entry.near.get(passage) ?? 0) + 1)
        const before = clean(words[i - (word.includes(' ') ? 2 : 1)] ?? '').toLowerCase()
        entry.after.set(before, (entry.after.get(before) ?? 0) + 1)
      }
    }
  }
  return [...found.values()].filter(entry => entry.count >= 3)
}

// ── Characters: the people named, and who comes with whom ──
export type Character = { name: string; count: number; places: string[] }
export type Meeting = { source: string; target: string; together: number }
export async function charactersOf(book: string, most = 30): Promise<{ people: Character[]; meetings: Meeting[] }> {
  const names = (await namesOf(book)).filter(entry => {
    // A place is mostly said after "in", "at", "to", "from": not a person.
    const atPlace = [...entry.after].filter(([word]) => PLACE_BEFORE.test(word)).reduce((sum, [, count]) => sum + count, 0)
    return atPlace < entry.count * 0.35
  })
  // "Darcy" and "Mr Darcy" are the same person: the shorter is folded into the longer said most.
  const byCount = names.sort((a, b) => b.count - a.count)
  const kept: Named[] = []
  for (const entry of byCount) {
    const fuller = kept.find(other => other.name.split(' ').includes(entry.name) || entry.name.split(' ').includes(other.name))
    if (fuller) {
      fuller.count += entry.count
      for (const [place, count] of entry.places) fuller.places.set(place, (fuller.places.get(place) ?? 0) + count)
      for (const [passage, count] of entry.near) fuller.near.set(passage, (fuller.near.get(passage) ?? 0) + count)
    } else kept.push({ ...entry, places: new Map(entry.places), near: new Map(entry.near) })
  }
  const people = kept.sort((a, b) => b.count - a.count).slice(0, most)
  const meetings: Meeting[] = []
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    let together = 0
    for (const passage of people[i].near.keys()) if (people[j].near.has(passage)) together++
    if (together >= 2) meetings.push({ source: people[i].name, target: people[j].name, together })
  }
  // Each person keeps the few people they come with most, so the map shows who belongs with whom.
  meetings.sort((a, b) => b.together - a.together)
  const links = new Map<string, number>()
  const strongest = meetings.filter(meeting => {
    const keep = (links.get(meeting.source) ?? 0) < 4 || (links.get(meeting.target) ?? 0) < 4
    if (keep) { links.set(meeting.source, (links.get(meeting.source) ?? 0) + 1); links.set(meeting.target, (links.get(meeting.target) ?? 0) + 1) }
    return keep
  })
  return {
    people: people.map(entry => ({ name: entry.name, count: entry.count, places: [...entry.places.keys()].sort((a, b) => placeNumber(a) - placeNumber(b)) })),
    meetings: strongest.slice(0, 80),
  }
}

// ── Places: names said after "in", "at", "to", "from", found on the map ──
export type Spot = { name: string; count: number; places: string[]; lat?: number; lon?: number }
export async function placesOf(book: string, most = 20): Promise<Spot[]> {
  return (await namesOf(book)).map(entry => ({ entry, at: [...entry.after].filter(([word]) => PLACE_BEFORE.test(word)).reduce((sum, [, count]) => sum + count, 0) }))
    .filter(({ entry, at }) => at >= 2 && at >= entry.count * 0.35)
    .sort((a, b) => b.entry.count - a.entry.count).slice(0, most)
    .map(({ entry }) => ({ name: entry.name, count: entry.count, places: [...entry.places.keys()].sort((a, b) => placeNumber(a) - placeNumber(b)) }))
}
// Where a place is: asked of Nominatim once a second at most, as its rules ask, and kept on this device.
let lastAsked = 0
export async function locate(name: string): Promise<{ lat: number; lon: number } | null> {
  const { get, set } = await import('idb-keyval')
  const key = `geo:${name.toLowerCase()}`
  const kept = await get<{ lat: number; lon: number } | 'none'>(key)
  if (kept) return kept === 'none' ? null : kept
  const wait = lastAsked + 1100 - Date.now()
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
  lastAsked = Date.now()
  const answer = await (await webFetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(name)}`, { headers: { Accept: 'application/json' } })).json() as { lat: string; lon: string }[]
  const found = answer[0] ? { lat: Number(answer[0].lat), lon: Number(answer[0].lon) } : null
  await set(key, found ?? 'none')
  return found
}

// ── The arc: how the mood of the book rises and falls, part by part (AFINN word scores, through sentiment) ──
export type Mood = { place: string; score: number }
export async function arcOf(book: string): Promise<Mood[] | 'language'> {
  const stretches = await stretchesOf(book)
  if (languageOf(stretches.slice(0, 6).map(stretch => stretch.text).join(' ')) !== 'en') return 'language'
  const { default: Sentiment } = await import('sentiment')
  const sentiment = new Sentiment()
  const raw = stretches.filter(stretch => stretch.text.split(' ').length > 40).map(stretch => {
    const result = sentiment.analyze(stretch.text)
    return { place: stretch.place, score: result.comparative }
  })
  // Smoothed over a few parts either side, so the shape shows rather than every bump.
  const reach = Math.max(1, Math.round(raw.length / 25))
  return raw.map((mood, i) => {
    const near = raw.slice(Math.max(0, i - reach), i + reach + 1)
    return { place: mood.place, score: near.reduce((sum, found) => sum + found.score, 0) / near.length }
  })
}

// ── Phrases the book keeps coming back to: runs of three to six words said three times or more ──
export type Phrase = { phrase: string; count: number }
export async function phrasesOf(book: string, most = 40): Promise<Phrase[]> {
  const stretches = await stretchesOf(book)
  const { default: common } = await import('./common-words.json')
  const rank = new Map((common as string[]).map((word, i) => [word, i + 1]))
  const counts = new Map<string, number>()
  for (const { text } of stretches) {
    for (const sentence of text.split(/[.!?;:()"“”]+/)) {
      const words = sentence.toLowerCase().match(/[\p{L}\p{N}'’-]+/gu) ?? []
      for (let n = 3; n <= 6; n++) for (let i = 0; i + n <= words.length; i++) {
        const gram = words.slice(i, i + n)
        // A phrase worth noticing has some weight in it: not "one of the", "could not have" or "it is a".
        if (gram.filter(word => word.length > 3).length < 2 || !gram.some(word => (rank.get(word) ?? 99999) > 600)) continue
        const key = gram.join(' ')
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }
  // The licence and the links an e-book shop adds to every book are not the book's own words.
  const found = [...counts].filter(([phrase, count]) => count >= 3 && !/gutenberg|heading to chapter|electronic works?|literary archive/.test(phrase)).sort((a, b) => b[1] * b[0].split(' ').length - a[1] * a[0].split(' ').length)
  // A phrase inside a longer one said as often is left out: the longer says it.
  const kept: Phrase[] = []
  for (const [phrase, count] of found) {
    if (kept.length >= most) break
    if (kept.some(other => other.phrase.includes(phrase) && other.count >= count - 1)) continue
    kept.push({ phrase, count })
  }
  return kept
}

// ── How the book is written: the measures readers and editors use, next to your other books ──
export type Style = { book: string; words: number; sentenceLength: number; variety: number; rare: number; grade: number; hours: number }
export async function styleOf(book: string): Promise<Style | null> {
  const stretches = await stretchesOf(book)
  const text = stretches.map(stretch => stretch.text).join(' ')
  const words = text.match(/[\p{L}'’-]+/gu) ?? []
  if (words.length < 300) return null
  const sentences = sentencesOf(text.slice(0, 400_000))
  // Variety of words: the share of different words in each run of 500 (steady whatever the book's length).
  let variety = 0, runs = 0
  for (let i = 0; i + 500 <= words.length && runs < 200; i += 500, runs++) variety += new Set(words.slice(i, i + 500).map(word => word.toLowerCase())).size / 500
  await loadEveryday()
  const { default: common } = await import('./common-words.json')
  const everyday = new Set((common as string[]).slice(0, 6000))
  const sample = words.slice(0, 50_000).map(word => word.toLowerCase())
  const { default: readability } = await import('text-readability')
  return {
    book,
    words: words.length,
    sentenceLength: sentences.length ? sentences.reduce((sum, sentence) => sum + sentence.split(' ').length, 0) / sentences.length : 0,
    variety: runs ? variety / runs : new Set(words.map(word => word.toLowerCase())).size / words.length,
    rare: sample.filter(word => word.length > 3 && !everyday.has(word)).length / sample.length,
    grade: readability.fleschKincaidGrade(text.slice(0, 60_000)),
    hours: words.length / 230 / 60,
  }
}
