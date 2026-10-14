import { useEffect, useState } from 'react'
import { baseName, loadNote, onQuote } from '../lib/platform'

// A map of the whole book down the edge of the page: a mark for each page you highlighted (in its colour), wrote
// about in your notes, or bookmarked; where you are; and the page to reach today. Tap anywhere on it to go there.
export type PageMarks = { colours: string[]; noted: number; bookmarked: boolean }

export default function PageMap({ file, pages, current, goal, highlights, bookmarks, onGo }: {
  file: string
  pages: number
  current: number
  goal?: number
  highlights: { page: number; colour: string }[]
  bookmarks: number[]
  onGo(page: number): void
}) {
  // Pages the notes point to: quotes, clips and links carry their page.
  const [noted, setNoted] = useState<Map<number, number>>(new Map())
  useEffect(() => {
    const read = () => void loadNote(baseName(file), 'notes.md').then(text => {
      const found = new Map<number, number>()
      for (const match of (text ?? '').matchAll(/book=([^&\s)]+)\\?&at=page%3D(\d+)/g)) {
        if (decodeURIComponent(match[1]) !== file) continue
        const page = Number(match[2])
        found.set(page, (found.get(page) ?? 0) + 1)
      }
      setNoted(found)
    })
    read()
    // A quote or clip just sent shows on the map a moment later, once the note has kept it.
    const stop = onQuote(() => setTimeout(read, 1500))
    const every = setInterval(read, 20_000)
    return () => { stop(); clearInterval(every) }
  }, [file])

  if (pages < 2) return null
  const at = (page: number) => `${((page - 0.5) / pages) * 100}%`
  const byPage = new Map<number, string[]>()
  for (const mark of highlights) byPage.set(mark.page, [...(byPage.get(mark.page) ?? []), mark.colour])
  return (
    <div
      className="page-map"
      role="navigation"
      aria-label="Map of the book: highlights, notes and bookmarks by page"
      onPointerDown={e => {
        const box = e.currentTarget.getBoundingClientRect()
        onGo(Math.min(pages, Math.max(1, Math.ceil(((e.clientY - box.top) / box.height) * pages))))
      }}
    >
      {[...byPage].map(([page, colours]) => <i key={`h${page}`} className="map-highlight" style={{ top: at(page), background: colours[0] }} title={`Page ${page}: ${colours.length} highlight${colours.length === 1 ? '' : 's'}`} />)}
      {[...noted].map(([page, count]) => <i key={`n${page}`} className="map-note" style={{ top: at(page) }} title={`Page ${page}: in your notes ${count} time${count === 1 ? '' : 's'}`} />)}
      {bookmarks.map(page => <i key={`b${page}`} className="map-bookmark" style={{ top: at(page) }} title={`Page ${page}: bookmarked`} />)}
      {goal ? <i className="map-goal" style={{ top: at(goal) }} title={`Today's mark: page ${goal}`} /> : null}
      <i className="map-here" style={{ top: at(current) }} />
    </div>
  )
}
