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
