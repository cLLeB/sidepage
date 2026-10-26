import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { Tool } from '../ui'
import { baseName, goToPlace, openBookByName, shelf } from '../lib/platform'
import { hasWords, placeName, type Stretch } from '../lib/library'

// Two books compared word by word (jsdiff): a draft and the paper it became, last year's lecture and this year's.
// Every change is shown where it falls in the newer one, a few words either side, with the page to go to.
type Change = { place: string; before: string; removed: string; added: string; after: string }
type Result = { changes: Change[]; added: number; removed: number; pages: number } | 'too-different' | 'same'

const words = (text: string) => text.split(/\s+/).filter(Boolean).length
const tail = (text: string, count: number) => { const all = text.split(/\s+/).filter(Boolean); return (all.length > count ? '… ' : '') + all.slice(-count).join(' ') }
const head = (text: string, count: number) => { const all = text.split(/\s+/).filter(Boolean); return all.slice(0, count).join(' ') + (all.length > count ? ' …' : '') }

async function compare(older: string, newer: string, ignoreCase: boolean): Promise<Result> {
  const { get } = await import('idb-keyval')
  const [was, now] = await Promise.all([get<Stretch[]>(`text:${older}`), get<Stretch[]>(`text:${newer}`)])
  const flat = (stretches: Stretch[]) => stretches.map(stretch => stretch.text.replace(/\s+/g, ' ').trim()).join(' ')
  // Where each page of the newer book starts in its text, so each change can be given its page.
  const starts: { at: number; place: string }[] = []
  let length = 0
  for (const stretch of now ?? []) { starts.push({ at: length, place: stretch.place }); length += stretch.text.replace(/\s+/g, ' ').trim().length + 1 }
  const placeAt = (at: number) => { let place = starts[0]?.place ?? ''; for (const start of starts) { if (start.at > at) break; place = start.place } return place }
  const { diffWords } = await import('diff')
  const parts = await new Promise<ReturnType<typeof diffWords> | undefined>(resolve => diffWords(flat(was ?? []), flat(now ?? []), { ignoreCase, timeout: 15000, callback: resolve }))
  if (!parts) return 'too-different'
  const changes: Change[] = []
  let at = 0, added = 0, removed = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part.added && !part.removed) { at += part.value.length; continue }
    // A removal followed by an addition is one change: this was written, and became that.
    const next = parts[i + 1]
    const removedText = part.removed ? part.value : ''
    const addedText = part.added ? part.value : next?.added && part.removed ? next.value : ''
    if (part.removed && next?.added) i++
    if (!removedText.trim() && !addedText.trim()) { at += addedText.length; continue }
    removed += words(removedText); added += words(addedText)
    const before = parts.slice(0, i + 1).filter(p => !p.added && !p.removed).at(-1)?.value ?? ''
    const after = parts.slice(i + 1).find(p => !p.added && !p.removed)?.value ?? ''
    const last = changes.at(-1)
    const place = placeAt(at)
    // Changes a word or two apart read better as one.
    if (last && last.place === place && words(before) <= 3 && last.after === before) {
      last.removed += ` ${before} ${removedText}`.replace(/\s+/g, ' ')
      last.added += ` ${before} ${addedText}`.replace(/\s+/g, ' ')
      last.after = head(after, 12)
    } else {
      changes.push({ place, before: tail(before, 12), removed: removedText.trim(), added: addedText.trim(), after: head(after, 12) })
    }
    at += addedText.length
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
