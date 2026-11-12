import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Ellipsis } from 'lucide-react'
import { HIGHLIGHT_COLOURS } from './ReaderMenus'

// The bar that comes up beside words you select on a page, as in Kindle or Readwise: highlight them in a colour,
// quote them into your notes, look them up, translate them, ask the AI, and under ⋯ everything else that works on
// a passage. Tapping it keeps the selection (its buttons never take the focus).
// Whether a node is inside an element, looking through shadow roots (an e-book's frames sit in one).
const within = (outer: Element | null, node: Node | null): boolean => {
  for (let at: Node | null = node; at; at = at.parentNode ?? ((at as ShadowRoot).host ?? null)) if (at === outer) return true
  return false
}
export type Action = { icon: LucideIcon; label: string; hint?: string; run(text: string): void }

export default function SelectionBar({ host, frames, onHighlight, actions, more }: {
  host: RefObject<HTMLElement | null>
  // Pages shown in frames of their own (an e-book's chapters): their selections count too.
  frames?: () => Document[]
  onHighlight?(colour: string): void
  actions: Action[]
  more: Action[]
}) {
  const [at, setAt] = useState<{ x: number; top: number; bottom: number } | null>(null)
  const [open, setOpen] = useState(false)
  const picked = useRef<Document>(document)
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let timer = 0
    const look = () => {
      clearTimeout(timer)
      // A moment after the selection stops changing, so it does not jump about while the finger moves.
      timer = window.setTimeout(() => {
        // The selection in the page itself, or in one of its frames (placed by the frame's own position).
        for (const doc of [document, ...(frames?.() ?? [])]) {
          const selection = doc.getSelection()
          const text = selection?.toString().trim()
          const range = text && selection!.rangeCount ? selection!.getRangeAt(0) : null
          if (!range) continue
          const frame = doc.defaultView?.frameElement
          const inside = within(host.current, frame ?? range.commonAncestorContainer)
          if (!inside) continue
          const box = range.getBoundingClientRect()
          const offset = frame?.getBoundingClientRect() ?? { left: 0, top: 0 }
          if (!box.width && !box.height) continue
          picked.current = doc
          setAt({ x: offset.left + box.left + box.width / 2, top: offset.top + box.top, bottom: offset.top + box.bottom })
          return
        }
        setAt(null); setOpen(false)
      }, 220)
    }
    const away = () => { setAt(null); setOpen(false) }
    document.addEventListener('selectionchange', look)
    // Frames come and go as chapters load: each is listened to once it is there.
    const heard = new Set<Document>()
    const join = window.setInterval(() => { for (const doc of frames?.() ?? []) if (!heard.has(doc)) { heard.add(doc); doc.addEventListener('selectionchange', look) } }, 800)
    const scroller = host.current
    scroller?.addEventListener('scroll', away, { passive: true })
    return () => { clearTimeout(timer); clearInterval(join); for (const doc of heard) doc.removeEventListener('selectionchange', look); document.removeEventListener('selectionchange', look); scroller?.removeEventListener('scroll', away) }
  }, [host, frames])
  // Placed above the words, or under them when there is no room above (and always under them on a touch screen,
  // where the system's own copy menu sits above).
  const [place, setPlace] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  useLayoutEffect(() => {
    if (!at || !bar.current) return
    const { width, height } = bar.current.getBoundingClientRect()
    const touch = matchMedia('(pointer: coarse)').matches
    const above = !touch && at.top - height - 10 > 60
    setPlace({ left: Math.max(8, Math.min(innerWidth - width - 8, at.x - width / 2)), top: above ? at.top - height - 10 : Math.min(innerHeight - height - 8, at.bottom + 12) })
  }, [at, open])
  if (!at) return null
  const text = () => picked.current.getSelection()?.toString().trim().replace(/\s+/g, ' ') ?? ''
  const done = () => { setAt(null); setOpen(false) }
  const button = (action: Action, wide = false) => (
    <button key={action.label} className={wide ? 'selection-more-item' : 'selection-action'} title={action.hint ?? action.label} aria-label={action.label}
      onClick={() => { const words = text(); if (words) { action.run(words); done() } }}>
      <action.icon size={wide ? 16 : 17} strokeWidth={1.9} aria-hidden />
      <span>{action.label}</span>
    </button>
  )
  return (
    <div ref={bar} className="selection-bar" role="toolbar" aria-label="Selected words" style={{ left: place.left, top: place.top }}
      onPointerDown={e => e.preventDefault()} onMouseDown={e => e.preventDefault()}>
      <div className="selection-row">
        {onHighlight && <span className="selection-swatches">
          {Object.entries(HIGHLIGHT_COLOURS).map(([name, colour]) => (
            <button key={name} className="swatch" style={{ background: colour }} title={`Highlight in ${name.toLowerCase()}`} aria-label={`Highlight in ${name.toLowerCase()}`} onClick={() => { onHighlight(colour); done() }} />
          ))}
        </span>}
        {actions.map(action => button(action))}
        {more.length > 0 && <button className={open ? 'selection-action on' : 'selection-action'} aria-label="More for these words" title="More for these words" onClick={() => setOpen(!open)}><Ellipsis size={17} aria-hidden /></button>}
      </div>
      {open && <div className="selection-more">{more.map(action => button(action, true))}</div>}
    </div>
  )
}
