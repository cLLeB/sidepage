import { useEffect, useRef, useState, type RefObject } from 'react'

// Pinching to zoom, wherever a page is open: two fingers on a touch screen, two fingers on a laptop's touchpad
// (which arrives as a wheel turned with Ctrl held), or Ctrl and the mouse wheel. `zoomBy` is told how much larger
// (above 1) or smaller (below 1) the page should become. Returns what takes the listening away again.
export function onPinch(surface: HTMLElement | Document, zoomBy: (factor: number) => void): () => void {
  const onWheel = (e: Event) => {
    const wheel = e as WheelEvent
    if (!wheel.ctrlKey && !wheel.metaKey) return
    wheel.preventDefault()
    // A touchpad sends many small steps, a mouse wheel a few large ones: both are kept gentle.
    const step = wheel.deltaMode === 1 ? wheel.deltaY * 16 : wheel.deltaY
    zoomBy(Math.exp(-Math.max(-60, Math.min(60, step)) * 0.01))
  }
  let last = 0
  const spread = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
  const onTouchStart = (e: Event) => { const touch = e as TouchEvent; if (touch.touches.length === 2) last = spread(touch) }
  const onTouchMove = (e: Event) => {
    const touch = e as TouchEvent
    if (!last || touch.touches.length !== 2) return
    touch.preventDefault()
    const now = spread(touch)
    // Small trembles of the fingers are let pass; a real spread or pinch is followed as it grows.
    if (Math.abs(now - last) / last < 0.03) return
    zoomBy(now / last)
    last = now
  }
  const onTouchEnd = () => { last = 0 }
  surface.addEventListener('wheel', onWheel, { passive: false })
  surface.addEventListener('touchstart', onTouchStart, { passive: true })
  surface.addEventListener('touchmove', onTouchMove, { passive: false })
  surface.addEventListener('touchend', onTouchEnd)
  surface.addEventListener('touchcancel', onTouchEnd)
  return () => {
    surface.removeEventListener('wheel', onWheel)
    surface.removeEventListener('touchstart', onTouchStart)
    surface.removeEventListener('touchmove', onTouchMove)
    surface.removeEventListener('touchend', onTouchEnd)
    surface.removeEventListener('touchcancel', onTouchEnd)
  }
}

// For pages that have no zoom of their own (documents, slides, pictures, DjVu): what is inside `body` is made
// larger or smaller as a whole, and the body scrolls to whatever no longer fits. `ready` changes when the page
// inside has been put there. Returns the zoom (1 is the size it opened at) and a way to set it.
// `how`: 'text' makes the words larger and lets them wrap again (plain text), instead of enlarging the whole page.
export function usePinchZoom(body: RefObject<HTMLElement | null>, ready?: unknown, how: 'page' | 'text' = 'page'): [number, (zoom: number) => void] {
  const [zoom, setZoom] = useState(1)
  const now = useRef(1)
  const set = (value: number) => {
    now.current = Math.max(0.4, Math.min(5, value))
    setZoom(Math.round(now.current * 100) / 100)
  }
  useEffect(() => {
    const el = body.current
    if (!el) return
    return onPinch(el, factor => set(now.current * factor))
  }, [body, ready]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = body.current
    if (!el) return
    if (how === 'text') el.style.fontSize = zoom === 1 ? '' : `${Math.round(zoom * 100)}%`
    else for (const child of el.children) (child as HTMLElement).style.zoom = zoom === 1 ? '' : String(zoom)
  }, [body, zoom, ready, how])
  return [zoom, set]
}
