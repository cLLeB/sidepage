import { useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Menu } from '../ui'
import { baseName, findInNotes, goToPlace, loadNote, openBookByName, shelf } from '../lib/platform'
import { placeName, searchBooks, type BookHit } from '../lib/library'

type NoteHit = { book: string; line: string }

// Markdown marks are dropped so a line reads, and can be found again in the note, as plain words.
const plain = (line: string) => line.replace(/<\/?(?:span|u|sup|sub|div)\b[^>]*>/g, '').replace(/^[\s>#*\-+\d.]+/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').trim()

async function searchNotes(query: string): Promise<NoteHit[]> {
  const wanted = query.toLowerCase()
  const hits: NoteHit[] = []
  for (const book of await shelf()) {
    const notes = (await loadNote(baseName(book.name), 'notes.md')) ?? ''
    for (const line of notes.split('\n').map(plain)) {
      if (line.toLowerCase().includes(wanted)) hits.push({ book: book.name, line })
      if (hits.length >= 40) return hits
    }
  }
  return hits
}

// One search for everything: the written notes of every book, and the words of every book that has been
// opened. A result in the notes opens the book and shows the line; one in a book opens it at that place.
export default function NotesSearch() {
  const [query, setQuery] = useState('')
  const [notes, setNotes] = useState<NoteHit[] | null>(null)
  const [books, setBooks] = useState<BookHit[]>([])
  const latest = useRef(0)

  const search = (text: string) => {
    setQuery(text)
    const wanted = text.trim()
    const mine = ++latest.current
    if (wanted.length < 2) return setNotes(null)
    void Promise.all([searchNotes(wanted), searchBooks(wanted)]).then(([inNotes, inBooks]) => {
      if (mine !== latest.current) return
      setNotes(inNotes)
      setBooks(inBooks)
    })
  }

  const openNote = (hit: NoteHit) => {
    openBookByName(hit.book)
    // The note needs a moment to be on screen before the line can be shown in it.
    for (const delay of [600, 1800]) setTimeout(() => findInNotes({ text: hit.line }), delay)
  }
  const openBook = (hit: BookHit) => {
    openBookByName(hit.book)
    for (const delay of [800, 2400]) setTimeout(() => goToPlace({ book: hit.book, place: hit.place }), delay)
  }

  return (
    <Menu quiet icon={Search} label="Search notes and books" hint="Search your notes and the text of your books">
      <input className="menu-input" autoFocus value={query} placeholder="Search your notes and books" onChange={e => search(e.target.value)} />
      {notes && notes.length === 0 && books.length === 0 && <p className="menu-note">Nothing in your notes or opened books matches.</p>}
      {notes && (notes.length > 0 || books.length > 0) && (
        <div className="menu-scroll">
          {notes.length > 0 && <p className="menu-head">In your notes</p>}
          {notes.map((hit, i) => (
            <button key={`n${i}`} className="menu-item" onClick={() => openNote(hit)}>
              <span className="hit-book">{baseName(hit.book)}</span>
              {hit.line.length > 140 ? `${hit.line.slice(0, 140)}…` : hit.line}
            </button>
          ))}
          {books.length > 0 && <p className="menu-head">In your books</p>}
          {books.map((hit, i) => (
            <button key={`b${i}`} className="menu-item" onClick={() => openBook(hit)}>
              <span className="hit-book">{baseName(hit.book)} · {placeName(hit.place)}</span>
              …{hit.before}<mark>{hit.match}</mark>{hit.after}…
            </button>
          ))}
        </div>
      )}
    </Menu>
  )
}
