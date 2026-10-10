import { useState, type ReactNode } from 'react'

export type SearchHit = { key: string; label: ReactNode; pick(): void }

// Find-in-book field for a reader's toolbar. Enter searches; Enter again steps to the next match.
export default function SearchBox({ onSearch, onClear, status, hits }: {
  onSearch(query: string, again: boolean): void
  onClear(): void
  status?: string
  hits?: SearchHit[]
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState('')

  const close = () => {
    setOpen(false)
    setQuery('')
    setSearched('')
    onClear()
  }

  if (!open) return <button onClick={() => setOpen(true)} title="Search in this book">Search</button>

  return (
    <span className="search-box">
      <input
        autoFocus
        value={query}
        placeholder="Search in this book"
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') close()
          if (e.key !== 'Enter' || !query.trim()) return
          onSearch(query.trim(), query.trim() === searched)
          setSearched(query.trim())
        }}
      />
      {status && <span className="viewer-pos">{status}</span>}
      <button onClick={close} title="Close search">×</button>
      {hits && searched && (
        <ul className="search-hits">
          {hits.length === 0 && <li className="search-none">{status || 'No matches'}</li>}
          {hits.map(hit => <li key={hit.key}><button onClick={hit.pick}>{hit.label}</button></li>)}
        </ul>
      )}
    </span>
  )
}
