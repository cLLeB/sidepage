import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'

// One control in a toolbar: an icon with its name beside it. Where the bar is short of room the name drops
// away (see index.css) and stays available as the tooltip and for screen readers.
export function Tool({ icon: Icon, label, hint, on, quiet, disabled, onClick }: {
  icon: LucideIcon
  label: string
  hint?: string
  on?: boolean
  // Icon only, wherever it is shown.
  quiet?: boolean
  disabled?: boolean
  onClick(): void
}) {
  return (
    <button
      className={['tool', on && 'on', quiet && 'quiet'].filter(Boolean).join(' ')}
      title={hint ?? label}
      aria-label={label}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={18} strokeWidth={1.9} aria-hidden />
      <span className="tool-label">{label}</span>
    </button>
  )
}

// Phones show menus as a sheet from the bottom of the screen, within reach of the thumb.
export const sheetNow = () => matchMedia('(max-width: 700px)').matches

// A toolbar control that opens a small panel under itself: a list to pick from, or a few settings.
// Picking a button inside closes it; so does a tap anywhere else.
export function Menu({ icon, label, hint, quiet, on, opener, wide, children }: {
  icon: LucideIcon
  label: string
  hint?: string
  quiet?: boolean
  on?: boolean
  // A window event that opens it from elsewhere.
  opener?: string
  // Room for two columns of tiles (a long menu of tools, the Study menu).
  wide?: boolean
  children: ReactNode | ((close: () => void) => ReactNode)
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  // Opened beside the edge of a narrow panel, the menu would run off the window: it is moved back inside it, and
  // scrolls when taller than the room below.
  const panel = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const menu = panel.current
    if (!open || !menu) return
    // On a phone the menu rises from the bottom of the screen as a sheet: nothing to fit.
    if (sheetNow()) return
    menu.style.translate = ''
    menu.style.maxHeight = ''
    const box = menu.getBoundingClientRect()
    const edge = 8
    const shift = box.left < edge ? edge - box.left : box.right > innerWidth - edge ? innerWidth - edge - box.right : 0
    if (shift) menu.style.translate = `${Math.round(shift)}px 0`
    if (box.bottom > innerHeight - edge) { menu.style.maxHeight = `${Math.max(160, innerHeight - edge - box.top)}px`; menu.style.overflowY = 'auto' }
  }, [open])
  useEffect(() => {
    if (!opener) return
    const show = () => setOpen(true)
    window.addEventListener(opener, show)
    return () => window.removeEventListener(opener, show)
  }, [opener])
  return (
    <span className="menu-anchor">
      <Tool icon={icon} label={label} hint={hint} quiet={quiet} on={on || open} onClick={() => setOpen(!open)} />
      {open && sheetNow() && createPortal(<>
        <div className="menu-backdrop" onClick={close} />
        <div ref={panel} className={wide ? 'menu wide' : 'menu'} onClick={e => { if ((e.target as HTMLElement).closest('button:not(.stay)')) close() }}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      </>, document.body)}
      {open && !sheetNow() && <>
        <div className="menu-backdrop" onClick={close} />
        <div ref={panel} className={wide ? 'menu wide' : 'menu'} onClick={e => { if ((e.target as HTMLElement).closest('button:not(.stay)')) close() }}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      </>}
    </span>
  )
}
