import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { DockviewReact, themeLight, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react'
import { ErrorBoundary } from 'react-error-boundary'
import {
  Coffee, Columns2, Ellipsis, FolderCog, FolderOpen, LayoutDashboard, Moon, NotebookPen, Package, PanelTop, PenLine, Rows2,
  Maximize2, Minimize2, Share2, Sun, Workflow, X,
} from 'lucide-react'
import NotesSearch from './notes/NotesSearch'
import { coverOf, progressOf } from './lib/reading'
import { Tool } from './ui'
import 'dockview-react/dist/styles/dockview.css'
import {
  baseName, canPickNotesFolder, chooseNotesFolder, extensionOf, fromShelf, launchFile, notesFolder, onFindInNotes, onGoToPlace, onOpenBookByName,
  onNotesFolderChange, pickFile, PICTURE_EXTENSIONS, restoreNotesFolder, saveFileAs, shelf, shelve, unshelve, type Shelved,
} from './lib/platform'
import { BUNDLE_EXTENSION, packBundle, unpackBundle } from './lib/bundle'
import { withDetectedType } from './lib/sniff'
import { setTheme, THEMES, useTheme, type Theme } from './lib/theme'

const PdfView = lazy(() => import('./viewers/PdfView'))
const BookView = lazy(() => import('./viewers/BookView'))
const OfficeView = lazy(() => import('./viewers/OfficeView'))
const DjvuView = lazy(() => import('./viewers/DjvuView'))
const PptView = lazy(() => import('./viewers/PptView'))
const TextView = lazy(() => import('./viewers/TextView'))
const ImageView = lazy(() => import('./viewers/ImageView'))
const WrittenNote = lazy(() => import('./notes/WrittenNote'))
const CanvasNote = lazy(() => import('./notes/CanvasNote'))
const MindMapNote = lazy(() => import('./notes/MindMapNote'))
const GraphView = lazy(() => import('./notes/GraphView'))

const PAPERS = ['blank', 'lined', 'grid', 'dots'] as const
type Paper = (typeof PAPERS)[number]

const NOTE_KINDS = {
  written: { title: 'Notes', component: WrittenNote },
  canvas: { title: 'Canvas', component: CanvasNote },
  mindmap: { title: 'Mind map', component: MindMapNote },
} as const
type NoteKind = keyof typeof NOTE_KINDS

function viewerFor(name: string) {
  const ext = extensionOf(name)
  if (ext === 'pdf') return PdfView
  if (PICTURE_EXTENSIONS.includes(ext)) return ImageView
  if (['epub', 'mobi', 'azw', 'azw3', 'kf8', 'fb2', 'fbz', 'cbz', 'cbr', 'cb7', 'cbt'].includes(ext)) return BookView
  if (['docx', 'doc', 'rtf', 'odt'].includes(ext)) return OfficeView
  if (['pptx', 'ppt', 'pps'].includes(ext)) return PptView
  if (ext === 'djvu' || ext === 'djv') return DjvuView
  if (['txt', 'md', 'markdown', 'html', 'htm'].includes(ext)) return TextView
  return null
}

// Side by side on wide screens, stacked on a tablet held upright, one tab strip on a phone.
const LAYOUTS = { auto: 'Automatic', side: 'Side by side', stacked: 'Book above notes', tabs: 'One at a time' } as const
type Layout = keyof typeof LAYOUTS
const LAYOUT_ICONS = { auto: LayoutDashboard, side: Columns2, stacked: Rows2, tabs: PanelTop } as const
const THEME_ICONS = { light: Sun, sepia: Coffee, dark: Moon } as const
// The choice after this one, going round.
const next = <T,>(all: readonly T[], current: T) => all[(all.indexOf(current) + 1) % all.length]
const chosenLayout = () => (localStorage.getItem('sidepage:layout') as Layout) || 'auto'
// Where notes go relative to the book. "Automatic" follows the screen: beside the book when it is wider than
// tall, below it when held upright, and in the same tab strip on a phone.
const besideBook = () => {
  const layout = chosenLayout()
  if (layout === 'side') return 'right'
  if (layout === 'stacked') return 'below'
  if (layout === 'tabs') return 'within'
  return window.innerWidth < 700 ? 'within' : window.innerWidth < window.innerHeight ? 'below' : 'right'
}
const besideNotes = () => (({ within: 'within', below: 'above', right: 'left' }) as const)[besideBook()]

// One panel failing must not take the rest of the workspace with it.
const Broken = ({ error }: { error: unknown }) => (
  <div className="viewer-message">This panel hit a problem: {error instanceof Error ? error.message : String(error)}</div>
)

const Loading = () => <div className="viewer-message">Loading…</div>

function DocPanel({ params }: IDockviewPanelProps<{ file: File }>) {
  const Viewer = viewerFor(params.file.name)
  if (!Viewer) return <div className="viewer-message">Sidepage does not recognise this file, so it cannot open it yet.</div>
  return <ErrorBoundary FallbackComponent={Broken}><Suspense fallback={<Loading />}><Viewer file={params.file} /></Suspense></ErrorBoundary>
}

function NotePanel({ params }: IDockviewPanelProps<{ kind: NoteKind; notebook: string }>) {
  const Note = NOTE_KINDS[params.kind].component
  // Reload from the new place when the notes folder changes.
  const [storage, setStorage] = useState(0)
  useEffect(() => onNotesFolderChange(() => setStorage(n => n + 1)), [])
  return <ErrorBoundary FallbackComponent={Broken}><Suspense fallback={<Loading />}><Note key={storage} notebook={params.notebook} /></Suspense></ErrorBoundary>
}

const GraphPanel = () => <ErrorBoundary FallbackComponent={Broken}><Suspense fallback={<Loading />}><GraphView /></Suspense></ErrorBoundary>

const components = { doc: DocPanel, note: NotePanel, graph: GraphPanel }

export default function App() {
  const api = useRef<DockviewApi | null>(null)
  const [notebook, setNotebook] = useState('My notebook')
  const [paper, setPaper] = useState<Paper>(() => (localStorage.getItem('sidepage:paper') as Paper) || 'lined')
  const [empty, setEmpty] = useState(true)
  const theme = useTheme()
  const [folder, setFolder] = useState(notesFolder)
  const [books, setBooks] = useState<Shelved[]>([])
  // On narrow screens the less-used controls fold into a "More" menu, so nothing runs off the edge.
  const [more, setMore] = useState(false)
  const [layout, setLayout] = useState<Layout>(chosenLayout)
  // Covers for the home screen, by book.
  const [covers, setCovers] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!empty) return
    let cancelled = false
    void Promise.all(books.map(async book => [book.name, await coverOf(book.name)] as const)).then(found => {
      if (!cancelled) setCovers(Object.fromEntries(found.filter(([, cover]) => cover)) as Record<string, string>)
    })
    return () => { cancelled = true }
  }, [books, empty])

  // Focus: nothing on screen but the page and the notes. Escape, or the corner button, brings the bars back.
  const [focus, setFocus] = useState(false)
  useEffect(() => {
    if (!focus) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFocus(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus])

  // Put the open panels where the layout says: every book in one group, every note in another, and the notes
  // beside the books, below them, or in the same tab strip. Turning a tablet does this by itself, and the Layout
  // control does it on request, since tabs cannot be dragged about with a finger.
  const arrange = useCallback(() => {
    const dock = api.current
    if (!dock) return
    const books = dock.panels.filter(p => p.id.startsWith('doc:'))
    const notes = dock.panels.filter(p => !p.id.startsWith('doc:'))
    if (!books.length || !notes.length) return
    const shown = [dock.activePanel, ...dock.groups.map(group => group.activePanel)]
    const home = books[0].group
    for (const book of books.slice(1)) if (book.group !== home) book.api.moveTo({ group: home, position: 'center' })
    const where = besideBook()
    notes[0].api.moveTo({ group: home, position: where === 'right' ? 'right' : where === 'below' ? 'bottom' : 'center' })
    for (const note of notes.slice(1)) note.api.moveTo({ group: notes[0].group, position: 'center' })
    // Keep in front what the reader was looking at.
    for (const panel of shown.reverse()) panel?.api.setActive()
  }, [])

  const placed = useRef(besideBook())
  useEffect(() => {
    localStorage.setItem('sidepage:layout', layout)
    placed.current = besideBook()
    arrange()
  }, [layout, arrange])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const onResize = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (besideBook() === placed.current) return
        placed.current = besideBook()
        arrange()
      }, 250)
    }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); clearTimeout(timer) }
  }, [arrange])

  useEffect(() => {
    void restoreNotesFolder()
    return onNotesFolderChange(() => setFolder(notesFolder()))
  }, [])

  useEffect(() => {
    document.documentElement.dataset.paper = paper
    localStorage.setItem('sidepage:paper', paper)
  }, [paper])

  const openNote = useCallback((kind: NoteKind, book: string) => {
    const dock = api.current
    if (!dock) return
    const id = `note:${kind}:${book}`
    const existing = dock.getPanel(id)
    if (existing) return existing.api.setActive()
    // Notes stack together in one group, to the right of the book.
    const sibling = dock.panels.find(p => p.id.startsWith('note:'))
    const reference = dock.panels.find(p => p.id.startsWith('doc:'))
    dock.addPanel({
      id,
      component: 'note',
      title: `${NOTE_KINDS[kind].title} · ${book}`,
      params: { kind, notebook: book },
      position: sibling
        ? { referencePanel: sibling.id, direction: 'within' }
        : reference ? { referencePanel: reference.id, direction: besideBook() } : undefined,
    })
  }, [])

  const openBook = useCallback((file: File) => {
    const dock = api.current
    if (!dock) return
    const book = baseName(file.name)
    setNotebook(book)
    const id = `doc:${file.name}`
    const existing = dock.getPanel(id)
    if (existing) return existing.api.setActive()
    const sibling = dock.panels.find(p => p.id.startsWith('doc:'))
    const note = dock.panels.find(p => p.id.startsWith('note:'))
    dock.addPanel({
      id,
      component: 'doc',
      title: file.name,
      params: { file },
      position: sibling
        ? { referencePanel: sibling.id, direction: 'within' }
        : note ? { referencePanel: note.id, direction: besideNotes() } : undefined,
    })
    openNote('written', book)
    dock.getPanel(id)?.api.setActive()
  }, [openNote])

  // A .sidepage file is unpacked into its book and notes first; every opened book goes on the shelf.
  const openFile = useCallback(async (picked: File) => {
    // A file whose name does not say what it is (usual on phones) is recognised by its contents.
    const file = await withDetectedType(picked, ext => ext === BUNDLE_EXTENSION || !!viewerFor(`x.${ext}`))
    const book = extensionOf(file.name) === BUNDLE_EXTENSION ? await unpackBundle(file) : file
    openBook(book)
    await shelve(book)
    setBooks(await shelf())
  }, [openBook])

  useEffect(() => { void shelf().then(setBooks) }, [])

  // A link in a note leads to its place in the book, reopening the book from the shelf if it was closed.
  useEffect(() => onGoToPlace(async ({ book, place }) => {
    const panel = api.current?.getPanel(`doc:${book}`)
    if (panel) return panel.api.setActive()
    const file = await fromShelf(book)
    if (!file) return
    localStorage.setItem(`sidepage:place:${book}`, place.replace(/^page=/, ''))
    void openFile(file)
  }), [openFile])

  // A link between notebooks, or a dot in the graph, opens that book with its notes.
  useEffect(() => onOpenBookByName(async name => {
    const panel = api.current?.getPanel(`doc:${name}`)
    if (panel) {
      panel.api.setActive()
      return openNote('written', baseName(name))
    }
    const file = await fromShelf(name)
    if (file) void openFile(file)
  }), [openFile, openNote])

  const openGraph = useCallback(() => {
    const dock = api.current
    if (!dock) return
    const existing = dock.getPanel('graph')
    if (existing) return existing.api.setActive()
    const sibling = dock.panels.find(p => p.id.startsWith('note:'))
    dock.addPanel({ id: 'graph', component: 'graph', title: 'Graph', position: sibling ? { referencePanel: sibling.id, direction: 'within' } : undefined })
  }, [])

  // A highlight clicked in the book brings its notebook forward.
  useEffect(() => onFindInNotes(() => api.current?.getPanel(`note:written:${notebook}`)?.api.setActive()), [notebook])

  // The book and everything written beside it, saved together as one .sidepage file.
  const saveWhole = useCallback(async () => {
    const dock = api.current
    const active = dock?.activePanel?.params as { file?: File } | undefined
    const file = active?.file
      ?? (dock?.panels.map(p => (p.params as { file?: File } | undefined)?.file).find(f => f && baseName(f.name) === notebook))
    if (!file) return
    // Let the last keystrokes reach storage before packing.
    await new Promise(resolve => setTimeout(resolve, 1000))
    await saveFileAs(`${baseName(file.name)}.${BUNDLE_EXTENSION}`, await packBundle(file))
  }, [notebook])

  const browse = useCallback(async () => {
    const file = await pickFile()
    if (file) void openFile(file)
  }, [openFile])

  // Dev helper: open a file by URL from the console, e.g. __open('/samples/sample.pdf').
  useEffect(() => {
    if (!import.meta.env.DEV) return
    Object.assign(window, {
      __open: async (url: string) => openFile(new File([await (await fetch(url)).blob()], url.split('/').pop()!)),
    })
  }, [openFile])

  const onReady = (event: DockviewReadyEvent) => {
    api.current = event.api
    void launchFile().then(file => { if (file) void openFile(file) })
    const sync = () => setEmpty(event.api.panels.length === 0)
    event.api.onDidAddPanel(sync)
    event.api.onDidRemovePanel(sync)
    event.api.onDidActivePanelChange(() => {
      const book = (event.api.activePanel?.params as { notebook?: string; file?: File } | undefined)
      if (book?.notebook) setNotebook(book.notebook)
      else if (book?.file) setNotebook(baseName(book.file.name))
    })
  }

  return (
    <div
      className={focus ? 'app focus' : 'app'}
      // Dropped files are books for Sidepage; they stop here so PDF.js does not also try to paste them into a page.
      onDragOver={e => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={e => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        e.stopPropagation()
        for (const file of e.dataTransfer.files) void openFile(file)
      }}
    >
      <header className="topbar">
        <img className="brand-mark" src="./favicon.svg" alt="" />
        <strong className="brand-name">Sidepage</strong>
        <Tool icon={FolderOpen} label="Open" hint="Open a book, document, deck or picture" onClick={() => void browse()} />
        <div className="segment" role="group" aria-label="Write beside the book">
          <Tool icon={NotebookPen} label="Notes" hint="Written notes" onClick={() => openNote('written', notebook)} />
          <Tool icon={PenLine} label="Canvas" hint="Draw and handwrite" onClick={() => openNote('canvas', notebook)} />
          <Tool icon={Workflow} label="Mind map" onClick={() => openNote('mindmap', notebook)} />
          <Tool icon={Share2} label="Graph" hint="How your books' notes link to each other" onClick={openGraph} />
        </div>
        <span className="spacer" />
        <NotesSearch />
        <Tool quiet icon={Maximize2} label="Focus" hint="Hide everything but the page and your notes" disabled={empty} onClick={() => setFocus(true)} />
        <Tool quiet icon={LAYOUT_ICONS[layout]} label={`Layout: ${LAYOUTS[layout]}`} hint={`Layout: ${LAYOUTS[layout]}. Tap to change.`} onClick={() => setLayout(next(Object.keys(LAYOUTS) as Layout[], layout))} />
        <Tool quiet icon={THEME_ICONS[theme]} label={`Theme: ${theme}`} hint={`Theme: ${theme}. Tap to change.`} onClick={() => setTheme(next(THEMES, theme))} />
        <Tool quiet icon={Ellipsis} label="More" on={more} onClick={() => setMore(!more)} />
        {more && <>
          <div className="menu-backdrop" onClick={() => setMore(false)} />
          <div className="menu" onClick={e => { if ((e.target as HTMLElement).closest('button')) setMore(false) }}>
            <Tool icon={Package} label="Save as one file" hint="Save the book and all its notes together as one .sidepage file" disabled={empty} onClick={() => void saveWhole()} />
            {canPickNotesFolder && (
              <Tool
                icon={FolderCog}
                label={!folder.name ? 'Choose notes folder' : folder.locked ? `Reconnect notes folder: ${folder.name}` : `Notes folder: ${folder.name}`}
                hint="Where your notes are saved as files"
                onClick={() => void chooseNotesFolder()}
              />
            )}
            <label className="menu-row">
              Paper
              <select value={paper} onChange={e => setPaper(e.target.value as Paper)}>
                {PAPERS.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
              </select>
            </label>
            <label className="menu-row">
              Layout
              <select value={layout} onChange={e => setLayout(e.target.value as Layout)}>
                {(Object.keys(LAYOUTS) as Layout[]).map(key => <option key={key} value={key}>{LAYOUTS[key]}</option>)}
              </select>
            </label>
            <label className="menu-row">
              Theme
              <select value={theme} onChange={e => setTheme(e.target.value as Theme)}>
                {THEMES.map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
              </select>
            </label>
          </div>
        </>}
      </header>
      {focus && <button className="focus-exit" title="Show the toolbars again" aria-label="Leave focus" onClick={() => setFocus(false)}><Minimize2 size={18} aria-hidden /></button>}
      <main className="workspace">
        <DockviewReact components={components} onReady={onReady} theme={themeLight} defaultRenderer="always" />
        {empty && (
          <div className="welcome">
            <img className="welcome-mark" src="./favicon.svg" alt="" />
            <h1>Read on one side, think on the other.</h1>
            <p>Open a book, a document, a slide deck or a picture. Your notes open beside it.</p>
            <button className="primary" onClick={() => void browse()}><FolderOpen size={18} aria-hidden /> Open a book</button>
            {books.length > 0 && <h2 className="shelf-title">Recent</h2>}
            {books.length > 0 && (
              <ul className="shelf">
                {books.slice(0, 12).map(book => (
                  <li key={book.name}>
                    <button className="shelf-book" onClick={() => void fromShelf(book.name).then(file => { if (file) void openFile(file) })}>
                      {covers[book.name]
                        ? <img className="shelf-cover" src={covers[book.name]} alt="" />
                        : <span className="shelf-cover blank">{extensionOf(book.name)}</span>}
                      <span className="shelf-text">
                        <span className="shelf-name">{baseName(book.name)}</span>
                        <span className="shelf-meta">{extensionOf(book.name).toUpperCase()} · {Math.round(progressOf(book.name) * 100)}% read</span>
                        <span className="shelf-bar"><i style={{ width: `${Math.round(progressOf(book.name) * 100)}%` }} /></span>
                      </span>
                    </button>
                    <button className="shelf-remove" title="Remove from this list" aria-label="Remove from this list" onClick={() => void unshelve(book.name).then(shelf).then(setBooks)}><X size={15} aria-hidden /></button>
                  </li>
                ))}
              </ul>
            )}
            <p className="hint">PDF · EPUB · MOBI · AZW3 · FB2 · DJVU · CBZ · CBR · DOCX · DOC · RTF · ODT · PPTX · PPT · TXT · Markdown · HTML · pictures</p>
          </div>
        )}
      </main>
    </div>
  )
}
