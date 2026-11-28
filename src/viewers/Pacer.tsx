import { useCallback, useEffect, useRef, useState } from 'react'
import { Minus, Pause, Play, Plus, X } from 'lucide-react'
import type { RsvpEngine } from '@rsvp-engine/core'
import type { Box, Word } from '../lib/pdfWords'
import { usePref } from '../lib/prefs'

// The pacer: a soft shade that goes from word to word over the page itself, at a steady reading pace, for a reader
// who keeps their place with the pointer or a finger. (Webcam eye tracking cannot tell one line from the next:
// its error is several lines tall. A pacer is how reading apps and speed-reading courses do it.)
// The timing, with longer rests after commas and full stops, is @rsvp-engine/core's, as in Speed reading. The words
// and where they stand come from the PDF itself (lib/pdfWords.ts); the reader only says where a page is on screen.
export type PacedWord = Word & { page: number }
export type PacerHost = {
  // The words of page `page` (1-based), [] for none, null past the end.
  words(page: number): Promise<Word[] | null>
  currentPage(): number
  // A box of page `page`, in page points, as it stands on screen now (client pixels), or null when out of view.
  toScreen(page: number, box: Box): DOMRect | null
  // The part of the screen the pages are shown in.
  view(): DOMRect | null
  // Brings a page into view (to read its words when it is reached), and scrolls by so many pixels.
  goTo(page: number): void
  scrollBy(dy: number): void
  // The page and the point on it under a spot on the screen.
  pageAt(x: number, y: number): { page: number; x: number; y: number } | null
}

export function usePacer(host: PacerHost) {
  const [wpm, setWpm] = usePref('pacer-wpm', 240)
  const [on, setOn] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [word, setWord] = useState<PacedWord | null>(null)
  const engine = useRef<RsvpEngine<string, PacedWord> | null>(null)
  const words = useRef<PacedWord[]>([])
  const lastTouch = useRef<{ x: number; y: number; at: number } | null>(null)
  const scrollingMyself = useRef(0)
  const hostRef = useRef(host)
  hostRef.current = host

  // Keeps the shaded word in the middle band of the view, scrolling only when it nears an edge.
  const follow = useCallback((next: PacedWord | null) => {
    setWord(next)
    if (!next) return
    const box = hostRef.current.toScreen(next.page, next)
    const view = hostRef.current.view()
    if (!view) return
    if (!box) { scrollingMyself.current = Date.now(); hostRef.current.goTo(next.page); return }
    const gone = box.top > view.bottom - 4 || box.bottom < view.top + 4
    const nearEdge = box.bottom > view.top + view.height * 0.72 || box.top < view.top + view.height * 0.12
    if (gone || (nearEdge && Date.now() - scrollingMyself.current > 700)) {
      scrollingMyself.current = Date.now()
      hostRef.current.scrollBy(box.top - (view.top + view.height * 0.35))
    }
  }, [])

  const load = useCallback(async (page: number, from = 0) => {
    const { TextTokenizer } = await import('@rsvp-engine/core')
    let list = await hostRef.current.words(page)
    // A page with no words (a picture, a blank page): on to the next.
    while (list && !list.length) list = await hostRef.current.words(++page)
    if (!list?.length) return false
    words.current = list.map(w => ({ ...w, page }))
    const tokenizer = new TextTokenizer()
    const tokens = words.current.map(w => ({ ...(tokenizer.tokenize(w.text)[0] ?? { value: w.text, ovpIndex: 0, durationMultiplier: 1 }), value: w.text, meta: w }))
    engine.current?.loadTokens(tokens)
    engine.current?.seek(Math.max(0, Math.min(from, list.length - 1)))
    return true
  }, [])

  // The word to begin at: the one last touched or clicked on the page, if that was lately; else the first in view.
  const startingWord = useCallback(async () => {
    const h = hostRef.current
    const touch = lastTouch.current && Date.now() - lastTouch.current.at < 60_000 ? lastTouch.current : null
    const at = touch ? h.pageAt(touch.x, touch.y) : null
    const page = at?.page ?? h.currentPage()
    const list = (await h.words(page)) ?? []
    const view = h.view()
    let best = 0, bestDistance = Infinity
    list.forEach((w, i) => {
      const distance = at
        ? Math.abs(w.y + w.h / 2 - at.y) * 4 + Math.abs(w.x + w.w / 2 - at.x)
        : (() => { const box = h.toScreen(page, w); return box && view && box.top >= view.top + 4 ? box.top - view.top : Infinity })()
      if (distance < bestDistance) { bestDistance = distance; best = i }
    })
    return { page, index: best }
  }, [])

  const stop = useCallback(() => {
    engine.current?.destroy()
    engine.current = null
    words.current = []
    setWord(null)
    setOn(false)
    setPlaying(false)
  }, [])

  const start = useCallback(async () => {
    if (engine.current) return stop()
    const { RsvpEngine } = await import('@rsvp-engine/core')
    const made = new RsvpEngine<string, PacedWord>({ wpm, onError: () => {} } as ConstructorParameters<typeof RsvpEngine<string, PacedWord>>[0])
    engine.current = made
    made.subscribe((snapshot, event) => {
      if (engine.current !== made) return
      if (event === 'advanced' || event === 'navigated' || event === 'loaded') follow(snapshot.currentItem?.meta ?? null)
      if (event === 'completed') {
        // The end of the page: on to the next, without a stop.
        const page = (words.current[0]?.page ?? 0) + 1
        void load(page).then(more => { if (engine.current === made) { if (more) made.play(); else stop() } })
      }
      setPlaying(snapshot.state === 'PLAYING')
    })
    const { page, index } = await startingWord()
    setOn(true)
    if (await load(page, index)) { follow(made.currentItem?.meta ?? null); made.play() } else stop()
  }, [wpm, follow, load, startingWord, stop])

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

  // A tap or click on a word moves the shade there; scrolling by hand pauses it; Space pauses, Escape stops.
  const touched = useCallback((x: number, y: number) => {
    lastTouch.current = { x, y, at: Date.now() }
    const running = engine.current
    if (!running) return
    const at = hostRef.current.pageAt(x, y)
    if (!at) return
    let best = -1, bestDistance = 14
    words.current.forEach((w, i) => {
      if (w.page !== at.page) return
      const distance = Math.hypot(Math.max(w.x - at.x, 0, at.x - w.x - w.w), Math.max(w.y - at.y, 0, at.y - w.y - w.h))
      if (distance < bestDistance) { bestDistance = distance; best = i }
    })
    if (best >= 0) running.seek(best)
  }, [])
  const scrolledByHand = useCallback(() => {
    if (!engine.current || Date.now() - scrollingMyself.current < 900) return
    if (engine.current.state === 'PLAYING') engine.current.pause()
  }, [])
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
  useEffect(() => () => { engine.current?.destroy() }, [])

  return { on, playing, wpm, word, start, stop, toggle, faster, touched, scrolledByHand }
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
