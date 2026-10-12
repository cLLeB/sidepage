import { useEffect, useState } from 'react'
import { baseName, goToPlace, loadNote, openBookByName, shelf } from '../lib/platform'
import type { Highlight } from '../lib/reading'
import { HIGHLIGHT_COLOURS } from '../viewers/ReaderMenus'

type Found = Highlight & { book: string }
const colourOf = (mark: Highlight) => mark.color ?? HIGHLIGHT_COLOURS.Yellow

// Every highlight from every book, in one list. Pick a colour to see only those; pick a highlight to open it
// where it was made.
export default function HighlightsView() {
  const [marks, setMarks] = useState<Found[] | null>(null)
  const [colour, setColour] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const found: Found[] = []
      // A PDF and an EPUB of one title share a notebook; each takes its own kind of highlight from it.
      for (const book of await shelf()) {
        const all: Highlight[] = JSON.parse((await loadNote(baseName(book.name), 'highlights.json')) ?? '[]')
        const isPdf = book.name.toLowerCase().endsWith('.pdf')
        found.push(...all.filter(mark => !!mark.rects === isPdf).map(mark => ({ ...mark, book: book.name })))
      }
      if (!cancelled) setMarks(found)
    })()
    return () => { cancelled = true }
  }, [])

  if (!marks) return <div className="note all-highlights"><p className="review-note">Gathering your highlights…</p></div>
  if (!marks.length) {
    return (
      <div className="note all-highlights">
        <div className="review-empty">
          <h2>No highlights yet</h2>
          <p>Select a passage in a book or a PDF, open Highlight and pick a colour. Everything you highlight is gathered here.</p>
        </div>
      </div>
    )
  }

  const open = (mark: Found) => {
    openBookByName(mark.book)
    for (const delay of [800, 2400]) setTimeout(() => goToPlace({ book: mark.book, place: mark.cfi }), delay)
  }
  const shown = marks.filter(mark => !colour || colourOf(mark) === colour)
  const books = [...new Set(shown.map(mark => mark.book))]

  return (
    <div className="note all-highlights">
      <div className="highlight-filter">
        <button className={colour ? '' : 'on'} onClick={() => setColour('')}>All {marks.length}</button>
        {Object.entries(HIGHLIGHT_COLOURS).filter(([, value]) => marks.some(mark => colourOf(mark) === value)).map(([name, value]) => (
          <button key={name} className={colour === value ? 'on' : ''} onClick={() => setColour(value)}>
            <span className="swatch" style={{ background: value }} /> {name} {marks.filter(mark => colourOf(mark) === value).length}
          </button>
        ))}
      </div>
      {books.map(book => (
        <section key={book}>
          <h3>{baseName(book)}</h3>
          {shown.filter(mark => mark.book === book).map(mark => (
            <button key={mark.cfi} className="highlight-card" style={{ borderColor: colourOf(mark) }} onClick={() => open(mark)}>
              <span className="highlight-text">{mark.text}</span>
              {mark.note?.trim() && <span className="highlight-comment">{mark.note}</span>}
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}
