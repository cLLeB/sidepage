import { useEffect, useRef, useState, type RefObject } from 'react'

// Pinching to zoom, wherever a page is open: two fingers on a touch screen, two fingers on a laptop's touchpad
// (which arrives as a wheel turned with Ctrl held), or Ctrl and the mouse wheel.
// While the fingers move, `move` is told how much larger (above 1) or smaller (below 1) the page should be than
// when the pinch began, and where the fingers are; `end` is told the same once they are lifted. Pages show the
// pinch as it happens by stretching what is already drawn (see `stretch`), and are drawn again, sharp, only at the
// end: drawing a page again at every step makes it blink.
export type Focus = { x: number; y: number }
export type Pinch = {
  move(scale: number, at: Focus, pan: Focus): void
  end(scale: number, at: Focus): void
  // Two fingers moving together: how far the page should follow them since last time.
  pan?(by: Focus): void
}
// On a touch screen the page follows two fingers as they move, and zooms only once they have clearly spread or
// closed: two fingers scrolling side by side never zoom by accident. `at` is always where the fingers are now, so
// the page zooms toward them; `pan` is how far they moved since the last step. Android's web view does not scroll
// a page under two fingers by itself, so the following is done here (and the screen's own handling stopped).
const DEAD_ZONE = 14
const none: Focus = { x: 0, y: 0 }
export function onPinch(surface: HTMLElement | Document, pinch: Pinch): () => void {
  let start = 0, first = 0, scale = 1, at: Focus = { x: 0, y: 0 }, pinching = false
  const follow = pinch.pan ?? ((by: Focus) => { if (surface instanceof HTMLElement) { surface.scrollLeft -= by.x; surface.scrollTop -= by.y } })
  // Ctrl and the wheel (and a touchpad pinch) come as many small steps: one pinch is the steps close together.
  let wheelEnds = 0
  const onWheel = (e: Event) => {
    const wheel = e as WheelEvent
    if (!wheel.ctrlKey && !wheel.metaKey) return
    wheel.preventDefault()
    const step = wheel.deltaMode === 1 ? wheel.deltaY * 16 : wheel.deltaY
    if (!wheelEnds) scale = 1
    at = { x: wheel.clientX, y: wheel.clientY }
    scale = Math.max(0.2, Math.min(6, scale * Math.exp(-Math.max(-60, Math.min(60, step)) * 0.01)))
    pinch.move(scale, at, none)
    clearTimeout(wheelEnds)
    wheelEnds = window.setTimeout(() => { wheelEnds = 0; pinch.end(scale, at) }, 180)
  }
  const spread = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
  const middle = (e: TouchEvent) => ({ x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 })
  const finish = () => {
    const was = pinching
    start = first = 0
    pinching = false
    if (was) pinch.end(Math.abs(scale - 1) > 0.02 ? scale : 1, at)
  }
  const onTouchStart = (e: Event) => {
    const touch = e as TouchEvent
    if (touch.touches.length === 2) { first = spread(touch); start = 0; scale = 1; pinching = false; at = middle(touch) }
    else if (touch.touches.length > 2) finish()
  }
  const onTouchMove = (e: Event) => {
    const touch = e as TouchEvent
    if (!first || touch.touches.length !== 2) return
    // Once the screen has begun a scroll of its own, it carries the page; otherwise the page is moved here.
    const own = touch.cancelable
    if (own) touch.preventDefault()
    const now = spread(touch), was = at
    at = middle(touch)
    const pan = own ? { x: at.x - was.x, y: at.y - was.y } : none
    if (!pinching) {
      if (Math.abs(now - first) < DEAD_ZONE) { if (pan.x || pan.y) follow(pan); return }
      pinching = true
      start = now
    }
    scale = Math.max(0.2, Math.min(6, now / start))
    pinch.move(scale, at, pan)
  }
  const onTouchEnd = (e: Event) => {
    if (!first || (e as TouchEvent).touches.length >= 2) return
    finish()
  }
  surface.addEventListener('wheel', onWheel, { passive: false })
  surface.addEventListener('touchstart', onTouchStart, { passive: true })
  surface.addEventListener('touchmove', onTouchMove, { passive: false })
  surface.addEventListener('touchend', onTouchEnd)
  surface.addEventListener('touchcancel', onTouchEnd)
  return () => {
    clearTimeout(wheelEnds)
    surface.removeEventListener('wheel', onWheel)
    surface.removeEventListener('touchstart', onTouchStart)
    surface.removeEventListener('touchmove', onTouchMove)
    surface.removeEventListener('touchend', onTouchEnd)
    surface.removeEventListener('touchcancel', onTouchEnd)
  }
}

// While a pinch goes on: `content` is stretched by the graphics card around the spot under the fingers, which
// costs nothing and stays smooth. `stretch(content, 1)` takes the stretch away.
export function stretch(content: HTMLElement, scale: number, at?: Focus) {
  if (scale === 1 || !at) {
    content.style.transform = ''
    content.style.transformOrigin = ''
    content.style.willChange = ''
    return
  }
  const box = content.getBoundingClientRect()
  // The origin is the spot under the fingers, measured from the content's own corner (before any stretch).
  const before = parseFloat(content.dataset.pinchScale ?? '1')
  const origin = content.style.transformOrigin && before !== 1
    ? content.style.transformOrigin
    : `${at.x - box.left}px ${at.y - box.top}px`
  content.style.willChange = 'transform'
  content.style.transformOrigin = origin
  content.style.transform = `scale(${scale})`
  content.dataset.pinchScale = String(scale)
}
export function unstretch(content: HTMLElement) {
  stretch(content, 1)
  delete content.dataset.pinchScale
}

// After the page in `scroller` grew or shrank by `ratio`, scrolls it so the spot that was under `at` is under it
// again: zooming toward the fingers, as in a photo viewer.
export function keepUnder(scroller: HTMLElement, ratio: number, at: Focus) {
  const box = scroller.getBoundingClientRect()
  const x = at.x - box.left, y = at.y - box.top
  scroller.scrollLeft = (scroller.scrollLeft + x) * ratio - x
  scroller.scrollTop = (scroller.scrollTop + y) * ratio - y
}

// For pages that have no zoom of their own (documents, slides, pictures, DjVu): what is inside `body` is made
// larger or smaller as a whole, and the body scrolls to whatever no longer fits. `ready` changes when the page
// inside has been put there. Returns the zoom (1 is the size it opened at) and a way to set it.
export function usePinchZoom(body: RefObject<HTMLElement | null>, ready?: unknown): [number, (zoom: number) => void] {
  const [zoom, setZoom] = useState(1)
  const now = useRef(1)
  const focus = useRef<{ at: Focus; ratio: number } | null>(null)
  const set = (value: number, at?: Focus) => {
    const next = Math.max(0.4, Math.min(5, value))
    if (at) focus.current = { at, ratio: next / now.current }
    now.current = next
    setZoom(Math.round(next * 100) / 100)
  }
  useEffect(() => {
    const el = body.current
    if (!el) return
    const inside = () => [...el.children] as HTMLElement[]
    return onPinch(el, {
      move: (scale, at, pan) => { el.scrollLeft -= pan.x; el.scrollTop -= pan.y; const limited = Math.max(0.4, Math.min(5, now.current * scale)) / now.current; for (const child of inside()) stretch(child, limited, at) },
      end: (scale, at) => { for (const child of inside()) unstretch(child); if (scale !== 1) set(now.current * scale, at) },
    })
  }, [body, ready]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = body.current
    if (!el) return
    for (const child of el.children) (child as HTMLElement).style.zoom = zoom === 1 ? '' : String(zoom)
    if (focus.current) { keepUnder(el, focus.current.ratio, focus.current.at); focus.current = null }
  }, [body, zoom, ready])
  return [zoom, set]
}

// For pages of flowing words (e-books, text files): while the fingers move, the page is stretched; when they lift,
// the words are set again at the size the stretch showed (`resize` is given the change, 1.2 for a fifth larger).
// `frame`: the pinch happened inside the page's own frame, whose coordinates start at its corner.
export function textPinch(shown: () => HTMLElement | null | undefined, resize: (scale: number) => void, frame?: () => Element | null | undefined): Pinch {
  const onScreen = (at: Focus) => {
    const box = frame?.()?.getBoundingClientRect()
    return box ? { x: at.x + box.left, y: at.y + box.top } : at
  }
  return {
    move: (scale, at) => { const page = shown(); if (page) stretch(page, scale, onScreen(at)) },
    end: scale => { const page = shown(); if (page) unstretch(page); if (scale !== 1) resize(scale) },
  }
}
