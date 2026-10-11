import { ALargeSmall, Bookmark, BookmarkCheck, BookmarkMinus, BookmarkPlus, Highlighter, List, X } from 'lucide-react'
import { Menu, Tool } from '../ui'
import { FONTS, setTextStyle, useTextStyle, type Bookmark as Mark, type useBookmarks } from '../lib/reading'

// The reader's bookmarks: mark the page that is open, or go to one marked earlier.
export function BookmarksMenu({ marks, here, onGo }: {
  marks: ReturnType<typeof useBookmarks>
  // The place that is open now, and what to call it in the list.
  here: Mark | null
  onGo(place: string): void
}) {
  const marked = !!here && marks.has(here.place)
  return (
    <Menu quiet icon={marked ? BookmarkCheck : Bookmark} label="Bookmarks" on={marked}>
      {here && (
        <Tool
          icon={marked ? BookmarkMinus : BookmarkPlus}
          label={marked ? 'Remove this bookmark' : 'Bookmark this page'}
          onClick={() => marks.toggle(here)}
        />
      )}
      {marks.list.length === 0 && <p className="menu-note">No bookmarks yet.</p>}
      {marks.list.map(mark => (
        <div className="menu-line" key={mark.place}>
          <button className="menu-item" onClick={() => onGo(mark.place)}>{mark.label}</button>
          <button className="stay menu-x" title="Remove" aria-label="Remove bookmark" onClick={() => marks.remove(mark.place)}><X size={14} aria-hidden /></button>
        </div>
      ))}
    </Menu>
  )
}

export const HIGHLIGHT_COLOURS = { Yellow: '#ffd84d', Green: '#8fe3a0', Blue: '#8ecbff', Pink: '#ffa8c7' } as const
export type Highlight = { cfi: string; index: number; text: string; color?: string; note?: string }

// Highlight the selected passage in a colour, and look after the highlights already made: each can carry a
// comment, which also becomes the back of its flashcard.
export function HighlightsMenu({ marks, onHighlight, onGo, onChange, onRemove }: {
  marks: Highlight[]
  onHighlight(color: string): void
  onGo(cfi: string): void
  onChange(cfi: string, change: Partial<Highlight>): void
  onRemove(cfi: string): void
}) {
  return (
    <Menu icon={Highlighter} label="Highlight" hint="Highlight the selected text, and see your highlights">
      <div className="menu-row">
        Highlight selection
        <span className="swatches">
          {Object.entries(HIGHLIGHT_COLOURS).map(([name, color]) => (
            <button key={name} className="swatch" style={{ background: color }} title={name} aria-label={`Highlight in ${name.toLowerCase()}`} onClick={() => onHighlight(color)} />
          ))}
        </span>
      </div>
      {marks.length === 0 && <p className="menu-note">Select some text in the book, then pick a colour.</p>}
      <div className="menu-scroll">
        {marks.map(mark => (
          <div className="highlight" key={mark.cfi} style={{ borderColor: mark.color ?? HIGHLIGHT_COLOURS.Yellow }}>
            <div className="menu-line">
              <button className="menu-item" onClick={() => onGo(mark.cfi)}>{mark.text.length > 120 ? `${mark.text.slice(0, 120)}…` : mark.text}</button>
              <button className="stay menu-x" title="Remove" aria-label="Remove highlight" onClick={() => onRemove(mark.cfi)}><X size={14} aria-hidden /></button>
            </div>
            <span className="swatches small">
              {Object.entries(HIGHLIGHT_COLOURS).map(([name, color]) => (
                <button key={name} className="stay swatch" style={{ background: color }} title={name} aria-label={`Make it ${name.toLowerCase()}`} onClick={() => onChange(mark.cfi, { color })} />
              ))}
            </span>
            <textarea
              className="highlight-note"
              rows={2}
              placeholder="Add a comment"
              defaultValue={mark.note ?? ''}
              onBlur={e => { if (e.target.value !== (mark.note ?? '')) onChange(mark.cfi, { note: e.target.value }) }}
            />
          </div>
        ))}
      </div>
    </Menu>
  )
}

// A book's or a PDF's table of contents.
export function ContentsMenu({ items, onGo }: { items: { label: string; depth: number; go: string | (() => void) }[]; onGo(target: string): void }) {
  if (!items.length) return null
  return (
    <Menu quiet icon={List} label="Contents">
      <div className="menu-scroll">
        {items.map((item, i) => (
          <button
            key={i}
            className="menu-item"
            style={{ paddingLeft: 10 + item.depth * 14 }}
            onClick={() => (typeof item.go === 'string' ? onGo(item.go) : item.go())}
          >
            {item.label}
          </button>
        ))}
      </div>
    </Menu>
  )
}

// How book text is set. The same choice applies to every book.
export function TextMenu() {
  const text = useTextStyle()
  return (
    <Menu quiet icon={ALargeSmall} label="Text size and typeface">
      <div className="menu-row">
        Size
        <span className="stepper">
          <button className="stay" aria-label="Smaller text" onClick={() => setTextStyle({ size: text.size - 10 })}>A−</button>
          <span>{text.size}%</span>
          <button className="stay" aria-label="Larger text" onClick={() => setTextStyle({ size: text.size + 10 })}>A+</button>
        </span>
      </div>
      <div className="menu-row">
        Line spacing
        <span className="stepper">
          <button className="stay" aria-label="Tighter lines" onClick={() => setTextStyle({ spacing: text.spacing - 0.1 })}>−</button>
          <span>{text.spacing.toFixed(1)}</span>
          <button className="stay" aria-label="Looser lines" onClick={() => setTextStyle({ spacing: text.spacing + 0.1 })}>+</button>
        </span>
      </div>
      <label className="menu-row">
        Typeface
        <select value={text.font} onChange={e => setTextStyle({ font: e.target.value as keyof typeof FONTS })}>
          {(Object.keys(FONTS) as (keyof typeof FONTS)[]).map(key => <option key={key} value={key}>{FONTS[key].name}</option>)}
        </select>
      </label>
    </Menu>
  )
}
