import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { DockviewReact, themeLight, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { baseName, extensionOf, pickFile } from './lib/platform'

const PdfView = lazy(() => import('./viewers/PdfView'))
const BookView = lazy(() => import('./viewers/BookView'))
const OfficeView = lazy(() => import('./viewers/OfficeView'))
const SlidesView = lazy(() => import('./viewers/SlidesView'))
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
  if (['epub', 'mobi', 'azw', 'azw3', 'kf8', 'fb2', 'fbz', 'cbz'].includes(ext)) return BookView
  if (ext === 'docx') return OfficeView
  if (ext === 'pptx') return SlidesView
  if (['txt', 'md', 'markdown', 'html', 'htm'].includes(ext)) return TextView
  return null
}

const Loading = () => <div className="viewer-message">Loading…</div>

function DocPanel({ params }: IDockviewPanelProps<{ file: File }>) {
  const Viewer = viewerFor(params.file.name)
  if (!Viewer) return <div className="viewer-message">Sidepage cannot open .{extensionOf(params.file.name)} files yet.</div>
  return <Suspense fallback={<Loading />}><Viewer file={params.file} /></Suspense>
}

function NotePanel({ params }: IDockviewPanelProps<{ kind: NoteKind; notebook: string }>) {
  const Note = NOTE_KINDS[params.kind].component
  return <Suspense fallback={<Loading />}><Note notebook={params.notebook} /></Suspense>
}

const components = { doc: DocPanel, note: NotePanel }

export default function App() {
  const api = useRef<DockviewApi | null>(null)
  const [notebook, setNotebook] = useState('My notebook')
  const [paper, setPaper] = useState<Paper>(() => (localStorage.getItem('sidepage:paper') as Paper) || 'lined')
  const [empty, setEmpty] = useState(true)

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
        : reference ? { referencePanel: reference.id, direction: 'right' } : undefined,
    })
  }, [])

  const openFile = useCallback((file: File) => {
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
        : note ? { referencePanel: note.id, direction: 'left' } : undefined,
    })
    openNote('written', book)
    dock.getPanel(id)?.api.setActive()
  }, [openNote])

  const browse = useCallback(async () => {
    const file = await pickFile()
    if (file) openFile(file)
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
        for (const file of e.dataTransfer.files) openFile(file)
      }}
    >
      <header className="topbar">
        <strong className="brand">Sidepage</strong>
        <button onClick={browse}>Open book</button>
        <span className="divider" />
        {(Object.keys(NOTE_KINDS) as NoteKind[]).map(kind => (
          <button key={kind} onClick={() => openNote(kind, notebook)}>{NOTE_KINDS[kind].title}</button>
        ))}
        <span className="spacer" />
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
            <p className="hint">PDF · EPUB · MOBI · AZW3 · FB2 · CBZ · DOCX · PPTX · TXT · Markdown · HTML</p>
          </div>
        )}
      </main>
    </div>
  )
}
