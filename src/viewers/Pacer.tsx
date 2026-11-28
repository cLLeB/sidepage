import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Minus, Pause, Play, Plus, X } from 'lucide-react'
import type { RsvpEngine } from '@rsvp-engine/core'
import type { EventBus, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import { usePref } from '../lib/prefs'

// The pacer: a soft shade that goes from word to word over the page itself, at a steady reading pace, for a reader
// who keeps their place with the pointer or a finger. (Webcam eye tracking cannot tell one line from the next:
// its error is several lines tall. A pacer is how reading apps and speed-reading courses do it.)
// The timing, with longer rests after commas and full stops, is @rsvp-engine/core's, as in Speed reading. The words
// and where they stand are taken from the PDF's own text layer; nothing on the page is changed.
type Word = { page: number; span: number; start: number; end: number; text: string }

const leafSpans = (root: ParentNode | null | undefined, page: number) =>
  [...(root?.querySelectorAll<HTMLElement>(`.page[data-page-number="${page}"] .textLayer span`) ?? [])].filter(span => !span.querySelector('span'))

function wordsOf(root: ParentNode | null | undefined, page: number): Word[] {
  const words: Word[] = []
  leafSpans(root, page).forEach((span, index) => {
    for (const found of (span.textContent ?? '').matchAll(/\S+/g)) {
      if (!/[\p{L}\p{N}]/u.test(found[0])) continue
      words.push({ page, span: index, start: found.index, end: found.index + found[0].length, text: found[0] })
    }
  })
  return words
}

// Where a word stands on the screen now (the text layer is drawn again at each zoom, so it is looked up each time).
function boxOf(root: ParentNode | null | undefined, word: Word): DOMRect | null {
  const span = leafSpans(root, word.page)[word.span]
  const text = span?.firstChild
  if (!text || text.nodeType !== Node.TEXT_NODE) return span?.getBoundingClientRect() ?? null
  const range = document.createRange()
  const length = text.textContent?.length ?? 0
  range.setStart(text, Math.min(word.start, length))
  range.setEnd(text, Math.min(word.end, length))
  const box = range.getBoundingClientRect()
  return box.width ? box : span.getBoundingClientRect()
}

export function usePacer(container: RefObject<HTMLDivElement | null>, viewer: RefObject<PDFViewer | null>, bus: RefObject<EventBus | null>) {
  const [wpm, setWpm] = usePref('pacer-wpm', 240)
  const [on, setOn] = useState(false)
  const [playing, setPlaying] = useState(false)
  const engine = useRef<RsvpEngine<string, Word> | null>(null)
  const words = useRef<Word[]>([])
  const mark = useRef<HTMLDivElement | null>(null)
  const lastTouch = useRef<{ x: number; y: number; at: number } | null>(null)
  const scrollingMyself = useRef(0)

  // Shades the word, and keeps it in the middle band of the view, scrolling gently only when it nears an edge.
  const show = useCallback((word: Word | null) => {
    const root = container.current
    if (!word || !root) { mark.current?.remove(); mark.current = null; return }
    const page = root.querySelector<HTMLElement>(`.page[data-page-number="${word.page}"]`)
    const box = boxOf(root, word)
    if (!page || !box) return
    if (!mark.current || mark.current.parentElement !== page) {
      mark.current?.remove()
      mark.current = Object.assign(document.createElement('div'), { className: 'pacer-mark' })
      page.appendChild(mark.current)
    }
    const at = page.getBoundingClientRect()
    const pad = Math.max(2, box.height * 0.12)
    Object.assign(mark.current.style, {
      left: `${box.left - at.left - pad - page.clientLeft}px`, top: `${box.top - at.top - pad - page.clientTop}px`,
      width: `${box.width + pad * 2}px`, height: `${box.height + pad * 2}px`,
    })
    // A gentle scroll is let finish before another is asked for (each word asking anew would stop it short); a
    // word that has gone out of view altogether (a new page) is brought back at once.
    const view = root.getBoundingClientRect()
    const gone = box.top > view.bottom - 4 || box.bottom < view.top + 4
    const nearEdge = box.bottom > view.top + view.height * 0.72 || box.top < view.top + view.height * 0.12
    if (gone || (nearEdge && Date.now() - scrollingMyself.current > 700)) {
      scrollingMyself.current = Date.now()
      root.scrollBy({ top: box.top - (view.top + view.height * 0.35), behavior: gone ? 'instant' : 'smooth' })
    }
  }, [container])

  // The words of a page, once its text layer is there (a page out of view is drawn only when it comes near).
  const pageWords = useCallback(async (page: number): Promise<Word[]> => {
    const found = wordsOf(container.current, page)
    if (found.length || !viewer.current || page > (viewer.current.pagesCount ?? 0)) return found
    const drawn = new Promise<void>(resolve => {
      const done = (e: { pageNumber: number }) => { if (e.pageNumber === page) { bus.current?.off('textlayerrendered', done); resolve() } }
      bus.current?.on('textlayerrendered', done)
      setTimeout(() => { bus.current?.off('textlayerrendered', done); resolve() }, 4000)
    })
    viewer.current.scrollPageIntoView({ pageNumber: page })
    await drawn
    return wordsOf(container.current, page)
  }, [container, viewer, bus])

  const load = useCallback(async (page: number, from = 0) => {
    const { TextTokenizer } = await import('@rsvp-engine/core')
    let list = await pageWords(page)
    // A page with no words (a picture, a blank page): on to the next.
    while (!list.length && viewer.current && page < viewer.current.pagesCount) list = await pageWords(++page)
    if (!list.length) return false
    words.current = list
    const tokenizer = new TextTokenizer()
    const tokens = list.map(word => ({ ...(tokenizer.tokenize(word.text)[0] ?? { value: word.text, ovpIndex: 0, durationMultiplier: 1 }), value: word.text, meta: word }))
    engine.current?.loadTokens(tokens)
    engine.current?.seek(Math.max(0, Math.min(from, list.length - 1)))
    return true
  }, [pageWords, viewer])

  // The word to begin at: the one last touched or clicked on the page, if that was lately; else the first in view.
  const startingWord = useCallback(async () => {
    const root = container.current
    const page = viewer.current?.currentPageNumber ?? 1
    const list = await pageWords(page)
    if (!root || !list.length) return { page, index: 0 }
    const view = root.getBoundingClientRect()
    const touch = lastTouch.current && Date.now() - lastTouch.current.at < 60_000 ? lastTouch.current : null
    let best = 0, bestDistance = Infinity
    list.forEach((word, i) => {
      const box = boxOf(root, word)
      if (!box) return
      const distance = touch
        ? Math.abs(box.top + box.height / 2 - touch.y) * 4 + Math.abs(box.left + box.width / 2 - touch.x)
        : box.top >= view.top + 4 ? box.top - view.top : Infinity
      if (distance < bestDistance) { bestDistance = distance; best = i }
    })
    return { page, index: best }
  }, [container, viewer, pageWords])

  const stop = useCallback(() => {
    engine.current?.destroy()
    engine.current = null
    words.current = []
    show(null)
    setOn(false)
    setPlaying(false)
  }, [show])

  const start = useCallback(async () => {
    if (engine.current) return stop()
    const { RsvpEngine } = await import('@rsvp-engine/core')
    const made = new RsvpEngine<string, Word>({ wpm, onError: () => {} } as ConstructorParameters<typeof RsvpEngine<string, Word>>[0])
    engine.current = made
    made.subscribe((snapshot, event) => {
      if (engine.current !== made) return
      if (event === 'advanced' || event === 'navigated' || event === 'loaded') show(snapshot.currentItem?.meta ?? null)
      if (event === 'completed') {
        // The end of the page: on to the next, without a stop.
        const page = (words.current[0]?.page ?? 0) + 1
        void load(page).then(more => { if (engine.current === made) { if (more) made.play(); else stop() } })
      }
      setPlaying(snapshot.state === 'PLAYING')
    })
    const { page, index } = await startingWord()
    setOn(true)
    if (await load(page, index)) { show(made.currentItem?.meta ?? null); made.play() } else stop()
  }, [wpm, show, load, startingWord, stop])

  const toggle = useCallback(() => {
    const running = engine.current
    if (!running) return
    if (running.state === 'PLAYING') running.pause()
    else running.play()
  }, [])

  const faster = useCallback((by: number) => {
    const next = Math.max(80, Math.min(900, (engine.current?.wpm ?? wpm) + by))
    setWpm(next)
    engine.current?.setWpm(next)
  }, [wpm, setWpm])

  // Following the reader: a tap or click on a word moves the shade there; scrolling the page by hand pauses it
  // (it carries on from the word in view with Play); Space pauses and goes on, Escape stops.
  useEffect(() => {
    const root = container.current
    if (!root) return
    const touched = (e: PointerEvent) => {
      lastTouch.current = { x: e.clientX, y: e.clientY, at: Date.now() }
      const running = engine.current
      if (!running || (e.target as HTMLElement).closest('.pacer-bar')) return
      let best = -1, bestDistance = 28
      words.current.forEach((word, i) => {
        const box = boxOf(root, word)
        if (!box) return
        const distance = Math.hypot(Math.max(box.left - e.clientX, 0, e.clientX - box.right), Math.max(box.top - e.clientY, 0, e.clientY - box.bottom))
        if (distance < bestDistance) { bestDistance = distance; best = i }
      })
      if (best >= 0) running.seek(best)
    }
    const scrolled = () => {
      if (!engine.current || Date.now() - scrollingMyself.current < 900) return
      if (engine.current.state === 'PLAYING') engine.current.pause()
    }
    root.addEventListener('pointerdown', touched, true)
    root.addEventListener('wheel', scrolled, { passive: true })
    root.addEventListener('touchmove', scrolled, { passive: true })
    return () => {
      root.removeEventListener('pointerdown', touched, true)
      root.removeEventListener('wheel', scrolled)
      root.removeEventListener('touchmove', scrolled)
    }
  }, [container])
  useEffect(() => {
    if (!on) return
    const keys = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === ' ') { e.preventDefault(); toggle() }
      if (e.key === 'Escape') stop()
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [on, toggle, stop])
  // The zoom changed: the shade is put back over the same word at the new size.
  useEffect(() => {
    if (!on) return
    const again = () => setTimeout(() => show(engine.current?.currentItem?.meta ?? null), 60)
    bus.current?.on('textlayerrendered', again)
    return () => bus.current?.off('textlayerrendered', again)
  }, [on, bus, show])
  useEffect(() => () => { engine.current?.destroy() }, [])

  return { on, playing, wpm, start, stop, toggle, faster }
}

export function PacerBar({ pacer }: { pacer: ReturnType<typeof usePacer> }) {
  if (!pacer.on) return null
  return (
    <div className="pacer-bar" role="toolbar" aria-label="Pacer">
      <button onClick={pacer.toggle} aria-label={pacer.playing ? 'Pause' : 'Go on'} title={pacer.playing ? 'Pause (Space)' : 'Go on (Space)'}>
        {pacer.playing ? <Pause size={17} /> : <Play size={17} />}
      </button>
      <button onClick={() => pacer.faster(-20)} aria-label="Slower" title="Slower"><Minus size={16} /></button>
      <span className="pacer-pace" title="Words a minute">{pacer.wpm}</span>
      <button onClick={() => pacer.faster(20)} aria-label="Faster" title="Faster"><Plus size={16} /></button>
      <button onClick={pacer.stop} aria-label="Stop the pacer" title="Stop (Escape)"><X size={16} /></button>
    </div>
  )
}
