import { ALargeSmall, Bookmark, BookmarkCheck, BookmarkMinus, BookmarkPlus, List, X } from 'lucide-react'
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
