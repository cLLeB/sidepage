import { useEffect, useMemo, useRef, useState } from 'react'
import type { Entry } from '../lib/insight'

// A crossword made from the book's own glossary: each answer one of its key terms, each clue the sentence where the
// book says what it is (with the term taken out). The fitting of words into a grid is crossword-layout-generator's.
type Placed = { clue: string; answer: string; startx: number; starty: number; orientation: 'across' | 'down' | 'none'; position: number }
type Layout = { rows: number; cols: number; result: Placed[] }

function clueOf(entry: Entry) {
  const term = entry.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blanked = entry.meaning.replace(new RegExp(`\\b${term}(e?s)?\\b`, 'gi'), '_____')
  return blanked.length > 170 ? `${blanked.slice(0, 170)}…` : blanked
}

export default function Crossword({ entries }: { entries: Entry[] }) {
  const [layout, setLayout] = useState<Layout | null>(null)
  const [letters, setLetters] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState(false)
  const cells = useRef(new Map<string, HTMLInputElement>())

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Single words of three to twelve letters make a fair grid; the rest are left out.
      const words = entries
        // A clue is a real sentence: one that ends as sentences do and keeps enough words once the term is out.
        .filter(entry => /^[\p{L}]{3,12}$/u.test(entry.term) && entry.meaning.toLowerCase().includes(entry.term.toLowerCase())
          && /[.!?]$/.test(entry.meaning.trim()) && (clueOf(entry).match(/\b[a-z][a-z'-]+\b/g) ?? []).length >= 6)
        .slice(0, 14)
        .map(entry => ({ answer: entry.term.toLowerCase(), clue: clueOf(entry) }))
      if (words.length < 3) return setLayout({ rows: 0, cols: 0, result: [] })
      const { generateLayout } = await import('crossword-layout-generator') as unknown as { generateLayout(words: { answer: string; clue: string }[]): Layout }
      const made = generateLayout(words)
      if (!cancelled) { setLayout({ ...made, result: made.result.filter(word => word.orientation !== 'none') }); setLetters({}); setChecked(false) }
    })()
    return () => { cancelled = true }
  }, [entries])

  // Every square that holds a letter, with the right letter and the number shown in it.
  const grid = useMemo(() => {
    const squares = new Map<string, { letter: string; number?: number }>()
    for (const word of layout?.result ?? []) {
      for (let i = 0; i < word.answer.length; i++) {
        const x = word.startx + (word.orientation === 'across' ? i : 0)
        const y = word.starty + (word.orientation === 'down' ? i : 0)
        const key = `${x},${y}`
        const square = squares.get(key) ?? { letter: word.answer[i] }
        if (i === 0) square.number = word.position
        squares.set(key, square)
      }
    }
    return squares
  }, [layout])

  if (!layout) return <p className="guide-wait">Fitting the terms into a grid…</p>
  if (!layout.result.length) return <p className="guide-wait">Too few of this book's terms have a sentence that makes a good clue.</p>

  const right = [...grid].filter(([key, square]) => letters[key] === square.letter).length
  const move = (x: number, y: number, dx: number, dy: number) => cells.current.get(`${x + dx},${y + dy}`)?.focus()
  const clues = (way: 'across' | 'down') => layout.result.filter(word => word.orientation === way).sort((a, b) => a.position - b.position)
  return (
    <div className="crossword">
      <div className="crossword-grid" style={{ gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 30px))` }}>
        {Array.from({ length: layout.rows }, (_, row) => Array.from({ length: layout.cols }, (_, col) => {
          const x = col + 1, y = row + 1, key = `${x},${y}`
          const square = grid.get(key)
          if (!square) return <span key={key} className="crossword-gap" />
          const typed = letters[key] ?? ''
          return (
            <label key={key} className={checked && typed ? (typed === square.letter ? 'crossword-cell right' : 'crossword-cell wrong') : 'crossword-cell'}>
              {square.number && <small>{square.number}</small>}
              <input
                ref={el => { if (el) cells.current.set(key, el); else cells.current.delete(key) }}
                maxLength={1} value={typed.toUpperCase()} aria-label={`Row ${y}, column ${x}`} autoCapitalize="characters" autoComplete="off" spellCheck={false}
                onChange={e => {
                  const letter = e.target.value.slice(-1).toLowerCase()
                  setLetters({ ...letters, [key]: letter }); setChecked(false)
                  if (letter) { if (grid.has(`${x + 1},${y}`)) move(x, y, 1, 0); else move(x, y, 0, 1) }
                }}
                onKeyDown={e => {
                  if (e.key === 'ArrowRight') move(x, y, 1, 0)
                  else if (e.key === 'ArrowLeft') move(x, y, -1, 0)
                  else if (e.key === 'ArrowDown') move(x, y, 0, 1)
                  else if (e.key === 'ArrowUp') move(x, y, 0, -1)
                }}
              />
            </label>
          )
        }))}
      </div>
      <div className="crossword-clues">
        {(['across', 'down'] as const).map(way => clues(way).length > 0 && (
          <div key={way}>
            <h4>{way === 'across' ? 'Across' : 'Down'}</h4>
            <ol>{clues(way).map(word => <li key={way + word.position} value={word.position}>{word.clue} <i>({word.answer.length})</i></li>)}</ol>
          </div>
        ))}
      </div>
      <div className="crossword-actions">
        <button className="soft" onClick={() => setChecked(true)}>Check</button>
        <button className="soft" onClick={() => { setLetters(Object.fromEntries([...grid].map(([key, square]) => [key, square.letter]))); setChecked(true) }}>Show the answers</button>
        {checked && <span className="crossword-score">{`${right} of ${grid.size} letters right`}</span>}
      </div>
    </div>
  )
}
