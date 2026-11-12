import { useEffect, useRef, useState, type RefObject } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { acronymsIn, captionsOf, citationsIn, figureMentionsIn, findReference, layoutOf, referencesOf, type Acronym, type Caption, type Reference } from '../lib/paper'
import { placeName } from '../lib/library'

// Peek: rest the pointer on "[12]", "(Smith et al., 2020)", "Figure 3", "Table 2" or an acronym in a PDF, and what
// it points to shows beside it (on a touch screen, tap it): the entry in the references, a picture of the figure,
// what the letters stand for. One tap goes there; ↩ in the bar comes back.
type Shown =
  | { kind: 'reference'; cited: string; entries: Reference[] }
  | { kind: 'figure'; caption: Caption; picture?: string }
  | { kind: 'acronym'; acronym: Acronym }
type Peeked = Shown & { x: number; y: number; key: string }

export function usePeek({ container, doc, file, go }: {
  container: RefObject<HTMLDivElement | null>
  doc: PDFDocumentProxy | null
  file: string
  go(page: number): void
}) {
  const known = useRef<{ references: Reference[]; captions: Map<string, Caption>; acronyms: Map<string, Acronym> } | null>(null)
  useEffect(() => {
    known.current = null
    if (!doc) return
    let cancelled = false
    void layoutOf(doc).then(layout => {
      // The text of each page, from its lines (ready as soon as the layout is, even the first time a book opens).
      const pages = new Map<number, string[]>()
      for (const line of layout.lines) pages.set(line.page, [...(pages.get(line.page) ?? []), line.text])
      const stretches = [...pages].map(([page, lines]) => ({ place: `page=${page}`, text: lines.join(' ') }))
      if (!cancelled) known.current = { references: referencesOf(layout), captions: captionsOf(layout), acronyms: acronymsIn(stretches) }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [doc, file])

  const [peek, setPeek] = useState<Peeked | null>(null)
  const pictures = useRef(new Map<string, string>())
  const timer = useRef(0)
  const over = useRef(false)

  // What lies under the point (x, y) of the page's text, if anything worth peeking at.
  const under = (x: number, y: number): (Shown & { key: string }) | null => {
    const facts = known.current
    if (!facts) return null
    const caret = (document as Document & { caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null }).caretPositionFromPoint?.(x, y)
    const range = caret ? null : document.caretRangeFromPoint?.(x, y)
    const node = caret?.offsetNode ?? range?.startContainer
    const offset = caret?.offset ?? range?.startOffset ?? 0
    const span = node?.parentElement
    if (!node || !span?.closest('.textLayer') || !container.current?.contains(span)) return null
    // A citation is often split over two pieces of text: the piece and its neighbours are read as one.
    const before = span.previousElementSibling?.textContent ?? ''
    const text = before + (span.textContent ?? '') + (span.nextElementSibling?.textContent ?? '')
    const at = before.length + offset
    for (const citation of citationsIn(text)) {
      if (at < citation.from - 1 || at > citation.to) continue
      const entries = citation.keys.map(key => findReference(facts.references, key)).filter((entry): entry is Reference => !!entry)
      if (entries.length) return { kind: 'reference', cited: text.slice(citation.from, citation.to), entries: entries.slice(0, 6), key: `r${citation.keys.join(',')}` }
    }
    for (const mention of figureMentionsIn(text)) {
      if (at < mention.from - 1 || at > mention.to) continue
      // "Fig. 1a" is a part of Figure 1.
      const caption = facts.captions.get(mention.key) ?? facts.captions.get(mention.key.replace(/[a-z]$/, ''))
      const page = Number(span.closest<HTMLElement>('.page')?.dataset.pageNumber)
      // The caption itself is not a mention of the figure.
      if (caption && !(caption.page === page && text.slice(mention.from).startsWith(caption.text.slice(0, 8)))) return { kind: 'figure', caption, key: mention.key }
    }
    const word = [...text.matchAll(/[\p{Lu}][\p{L}\p{N}&-]{1,9}/gu)].find(match => at >= match.index! && at <= match.index! + match[0].length)
    const acronym = word && (facts.acronyms.get(word[0]) ?? facts.acronyms.get(word[0].replace(/s$/, '')))
    if (acronym) return { kind: 'acronym', acronym, key: `a${acronym.short}` }
    return null
  }

  // A picture of the figure: the part of its page above its caption (a table: below it), drawn once.
  const picture = async (caption: Caption) => {
    const key = `${caption.page}:${caption.label}`
    if (pictures.current.has(key) || !doc) return pictures.current.get(key)
    const page = await doc.getPage(caption.page)
    const natural = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: 900 / natural.width })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
    const [from, to] = caption.kind === 'table'
      ? [Math.max(0, caption.top - 0.02), Math.min(1, caption.top + 0.5)]
      : [Math.max(0, caption.top - 0.5), Math.min(1, caption.bottom + 0.08)]
    const cut = document.createElement('canvas')
    cut.width = canvas.width
    cut.height = Math.max(1, Math.round((to - from) * canvas.height))
    cut.getContext('2d')!.drawImage(canvas, 0, from * canvas.height, canvas.width, cut.height, 0, 0, cut.width, cut.height)
    const url = cut.toDataURL('image/jpeg', 0.85)
    pictures.current.set(key, url)
    return url
  }

  // Scrolling the page, or touching anything else, puts the peek away.
  useEffect(() => {
    if (!peek) return
    const away = (e: Event) => { if (!(e.target as HTMLElement)?.closest?.('.peek')) setPeek(null) }
    const scroller = container.current
    scroller?.addEventListener('scroll', away, { passive: true })
    window.addEventListener('pointerdown', away, true)
    return () => { scroller?.removeEventListener('scroll', away); window.removeEventListener('pointerdown', away, true) }
  }, [peek, container])

  const show = (found: Shown & { key: string }, x: number, y: number) => {
    setPeek({ ...found, x, y })
    if (found.kind === 'figure') void picture(found.caption).then(url => setPeek(now => (now?.key === found.key ? { ...now, picture: url } as Peeked : now)))
  }
  const hideSoon = () => {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { if (!over.current) setPeek(null) }, 350)
  }

  const handlers = {
    onPointerMove: (e: React.PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.buttons) return
      const { clientX: x, clientY: y } = e
      const found = under(x, y)
      if (found?.key === peek?.key && found) return void clearTimeout(timer.current)
      clearTimeout(timer.current)
      if (!found) return hideSoon()
      timer.current = window.setTimeout(() => show(found, x, y), 320)
    },
    onPointerLeave: () => hideSoon(),
    onClick: (e: React.MouseEvent) => {
      if (window.getSelection()?.toString()) return
      const found = under(e.clientX, e.clientY)
      if (found && (e.nativeEvent as PointerEvent).pointerType !== 'mouse') show(found, e.clientX, e.clientY)
    },
  }

  const left = peek ? Math.max(8, Math.min(peek.x - 40, window.innerWidth - 400)) : 0
  const below = peek ? peek.y < window.innerHeight * 0.55 : true
  const view = peek && (
    <div
      className="peek"
      style={{ left, ...(below ? { top: peek.y + 18 } : { bottom: window.innerHeight - peek.y + 14 }) }}
      onPointerEnter={() => { over.current = true; clearTimeout(timer.current) }}
      onPointerLeave={() => { over.current = false; hideSoon() }}
    >
      {peek.kind === 'reference' && <>
        <p className="peek-head">{peek.cited}</p>
        {peek.entries.map((entry, i) => (
          <div key={i} className="peek-reference">
            <p>{entry.number ? <b>[{entry.number}] </b> : null}{entry.text}</p>
            <button className="link-button" onClick={() => { setPeek(null); go(entry.page) }}>{`In the references, p. ${entry.page}`}</button>
          </div>
        ))}
      </>}
      {peek.kind === 'figure' && <>
        <p className="peek-head">{peek.caption.label} · p. {peek.caption.page}</p>
        {peek.picture ? <img src={peek.picture} alt={peek.caption.text} /> : <p className="peek-wait">Drawing it…</p>}
        <p className="peek-caption">{peek.caption.text}</p>
        <button className="link-button" onClick={() => { setPeek(null); go(peek.caption.page) }}>{`Go to p. ${peek.caption.page}`}</button>
      </>}
      {peek.kind === 'acronym' && <>
        <p><b>{peek.acronym.short}</b>: {peek.acronym.long}</p>
        <button className="link-button" onClick={() => { setPeek(null); go(Number(peek.acronym.place.replace('page=', '')) || 1) }}>{`First spelled out, ${placeName(peek.acronym.place)}`}</button>
      </>}
    </div>
  )
  return { handlers, view, close: () => setPeek(null) }
}
