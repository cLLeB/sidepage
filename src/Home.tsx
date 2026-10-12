import { useEffect, useState } from 'react'
import { BookOpenText, Clock, Flame, FolderOpen, Library, NotebookText, Quote, Star, Target, X } from 'lucide-react'
import { baseName, extensionOf, loadNote, type Shelved } from './lib/platform'
import { asTime, progressOf, readingDays, readingStats, spentOn, timeLeft } from './lib/reading'

// What a book is, said plainly, and the shelves it can be filtered into.
const KINDS: Record<string, string> = {
  pdf: 'PDFs', epub: 'Books', mobi: 'Books', azw: 'Books', azw3: 'Books', kf8: 'Books', fb2: 'Books', fbz: 'Books', djvu: 'Books', djv: 'Books',
  cbz: 'Comics', cbr: 'Comics', cb7: 'Comics', cbt: 'Comics', docx: 'Documents', doc: 'Documents', rtf: 'Documents', odt: 'Documents',
  txt: 'Documents', md: 'Documents', markdown: 'Documents', html: 'Documents', htm: 'Documents', pptx: 'Slides', ppt: 'Slides', pps: 'Slides',
}
const kindOf = (name: string) => KINDS[extensionOf(name)] ?? 'Pictures'

// A book with no cover of its own gets a cloth binding in a colour that is always the same for that title.
const BINDINGS = ['#3d5a80', '#7a4b3a', '#4a6b52', '#8a6d2f', '#5b5f6b', '#2f6b73', '#8a4a55']
const binding = (name: string) => BINDINGS[[...name].reduce((sum, letter) => (sum * 31 + letter.charCodeAt(0)) % 9973, 7) % BINDINGS.length]

const greeting = () => {
  const hour = new Date().getHours()
  return hour < 5 ? 'Still up?' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

function Cover({ name, cover, large }: { name: string; cover?: string; large?: boolean }) {
  return cover
    ? <img className={large ? 'cover large' : 'cover'} src={cover} alt="" />
    : (
      <span className={large ? 'cover large bound' : 'cover bound'} style={{ background: binding(name) }}>
        <span className="bound-title">{baseName(name)}</span>
        <span className="bound-kind">{extensionOf(name)}</span>
      </span>
    )
}

export default function Home({ books, covers, favourites, goal, onOpen, onBrowse, onRemove, onFavourite, onQuickNotes }: {
  books: Shelved[]
  covers: Record<string, string>
  favourites: string[]
  goal: number
  onOpen(name: string): void
  onBrowse(): void
  onRemove(name: string): void
  onFavourite(name: string): void
  onQuickNotes(): void
}) {
  const [wanted, setWanted] = useState('')
  const [shelfName, setShelfName] = useState('All')
  const [order, setOrder] = useState(() => localStorage.getItem('sidepage:order') ?? 'recent')
  const stats = readingStats()
  // One of your own highlights, a different one each day, to meet again.
  const [remembered, setRemembered] = useState<{ text: string; book: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const all: { text: string; book: string }[] = []
      for (const book of books) {
        const marks: { text: string }[] = JSON.parse((await loadNote(baseName(book.name), 'highlights.json')) ?? '[]')
        all.push(...marks.filter(mark => mark.text?.trim().length > 20).map(mark => ({ text: mark.text.replace(/\s+/g, ' ').trim(), book: book.name })))
      }
      if (!cancelled) setRemembered(all.length ? all[Math.floor(Date.now() / 86_400_000) % all.length] : null)
    })()
    return () => { cancelled = true }
  }, [books])
  const days = readingDays(84)
  const most = Math.max(30, ...days.map(day => day.minutes))
  const last = [...books].sort((a, b) => b.opened - a.opened)[0]

  const shelves = ['All', 'Favourites', 'Reading', 'Finished', ...new Set(books.map(book => kindOf(book.name)))]
    .filter(name => name === 'All' || books.some(book => onShelf(book, name)))
  function onShelf(book: Shelved, name: string) {
    const read = progressOf(book.name)
    if (name === 'All') return true
    if (name === 'Favourites') return favourites.includes(book.name)
    if (name === 'Reading') return read > 0.01 && read < 0.97
    if (name === 'Finished') return read >= 0.97
    return kindOf(book.name) === name
  }
  const shown = [...books]
    .filter(book => onShelf(book, shelves.includes(shelfName) ? shelfName : 'All') && book.name.toLowerCase().includes(wanted.trim().toLowerCase()))
    .sort((a, b) =>
      Number(favourites.includes(b.name)) - Number(favourites.includes(a.name))
      || (order === 'title' ? baseName(a.name).localeCompare(baseName(b.name)) : order === 'progress' ? progressOf(b.name) - progressOf(a.name) : b.opened - a.opened))

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-top">
          <div>
            <p className="home-day">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1>{greeting()}</h1>
          </div>
          <div className="home-actions">
            <button className="soft" onClick={onQuickNotes}><NotebookText size={18} aria-hidden /> Quick notes</button>
            <button className="primary" onClick={onBrowse}><FolderOpen size={18} aria-hidden /> Open a book</button>
          </div>
        </header>

        {!books.length && (
          <button className="home-empty" onClick={onBrowse}>
            <img src="./favicon.svg" alt="" />
            <strong>Read on one side, think on the other.</strong>
            <span>Open a book, a document, a slide deck or a picture, or drop one here. Your notes open beside it.</span>
            <span className="home-formats">PDF · EPUB · MOBI · AZW3 · FB2 · DJVU · CBZ · CBR · DOCX · DOC · RTF · ODT · PPTX · PPT · TXT · Markdown · HTML · pictures</span>
          </button>
        )}

        {last && (
          <div className="home-row">
            <button className="hero" onClick={() => onOpen(last.name)}>
              <Cover name={last.name} cover={covers[last.name]} large />
              <span className="hero-text">
                <span className="eyebrow">Continue reading</span>
                <span className="hero-title">{baseName(last.name)}</span>
                <span className="hero-meta">{kindOf(last.name).replace(/s$/, '')} · {Math.round(progressOf(last.name) * 100)}% read{timeLeft(last.name) ? ` · about ${asTime(timeLeft(last.name))} left` : ''}</span>
                <span className="meter"><i style={{ width: `${Math.round(progressOf(last.name) * 100)}%` }} /></span>
                <span className="hero-go"><BookOpenText size={17} aria-hidden /> Pick up where you left off</span>
              </span>
            </button>
            <section className="tiles" aria-label="Your reading">
              <div className="tile">
                <span className="tile-icon"><Clock size={17} aria-hidden /></span>
                <b>{asTime(stats.today)}</b>
                <span>{goal > 0 ? `of ${asTime(goal)} today` : 'today'}</span>
                {goal > 0 && <span className="meter"><i style={{ width: `${Math.min(100, Math.round((stats.today / goal) * 100))}%` }} /></span>}
              </div>
              <div className="tile">
                <span className="tile-icon"><Target size={17} aria-hidden /></span>
                <b>{asTime(stats.week)}</b>
                <span>this week</span>
              </div>
              <div className="tile">
                <span className="tile-icon"><Flame size={17} aria-hidden /></span>
                <b>{stats.streak} {stats.streak === 1 ? 'day' : 'days'}</b>
                <span>in a row</span>
              </div>
              <div className="tile wide">
                <span className="eyebrow">Last twelve weeks</span>
                <div className="heat" role="img" aria-label="Minutes read on each of the last 84 days">
                  {days.map(({ date, minutes }) => (
                    <i
                      key={date.toDateString()}
                      title={`${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: ${minutes ? asTime(minutes) : 'nothing read'}`}
                      style={{ opacity: minutes ? 0.25 + 0.75 * Math.min(1, minutes / most) : undefined }}
                      className={minutes ? 'read' : undefined}
                    />
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}

        {remembered && (
          <button className="remembered" onClick={() => onOpen(remembered.book)}>
            <Quote size={18} aria-hidden />
            <span><q>{remembered.text.length > 320 ? `${remembered.text.slice(0, 320)}…` : remembered.text}</q><small>You highlighted this in {baseName(remembered.book)}</small></span>
          </button>
        )}

        {books.length > 0 && <>
          <div className="shelf-head">
            <h2 className="shelf-title"><Library size={16} aria-hidden /> Your library</h2>
            <span className="spacer" />
            {books.length > 6 && <input className="shelf-search" value={wanted} placeholder={`Search ${books.length} books`} onChange={e => setWanted(e.target.value)} />}
            <select className="shelf-order" value={order} onChange={e => { setOrder(e.target.value); localStorage.setItem('sidepage:order', e.target.value) }} title="Order of the books">
              <option value="recent">Recently opened</option>
              <option value="title">By title</option>
              <option value="progress">Furthest read</option>
            </select>
          </div>
          {shelves.length > 2 && (
            <div className="chips" role="group" aria-label="Shelves">
              {shelves.map(name => (
                <button key={name} className={(shelves.includes(shelfName) ? shelfName : 'All') === name ? 'chip on' : 'chip'} onClick={() => setShelfName(name)}>
                  {name} <span>{books.filter(book => onShelf(book, name)).length}</span>
                </button>
              ))}
            </div>
          )}
          <ul className="bookcase">
            {shown.map(book => (
              <li key={book.name}>
                <button className="book" onClick={() => onOpen(book.name)}>
                  <Cover name={book.name} cover={covers[book.name]} />
                  <span className="book-name">{baseName(book.name)}</span>
                  <span className="book-meta">{Math.round(progressOf(book.name) * 100)}% read{spentOn(book.name) >= 1 ? ` · ${asTime(Math.round(spentOn(book.name)))}` : ''}</span>
                  <span className="meter"><i style={{ width: `${Math.round(progressOf(book.name) * 100)}%` }} /></span>
                </button>
                <button
                  className={favourites.includes(book.name) ? 'book-star on' : 'book-star'}
                  title={favourites.includes(book.name) ? 'No longer a favourite' : 'Keep at the front as a favourite'}
                  aria-label="Favourite" aria-pressed={favourites.includes(book.name)} onClick={() => onFavourite(book.name)}
                ><Star size={15} aria-hidden /></button>
                <button className="book-remove" title="Remove from the library" aria-label="Remove from the library" onClick={() => onRemove(book.name)}><X size={15} aria-hidden /></button>
              </li>
            ))}
          </ul>
          {!shown.length && <p className="home-none">No book here matches.</p>}
        </>}
      </div>
    </div>
  )
}
