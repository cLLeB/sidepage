import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { DockviewReact, themeLight, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react'
import { ErrorBoundary } from 'react-error-boundary'
import 'dockview-react/dist/styles/dockview.css'
import {
  baseName, canPickNotesFolder, chooseNotesFolder, extensionOf, fromShelf, launchFile, notesFolder, onFindInNotes, onGoToPlace,
  onNotesFolderChange, pickFile, restoreNotesFolder, saveFileAs, shelf, shelve, unshelve, type Shelved,
} from './lib/platform'
import { BUNDLE_EXTENSION, packBundle, unpackBundle } from './lib/bundle'

const PdfView = lazy(() => import('./viewers/PdfView'))
const BookView = lazy(() => import('./viewers/BookView'))
const OfficeView = lazy(() => import('./viewers/OfficeView'))
const SlidesView = lazy(() => import('./viewers/SlidesView'))
const DjvuView = lazy(() => import('./viewers/DjvuView'))
const PptView = lazy(() => import('./viewers/PptView'))
const TextView = lazy(() => import('./viewers/TextView'))
const WrittenNote = lazy(() => import('./notes/WrittenNote'))
const CanvasNote = lazy(() => import('./notes/CanvasNote'))
const MindMapNote = lazy(() => import('./notes/MindMapNote'))

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
  if (['epub', 'mobi', 'azw', 'azw3', 'kf8', 'fb2', 'fbz', 'cbz', 'cbr', 'cb7', 'cbt'].includes(ext)) return BookView
  if (['docx', 'doc', 'rtf', 'odt'].includes(ext)) return OfficeView
  if (ext === 'ppt' || ext === 'pps') return PptView
  if (ext === 'pptx') return SlidesView
  if (ext === 'djvu' || ext === 'djv') return DjvuView
  if (['txt', 'md', 'markdown', 'html', 'htm'].includes(ext)) return TextView
  return null
}

// Side by side on wide screens, stacked on a tablet held upright, one tab strip on a phone.
const besideBook = () => (window.innerWidth < 700 ? 'within' : window.innerWidth < window.innerHeight ? 'below' : 'right')
const besideNotes = () => (({ within: 'within', below: 'above', right: 'left' }) as const)[besideBook()]

// One panel failing must not take the rest of the workspace with it.
const Broken = ({ error }: { error: unknown }) => (
  <div className="viewer-message">This panel hit a problem: {error instanceof Error ? error.message : String(error)}</div>
)

const Loading = () => <div className="viewer-message">Loading…</div>

function DocPanel({ params }: IDockviewPanelProps<{ file: File }>) {
  const Viewer = viewerFor(params.file.name)
  if (!Viewer) return <div className="viewer-message">Sidepage cannot open .{extensionOf(params.file.name)} files yet.</div>
  return <ErrorBoundary FallbackComponent={Broken}><Suspense fallback={<Loading />}><Viewer file={params.file} /></Suspense></ErrorBoundary>
}

function NotePanel({ params }: IDockviewPanelProps<{ kind: NoteKind; notebook: string }>) {
  const Note = NOTE_KINDS[params.kind].component
  // Reload from the new place when the notes folder changes.
  const [storage, setStorage] = useState(0)
  useEffect(() => onNotesFolderChange(() => setStorage(n => n + 1)), [])
  return <ErrorBoundary FallbackComponent={Broken}><Suspense fallback={<Loading />}><Note key={storage} notebook={params.notebook} /></Suspense></ErrorBoundary>
}

const components = { doc: DocPanel, note: NotePanel }

export default function App() {
  const api = useRef<DockviewApi | null>(null)
  const [notebook, setNotebook] = useState('My notebook')
  const [paper, setPaper] = useState<Paper>(() => (localStorage.getItem('sidepage:paper') as Paper) || 'lined')
  const [empty, setEmpty] = useState(true)
  const [folder, setFolder] = useState(notesFolder)
  const [books, setBooks] = useState<Shelved[]>([])

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
      title: `${NOTE_KINDS[kind].title} — ${book}`,
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
  const openFile = useCallback(async (file: File) => {
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
      className="app"
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDrop={e => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        for (const file of e.dataTransfer.files) void openFile(file)
      }}
    >
      <header className="topbar">
        <strong className="brand">Sidepage</strong>
        <button onClick={browse}>Open book</button>
        <span className="divider" />
        {(Object.keys(NOTE_KINDS) as NoteKind[]).map(kind => (
          <button key={kind} onClick={() => openNote(kind, notebook)}>{NOTE_KINDS[kind].title}</button>
        ))}
        <span className="divider" />
        <button onClick={() => void saveWhole()} disabled={empty} title="Save the book and all its notes together as one .sidepage file">Save as one file</button>
        <span className="spacer" />
        {canPickNotesFolder && (
          <button onClick={() => void chooseNotesFolder()} title="Where your notes are saved as files">
            {!folder.name ? 'Choose notes folder' : folder.locked ? `Reconnect notes folder: ${folder.name}` : `Notes folder: ${folder.name}`}
          </button>
        )}
        <label className="paper-picker">
          Paper
          <select value={paper} onChange={e => setPaper(e.target.value as Paper)}>
            {PAPERS.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </select>
        </label>
      </header>
      <main className="workspace">
        <DockviewReact components={components} onReady={onReady} theme={themeLight} defaultRenderer="always" />
        {empty && (
          <div className="welcome">
            <h1>Read on one side, think on the other.</h1>
            <p>Open a book, a document or a slide deck, or drop one here. Your notes open beside it.</p>
            <button className="primary" onClick={browse}>Open book</button>
            {books.length > 0 && (
              <ul className="shelf">
                {books.slice(0, 12).map(book => (
                  <li key={book.name}>
                    <button className="shelf-book" onClick={() => void fromShelf(book.name).then(file => { if (file) void openFile(file) })}>
                      <span className="shelf-kind">{extensionOf(book.name)}</span>
                      <span className="shelf-name">{baseName(book.name)}</span>
                    </button>
                    <button className="shelf-remove" title="Remove from this list" onClick={() => void unshelve(book.name).then(shelf).then(setBooks)}>×</button>
                  </li>
                ))}
              </ul>
            )}
            <p className="hint">PDF · EPUB · MOBI · AZW3 · FB2 · DJVU · CBZ · CBR · DOCX · RTF · ODT · PPTX · TXT · Markdown · HTML</p>
          </div>
        )}
      </main>
    </div>
  )
}
