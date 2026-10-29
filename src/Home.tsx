import { useEffect, useState } from 'react'
import { uiLocale } from './lib/language'
import { Ellipsis, Folders, Globe, BookOpenText, CalendarCheck, CalendarClock, Clock, Flame, FolderOpen, FolderPlus, Library, NotebookText, Pencil, Quote, Star, Target, Trash2, X } from 'lucide-react'
import { usePref } from './lib/prefs'
import { baseName, extensionOf, loadNote, type Shelved } from './lib/platform'
import { asTime, planToday, progressOf, readingDays, readingStats, setPlan, spentOn, timeLeft, type Plan } from './lib/reading'
import { folders } from './lib/folders'
import { Menu, Tool } from './ui'

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

export default function Home({ books, covers, favourites, goal, onOpen, onBrowse, onRemove, onFavourite, onQuickNotes, onWebPage, onFolder }: {
  books: Shelved[]
  covers: Record<string, string>
  favourites: string[]
  goal: number
  onOpen(name: string): void
  onBrowse(): void
  onRemove(name: string): void
  onFavourite(name: string): void
  onQuickNotes(): void
  onWebPage(): void
  onFolder(id?: string): void
}) {
  const folderList = folders()
  const [wanted, setWanted] = useState('')
  const [shelfName, setShelfName] = useState('All')
  const [order, setOrder] = useState(() => localStorage.getItem('sidepage:order') ?? 'recent')
  const stats = readingStats()
  // Plans: re-read whenever one is set, so the list below follows.
  const [planned] = usePref<Record<string, Plan>>('plans', {})
  const plannedBooks = books.filter(book => planned[book.name])
  const pickDate = (name: string) => {
    const input = document.createElement('input')
    input.type = 'date'
    input.min = new Date().toLocaleDateString('en-CA')
    input.value = planned[name]?.by ?? new Date(Date.now() + 14 * 86_400_000).toLocaleDateString('en-CA')
    input.style.cssText = 'position:fixed;opacity:0;pointer-events:none;left:50%;top:50%'
    document.body.append(input)
    input.addEventListener('change', () => { if (input.value) setPlan(name, input.value); input.remove() })
    input.addEventListener('blur', () => setTimeout(() => input.remove(), 400))
    try { input.showPicker() } catch { input.focus(); input.click() }
  }
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

  // Shelves of your own ("Semester 1 — Biology"): a book can stand on several.
  const [mine, setMine] = usePref<Record<string, string[]>>('collections', {})
  const [placing, setPlacing] = useState<string | null>(null)
  const [newShelf, setNewShelf] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [sure, setSure] = useState(false)
  const toggleOn = (shelf: string, book: string) => setMine({ ...mine, [shelf]: (mine[shelf] ?? []).includes(book) ? mine[shelf].filter(name => name !== book) : [...(mine[shelf] ?? []), book] })
  const shelves = ['All', 'Favourites', 'Reading', 'Finished', ...Object.keys(mine).sort((a, b) => a.localeCompare(b)), ...new Set(books.map(book => kindOf(book.name)))]
    .filter(name => name === 'All' || name in mine || books.some(book => onShelf(book, name)))
  function onShelf(book: Shelved, name: string) {
    const read = progressOf(book.name)
    if (name === 'All') return true
    if (name in mine) return mine[name].includes(book.name)
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
            <p className="home-day">{new Date().toLocaleDateString(uiLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1>{greeting()}</h1>
          </div>
          <div className="home-actions">
            <Menu icon={Ellipsis} label="More ways to start" quiet>
              <Tool icon={Globe} label="Read a web page" hint="Read an article from the web beside your notes" onClick={onWebPage} />
              <Tool icon={NotebookText} label="Quick notes" hint="Notes that belong to no book" onClick={onQuickNotes} />
            </Menu>
            <button className="soft" onClick={() => onFolder()} title="Open a folder of files and move through them"><Folders size={18} aria-hidden /> Folder</button>
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
                {!planned[last.name] && <span className="hero-plan" role="button" tabIndex={0} onClick={e => { e.stopPropagation(); pickDate(last.name) }}><CalendarClock size={14} aria-hidden /> Set a day to finish it by</span>}
              </span>
            </button>
            <details className="reading-line" aria-label="Your reading">
              <summary>
                <span><Clock size={15} aria-hidden /> {goal > 0 ? `${asTime(stats.today)} of ${asTime(goal)} today` : `${asTime(stats.today)} today`}</span>
                <span><Target size={15} aria-hidden /> {`${asTime(stats.week)} this week`}</span>
                <span><Flame size={15} aria-hidden /> {`${stats.streak} ${stats.streak === 1 ? 'day' : 'days'} in a row`}</span>
              </summary>
              <div className="tile wide">
                <span className="eyebrow">Last twelve weeks</span>
                <div className="heat" role="img" aria-label="Minutes read on each of the last 84 days">
                  {days.map(({ date, minutes }) => (
                    <i
                      key={date.toDateString()}
                      title={`${date.toLocaleDateString(uiLocale(), { day: 'numeric', month: 'short' })}: ${minutes ? asTime(minutes) : 'nothing read'}`}
                      style={{ opacity: minutes ? 0.25 + 0.75 * Math.min(1, minutes / most) : undefined }}
                      className={minutes ? 'read' : undefined}
                    />
                  ))}
                </div>
              </div>
            </details>
          </div>
        )}

        {folderList.length > 0 && (
          <section className="home-folders" aria-label="Your folders">
            <h2 className="shelf-title"><Folders size={16} aria-hidden /> Your folders</h2>
            <div className="home-folder-row">
              {folderList.map(folder => (
                <button key={folder.id} className="home-folder" onClick={() => onFolder(folder.id)}>
                  <FolderOpen size={22} aria-hidden />
                  <span className="home-folder-name">{folder.name}</span>
                  <span className="home-folder-kind">{folder.kind === 'kept' ? 'Kept in Sidepage' : folder.kind === 'path' ? 'On this computer' : 'In this browser'}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {plannedBooks.length > 0 && (
          <section className="plans" aria-label="Reading plans">
            <h2 className="shelf-title"><CalendarClock size={16} aria-hidden /> Today's reading</h2>
            {plannedBooks.map(book => {
              const today = planToday(book.name)!
              const left = Math.max(0, today.target - today.read)
              return (
                <div key={book.name} className={today.done ? 'plan done' : today.late ? 'plan late' : 'plan'}>
                  <button className="plan-book" onClick={() => onOpen(book.name)}>
                    <span className="plan-name">{baseName(book.name)}</span>
                    <span className="book-meta">
                      {today.late ? 'The finish day has passed' : `Finish by ${today.by.toLocaleDateString(uiLocale(), { weekday: 'short', day: 'numeric', month: 'short' })} · ${today.daysLeft} day${today.daysLeft === 1 ? '' : 's'} left`}
                    </span>
                    <span className="meter plan-meter">
                      <i style={{ width: `${Math.round(today.read * 100)}%` }} />
                      <b style={{ left: `${Math.round(today.target * 100)}%` }} title="Today's mark" />
                    </span>
                  </button>
                  <span className="plan-state">
                    {today.done ? <><CalendarCheck size={16} aria-hidden /> Done for today</> : `Read to ${Math.round(today.target * 100)}% today · ${Math.max(1, Math.round(left * 100))}% to go`}
                  </span>
                  <button className="tool" title="Change the finish day" aria-label="Change the finish day" onClick={() => pickDate(book.name)}><CalendarClock size={16} aria-hidden /></button>
                  <button className="tool" title="Drop this plan" aria-label="Drop this plan" onClick={() => setPlan(book.name, null)}><X size={16} aria-hidden /></button>
                </div>
              )
            })}
          </section>
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
          {shelves.length > 1 && (
            <div className="chips" role="group" aria-label="Shelves">
              {shelves.map(name => (
                <button key={name} className={[(shelves.includes(shelfName) ? shelfName : 'All') === name ? 'chip on' : 'chip', name in mine ? 'own' : ''].join(' ')} onClick={() => setShelfName(name)}>
                  {name} <span>{books.filter(book => onShelf(book, name)).length}</span>
                </button>
              ))}
            </div>
          )}
          {shelfName in mine && (
            <div className="shelf-tools">
              {renaming !== null
                ? <form className="ask" onSubmit={e => {
                    e.preventDefault()
                    const name = renaming.trim()
                    setRenaming(null)
                    if (!name || name === shelfName || name in mine) return
                    const next = { ...mine, [name]: mine[shelfName] }
                    delete next[shelfName]
                    setMine(next)
                    setShelfName(name)
                  }}>
                    <input autoFocus value={renaming} onChange={e => setRenaming(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setRenaming(null) }} />
                    <button className="primary">Rename</button>
                  </form>
                : <button className="soft" onClick={() => setRenaming(shelfName)}><Pencil size={15} aria-hidden /> Rename the shelf</button>}
              <button className={sure ? 'soft danger' : 'soft'} onClick={() => {
                // Asked twice: the first tap only says what a second tap will do.
                if (!sure) { setSure(true); setTimeout(() => setSure(false), 3500); return }
                const next = { ...mine }
                delete next[shelfName]
                setMine(next)
                setShelfName('All')
                setSure(false)
              }}><Trash2 size={15} aria-hidden /> {sure ? 'Tap again: the books stay in your library' : 'Take the shelf down'}</button>
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
                <button className={planned[book.name] ? 'book-plan on' : 'book-plan'} title={planned[book.name] ? `Finish by ${planned[book.name].by}` : 'Set a day to finish it by'} aria-label="Plan" onClick={() => pickDate(book.name)}><CalendarClock size={15} aria-hidden /></button>
                <button className={Object.values(mine).some(list => list.includes(book.name)) ? 'book-shelve on' : 'book-shelve'} title="Put on a shelf of your own" aria-label="Shelves" onClick={() => { setPlacing(placing === book.name ? null : book.name); setNewShelf('') }}><FolderPlus size={15} aria-hidden /></button>
                {placing === book.name && <>
                  <div className="menu-backdrop" onClick={() => setPlacing(null)} />
                  <div className="menu shelf-picker">
                    <p className="menu-head">Shelves</p>
                    {Object.keys(mine).sort((a, b) => a.localeCompare(b)).map(shelf => (
                      <label key={shelf} className="menu-row"><span>{shelf}</span><input type="checkbox" checked={mine[shelf].includes(book.name)} onChange={() => toggleOn(shelf, book.name)} /></label>
                    ))}
                    <form className="ask" onSubmit={e => { e.preventDefault(); const name = newShelf.trim(); if (!name) return; setMine({ ...mine, [name]: [...(mine[name] ?? []).filter(other => other !== book.name), book.name] }); setNewShelf('') }}>
                      <input value={newShelf} placeholder="A new shelf, e.g. Semester 1" onChange={e => setNewShelf(e.target.value)} />
                      <button className="primary" disabled={!newShelf.trim()}>Add</button>
                    </form>
                  </div>
                </>}
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
