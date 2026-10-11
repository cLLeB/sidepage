import { useState } from 'react'
import { Search } from 'lucide-react'
import { Menu } from '../ui'
import { baseName, findInNotes, loadNote, openBookByName, shelf } from '../lib/platform'

type Hit = { book: string; line: string }

// Markdown marks are dropped so a line reads, and can be found again in the note, as plain words.
const plain = (line: string) => line.replace(/^[\s>#*\-+\d.]+/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').trim()

async function searchNotes(query: string): Promise<Hit[]> {
  const wanted = query.toLowerCase()
  const hits: Hit[] = []
  for (const book of await shelf()) {
    const notes = (await loadNote(baseName(book.name), 'notes.md')) ?? ''
    for (const line of notes.split('\n').map(plain)) {
      if (line.toLowerCase().includes(wanted)) hits.push({ book: book.name, line })
      if (hits.length >= 60) return hits
    }
  }
  return hits
}

// Search the written notes of every book on the shelf. Picking a result opens that book and shows the line.
export default function NotesSearch() {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)

  const open = (hit: Hit) => {
    openBookByName(hit.book)
    // The note needs a moment to be on screen before the line can be shown in it.
    for (const delay of [600, 1800]) setTimeout(() => findInNotes({ text: hit.line }), delay)
  }

  return (
    <Menu quiet icon={Search} label="Search all notes">
      <input
        className="menu-input"
        autoFocus
        value={query}
        placeholder="Search all your notes"
        onChange={e => {
          setQuery(e.target.value)
          const now = e.target.value.trim()
          if (now.length < 2) return setHits(null)
          void searchNotes(now).then(found => setHits(found))
        }}
      />
      {hits && hits.length === 0 && <p className="menu-note">Nothing in your notes matches.</p>}
      {hits && hits.length > 0 && (
        <div className="menu-scroll">
          {hits.map((hit, i) => (
            <button key={i} className="menu-item" onClick={() => open(hit)}>
              <span className="hit-book">{baseName(hit.book)}</span>
              {hit.line.length > 140 ? `${hit.line.slice(0, 140)}…` : hit.line}
            </button>
          ))}
        </div>
      )}
    </Menu>
  )
}
