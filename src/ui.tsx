import { useState, type ReactNode } from 'react'
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

// A toolbar control that opens a small panel under itself: a list to pick from, or a few settings.
// Picking a button inside closes it; so does a tap anywhere else.
export function Menu({ icon, label, hint, quiet, on, children }: {
  icon: LucideIcon
  label: string
  hint?: string
  quiet?: boolean
  on?: boolean
  children: ReactNode | ((close: () => void) => ReactNode)
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <span className="menu-anchor">
      <Tool icon={icon} label={label} hint={hint} quiet={quiet} on={on || open} onClick={() => setOpen(!open)} />
      {open && <>
        <div className="menu-backdrop" onClick={close} />
        <div className="menu" onClick={e => { if ((e.target as HTMLElement).closest('button:not(.stay)')) close() }}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      </>}
    </span>
  )
}
