import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { Tool } from '../ui'
import { baseName, goToPlace, openBookByName, shelf } from '../lib/platform'
import { hasWords, placeName, type Stretch } from '../lib/library'

// Two books compared (jsdiff): sentence by sentence, then word by word inside a sentence that was only edited.
// Every change is shown where it falls in the newer one, a few words either side, with the page to go to.
type Change = { place: string; before: string; removed: string; added: string; after: string }
type Result = { changes: Change[]; added: number; removed: number; pages: number } | 'too-different' | 'same'

const words = (text: string) => text.split(/\s+/).filter(Boolean).length
const tail = (text: string, count: number) => { const all = text.split(/\s+/).filter(Boolean); return (all.length > count ? '… ' : '') + all.slice(-count).join(' ') }
const head = (text: string, count: number) => { const all = text.split(/\s+/).filter(Boolean); return all.slice(0, count).join(' ') + (all.length > count ? ' …' : '') }

async function compare(older: string, newer: string, ignoreCase: boolean): Promise<Result> {
  const { get } = await import('idb-keyval')
  const [was, now] = await Promise.all([get<Stretch[]>(`text:${older}`), get<Stretch[]>(`text:${newer}`)])
  // Each book as its sentences, each sentence of the newer one with its page.
  const split = (text: string) => {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (!clean) return []
    return 'Segmenter' in Intl
      ? [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(clean)].map(part => part.segment.trim()).filter(Boolean)
      : clean.match(/[^.!?]+[.!?]*/g)?.map(part => part.trim()).filter(Boolean) ?? []
  }
  const before = (was ?? []).flatMap(stretch => split(stretch.text).map(text => ({ text, place: stretch.place })))
  const after = (now ?? []).flatMap(stretch => split(stretch.text).map(text => ({ text, place: stretch.place })))
  const key = (text: string) => { const plain = text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); return ignoreCase ? plain.toLowerCase() : plain }
  const { diffArrays, diffWords } = await import('diff')
  // First sentence by sentence: quick even when the two differ a great deal (a summary and the full text).
  const blocks = await new Promise<ReturnType<typeof diffArrays<string>> | undefined>(resolve =>
    diffArrays(before.map(sentence => key(sentence.text)), after.map(sentence => key(sentence.text)), { timeout: 15000, callback: resolve }))
  if (!blocks) return 'too-different'
  const changes: Change[] = []
  let added = 0, removed = 0, at = 0, from = 0
  const placeOf = (index: number) => after[Math.min(index, after.length - 1)]?.place ?? ''
  const cut = (text: string, most = 60) => { const all = text.split(/\s+/).filter(Boolean); return all.length > most ? `${all.slice(0, most).join(' ')} …` : all.join(' ') }
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (!block.added && !block.removed) { at += block.count ?? block.value.length; from += block.count ?? block.value.length; continue }
    const next = blocks[i + 1]
    const gone = block.removed ? before.slice(from, from + block.value.length) : []
    const came = block.added ? after.slice(at, at + block.value.length) : next?.added && block.removed ? after.slice(at, at + next.value.length) : []
    if (block.removed && next?.added) i++
    const lead = at > 0 ? tail(after[at - 1].text, 10) : ''
    const follow = after[at + came.length] ? head(after[at + came.length].text, 10) : ''
    // Sentences only edited (most of their words kept): shown word by word, each where it now stands.
    if (gone.length === came.length && gone.length <= 6) {
      const edits = gone.map((sentence, k) => ({ parts: diffWords(sentence.text, came[k].text, { ignoreCase }), place: came[k].place }))
      const kept = edits.every(edit => {
        const same = edit.parts.filter(part => !part.added && !part.removed).reduce((sum, part) => sum + words(part.value), 0)
        const total = edit.parts.filter(part => !part.added).reduce((sum, part) => sum + words(part.value), 0)
        return total > 0 && same / total >= 0.5
      })
      if (kept) {
        for (const edit of edits) {
          let leadText = ''
          for (let p = 0; p < edit.parts.length; p++) {
            const part = edit.parts[p]
            if (!part.added && !part.removed) { leadText = part.value; continue }
            const pair = edit.parts[p + 1]
            const removedText = part.removed ? part.value : ''
            const addedText = part.added ? part.value : part.removed && pair?.added ? pair.value : ''
            if (part.removed && pair?.added) p++
            if (!removedText.trim() && !addedText.trim()) continue
            removed += words(removedText); added += words(addedText)
            const followText = edit.parts.slice(p + 1).find(other => !other.added && !other.removed)?.value ?? ''
            changes.push({ place: edit.place, before: tail(leadText, 10), removed: removedText.trim(), added: addedText.trim(), after: head(followText, 10) })
          }
        }
        at += came.length; from += gone.length
        continue
      }
    }
    // Otherwise whole sentences went or came.
    const goneText = gone.map(sentence => sentence.text).join(' '), cameText = came.map(sentence => sentence.text).join(' ')
    removed += words(goneText); added += words(cameText)
    // A run of new sentences over several pages is shown page by page, so each can be gone to.
    const pages = [...new Set(came.map(sentence => sentence.place))]
    if (pages.length <= 1) changes.push({ place: came[0]?.place ?? placeOf(at), before: lead, removed: cut(goneText), added: cut(cameText), after: follow })
    else pages.forEach((page, k) => changes.push({
      place: page, before: k === 0 ? lead : '', removed: k === 0 ? cut(goneText) : '',
      added: cut(came.filter(sentence => sentence.place === page).map(sentence => sentence.text).join(' ')), after: k === pages.length - 1 ? follow : '',
    }))
    at += came.length; from += gone.length
  }
  if (!changes.length) return 'same'
  return { changes, added, removed, pages: new Set(changes.map(change => change.place)).size }
}

export default function CompareView({ older: givenOlder, newer: givenNewer }: { older?: string; newer?: string }) {
  const [books, setBooks] = useState<string[] | null>(null)
  const [older, setOlder] = useState(givenOlder ?? '')
  const [newer, setNewer] = useState(givenNewer ?? '')
  const [ignoreCase, setIgnoreCase] = useState(true)
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const ready: string[] = []
      for (const book of await shelf()) if (await hasWords(book.name)) ready.push(book.name)
      setBooks(ready)
      if (!givenOlder && ready[1]) setOlder(ready[1])
      if (!givenNewer && ready[0]) setNewer(ready[0])
    })()
  }, [givenOlder, givenNewer])

  useEffect(() => {
    setResult(null)
    if (!older || !newer || older === newer) return
    let cancelled = false
    setBusy(true)
    void compare(older, newer, ignoreCase).then(found => { if (!cancelled) { setResult(found); setBusy(false) } })
    return () => { cancelled = true }
  }, [older, newer, ignoreCase])

  const go = (place: string) => {
    openBookByName(newer)
    for (const delay of [100, 1200, 2600]) setTimeout(() => goToPlace({ book: newer, place }), delay)
  }
  const picker = (value: string, set: (book: string) => void, label: string) => (
    <label className="compare-pick">
      <span>{label}</span>
      <select value={value} onChange={e => set(e.target.value)}>
        {books?.map(book => <option key={book} value={book}>{baseName(book)}</option>)}
      </select>
    </label>
  )
  const summary = useMemo(() => typeof result === 'object' && result
    ? `${result.added} word${result.added === 1 ? '' : 's'} added, ${result.removed} taken out, on ${result.pages} page${result.pages === 1 ? '' : 's'}`
    : '', [result])

  if (books && books.length < 2) {
    return (
      <div className="note compare">
        <div className="review-empty">
          <h2>Compare two books</h2>
          <p>Open two books first (a draft and its final version, say). Each book can be compared once it has been opened in Sidepage.</p>
        </div>
      </div>
    )
  }
  return (
    <div className="note compare">
      <div className="compare-bar">
        {picker(older, setOlder, 'Earlier')}
        <Tool quiet icon={ArrowLeftRight} label="Swap" onClick={() => { setOlder(newer); setNewer(older) }} />
        {picker(newer, setNewer, 'Later')}
        <label className="ask-meaning"><input type="checkbox" checked={ignoreCase} onChange={e => setIgnoreCase(e.target.checked)} /> Ignore capital letters</label>
      </div>
      {older === newer && older && <p className="guide-wait">Choose two different books.</p>}
      {busy && <p className="guide-wait">Comparing, word by word…</p>}
      {result === 'same' && <p className="guide-wait">The two say exactly the same thing.</p>}
      {result === 'too-different' && <p className="guide-wait">These two are too different to compare word by word.</p>}
      {summary && <p className="compare-summary">{summary}</p>}
      {typeof result === 'object' && result?.changes.map((change, i) => (
        <button key={i} className="kin compare-change" onClick={() => go(change.place)}>
          <span className="hit-book">{placeName(change.place)}</span>
          {change.before} {change.removed && <del>{change.removed}</del>} {change.added && <ins>{change.added}</ins>} {change.after}
        </button>
      ))}
    </div>
  )
}
