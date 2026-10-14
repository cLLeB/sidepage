import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { DockviewReact, type DockviewApi, type DockviewTheme, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react'
import { ErrorBoundary } from 'react-error-boundary'
import {
  Coffee, Columns2, Ellipsis, FolderCog, FolderOpen, LayoutDashboard, Moon, NotebookPen, Package, PanelTop, PenLine, Rows2,
  Archive, ArchiveRestore, Highlighter, FileDown, GraduationCap, Maximize2, Minimize2, Share2, Sun, SunMoon, Workflow, Command as CommandIcon,
  BookOpenText, Home as HomeIcon, NotebookText, Ruler, Sparkles,
} from 'lucide-react'
import { bookmarksFile } from './lib/reading'
import NotesSearch from './notes/NotesSearch'
import { coverOf } from './lib/reading'
import Home from './Home'
import { Comfort, FocusClock, LookUp, Palette, StudyTimer, VoiceSettings, useScreenOn, type Command } from './Extras'
import { ACCENTS, applyAccent, usePref, type Accent } from './lib/prefs'
import { OCR_LANGUAGES } from './lib/ocr'
import { bibliography } from './viewers/Cite'
import { Tool } from './ui'
import 'dockview-react/dist/styles/dockview.css'
import {
  loadNote,
  baseName, canPickNotesFolder, chooseNotesFolder, extensionOf, fromShelf, isShown, launchFile, notesFolder, onClip, onFindInNotes, onGoToPlace, onOpenBookByName, onQuote, sendClip, sendQuote,
  onNotesFolderChange, pickFile, PICTURE_EXTENSIONS, restoreNotesFolder, saveFileAs, shelf, shelve, unshelve, type Shelved,
} from './lib/platform'
import { BUNDLE_EXTENSION, packBundle, unpackBundle } from './lib/bundle'
import { withDetectedType } from './lib/sniff'
import { setTheme, THEME_CHOICES, useThemeChoice, type ThemeChoice } from './lib/theme'
import { BACKUP_EXTENSION, packBackup, restoreBackup } from './lib/backup'
import { addReadingTime, addSpent, asTime } from './lib/reading'

// The panels float a little apart, each a sheet of its own.
const PANELS: DockviewTheme = { name: 'sidepage', className: 'dockview-theme-light', gap: 8, dndOverlayMounting: 'absolute', dndPanelOverlay: 'group' }

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
const ReviewView = lazy(() => import('./notes/ReviewView'))
const GuideView = lazy(() => import('./notes/GuideView'))
const GuidePanel = () => <ErrorBoundary FallbackComponent={Broken}><Suspense fallback={<Loading />}><GuideView /></Suspense></ErrorBoundary>

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
const THEME_ICONS = { auto: SunMoon, light: Sun, sepia: Coffee, dark: Moon } as const
const THEME_NAMES = { auto: 'Follow the device', light: 'Light', sepia: 'Sepia', dark: 'Dark' } as const
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

const HighlightsView = lazy(() => import('./notes/HighlightsView'))
const HighlightsPanel = () => <ErrorBoundary FallbackComponent={Broken}><Suspense fallback={<Loading />}><HighlightsView /></Suspense></ErrorBoundary>
const ReviewPanel = () => <ErrorBoundary FallbackComponent={Broken}><Suspense fallback={<Loading />}><ReviewView /></Suspense></ErrorBoundary>

const components = { doc: DocPanel, note: NotePanel, graph: GraphPanel, review: ReviewPanel, highlights: HighlightsPanel, guide: GuidePanel }

export default function App() {
  const api = useRef<DockviewApi | null>(null)
  const [notebook, setNotebook] = useState('My notebook')
  const [paper, setPaper] = useState<Paper>(() => (localStorage.getItem('sidepage:paper') as Paper) || 'lined')
  const [empty, setEmpty] = useState(true)
  const theme = useThemeChoice()
  // A short message after something has been done out of sight (a backup made, notes restored).
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(timer)
  }, [notice])
  const [palette, setPalette] = useState(false)
  const [accent, setAccent] = usePref<Accent>('accent', 'graphite')
  const [warmth, setWarmth] = usePref('warmth', 0)
  const [dim, setDim] = usePref('dim', 0)
  const [ruler, setRuler] = usePref('ruler', false)
  const [awake, setAwake] = usePref('awake', true)
  const [ocrLanguage, setOcrLanguage] = usePref('ocr-language', 'eng')

  // Reading time: a half-minute is counted whenever a book is open, the app is in view and the reader has
  // touched it in the last two minutes.
  const touched = useRef(Date.now())
  useEffect(() => {
    const touch = () => { touched.current = Date.now() }
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach(name => window.addEventListener(name, touch, { capture: true, passive: true }))
    const timer = setInterval(() => {
      const reading = !!api.current?.panels.some(panel => panel.id.startsWith('doc:'))
      if (!reading || document.visibilityState !== 'visible' || Date.now() - touched.current >= 120_000) return
      addReadingTime(0.5)
      // …and to the book in front (or the only one open).
      const files = [api.current?.activePanel, ...(api.current?.panels ?? [])].map(panel => (panel?.params as { file?: File } | undefined)?.file).filter(Boolean)
      if (files[0]) addSpent(files[0].name, 0.5)
    }, 30_000)
    return () => {
      events.forEach(name => window.removeEventListener(name, touch, { capture: true }))
      clearInterval(timer)
    }
  }, [])
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
  useScreenOn(awake && !empty)
  // Focus also takes the whole screen, where the device lets an app do that.
  useEffect(() => {
    if (!focus) return
    void document.documentElement.requestFullscreen?.().catch(() => {})
    const left = () => { if (!document.fullscreenElement) setFocus(false) }
    document.addEventListener('fullscreenchange', left)
    return () => {
      document.removeEventListener('fullscreenchange', left)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [focus])
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
    if (extensionOf(file.name) === BACKUP_EXTENSION) {
      const { restored, kept } = await restoreBackup(file)
      return setNotice(`Backup restored: ${restored} file${restored === 1 ? '' : 's'} put back${kept ? `, ${kept} already here and left as they were` : ''}. A book's notes show up when you open that book.`)
    }
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
    localStorage.setItem(`sidepage:place:${book}`, (place.match(/^page=(\d+)/)?.[1] ?? place))
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

  const openHighlights = useCallback(() => {
    const dock = api.current
    if (!dock) return
    // Closed and opened again, so it always shows what has been highlighted since.
    dock.getPanel('highlights')?.api.close()
    const sibling = dock.panels.find(p => !p.id.startsWith('doc:'))
    dock.addPanel({ id: 'highlights', component: 'highlights', title: 'Highlights', position: sibling ? { referencePanel: sibling.id, direction: 'within' } : undefined })
  }, [])

  const openGuide = useCallback(() => {
    const dock = api.current
    if (!dock) return
    const existing = dock.getPanel('guide')
    if (existing) return existing.api.setActive()
    const sibling = dock.panels.find(p => !p.id.startsWith('doc:'))
    const reference = dock.panels.find(p => p.id.startsWith('doc:'))
    dock.addPanel({
      id: 'guide', component: 'guide', title: 'Study guide',
      position: sibling ? { referencePanel: sibling.id, direction: 'within' } : reference ? { referencePanel: reference.id, direction: besideBook() } : undefined,
    })
  }, [])

  // Home: favourite books come first; the rest in the order chosen. A daily reading goal, if one is set.
  const [favourites, setFavourites] = useState<string[]>(() => JSON.parse(localStorage.getItem('sidepage:favourites') ?? '[]'))
  const toggleFavourite = (name: string) => {
    const now = favourites.includes(name) ? favourites.filter(f => f !== name) : [...favourites, name]
    setFavourites(now)
    localStorage.setItem('sidepage:favourites', JSON.stringify(now))
  }
  const [goal, setGoal] = useState(() => Number(localStorage.getItem('sidepage:goal')) || 0)

  const openReview = useCallback(() => {
    const dock = api.current
    if (!dock) return
    const existing = dock.getPanel('review')
    if (existing) return existing.api.setActive()
    const sibling = dock.panels.find(p => !p.id.startsWith('doc:'))
    dock.addPanel({ id: 'review', component: 'review', title: 'Review', position: sibling ? { referencePanel: sibling.id, direction: 'within' } : undefined })
  }, [])

  // The open book's notes on their own, as one Markdown file: what was written, then the highlights with their
  // comments, then the bookmarks.
  const exportNotes = useCallback(async () => {
    const dock = api.current
    const file = (dock?.activePanel?.params as { file?: File } | undefined)?.file
      ?? dock?.panels.map(p => (p.params as { file?: File } | undefined)?.file).find(f => f && baseName(f.name) === notebook)
    const parts = [(await loadNote(notebook, 'notes.md'))?.trim() || `# ${notebook}`]
    const highlights: { text: string; note?: string }[] = JSON.parse((await loadNote(notebook, 'highlights.json')) ?? '[]')
    if (highlights.length) parts.push('## Highlights', ...highlights.map(mark => `> ${mark.text.replace(/\n+/g, ' ')}${mark.note?.trim() ? `\n\n${mark.note.trim()}` : ''}`))
    const bookmarks: { label: string }[] = file ? JSON.parse((await loadNote(notebook, bookmarksFile(file.name))) ?? '[]') : []
    if (bookmarks.length) parts.push('## Bookmarks', bookmarks.map(mark => `- ${mark.label}`).join('\n'))
    await saveFileAs(`${notebook} notes.md`, new TextEncoder().encode(parts.join('\n\n') + '\n'))
  }, [notebook])

  // A quote or a clip needs somewhere to land. If that book's written notes are closed (and, for a clip, no
  // Canvas is in front to take it), they are opened and the quote or clip is sent once more.
  useEffect(() => {
    const landing = (book: string | undefined) => `note:written:${book ? baseName(book) : notebook}`
    const stopQuotes = onQuote(quote => {
      if (quote.again || api.current?.getPanel(landing(quote.book))) return
      openNote('written', quote.book ? baseName(quote.book) : notebook)
      setTimeout(() => sendQuote({ ...quote, again: true }), 1500)
    })
    const stopClips = onClip(clip => {
      if (clip.again || api.current?.getPanel(landing(clip.book)) || [...document.querySelectorAll('.canvas-page')].some(isShown)) return
      openNote('written', baseName(clip.book))
      setTimeout(() => sendClip({ ...clip, again: true }), 1500)
    })
    return () => { stopQuotes(); stopClips() }
  }, [notebook, openNote])

  // Keyboard shortcuts, for the desktop. (Opening a book is reached through a ref: it is defined further down.)
  const browseNow = useRef<() => void>(() => {})
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      const act = (action: () => void) => { e.preventDefault(); action() }
      if (key === 'o' && !e.shiftKey) act(() => browseNow.current())
      else if (key === '1' && !e.shiftKey) act(() => openNote('written', notebook))
      else if (key === '2' && !e.shiftKey) act(() => openNote('canvas', notebook))
      else if (key === '3' && !e.shiftKey) act(() => openNote('mindmap', notebook))
      else if (key === 'l' && e.shiftKey) act(() => setLayout(current => next(Object.keys(LAYOUTS) as Layout[], current)))
      else if (key === 'd' && e.shiftKey) act(() => setTheme(next(THEME_CHOICES, theme)))
      else if (key === '.' && !e.shiftKey) act(() => setFocus(on => !on && !empty))
      else if (key === 'k' && !e.shiftKey) act(() => setPalette(on => !on))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openNote, notebook, theme, empty])

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
  browseNow.current = () => void browse()

  // Dev helper: open a file by URL from the console, e.g. __open('/samples/sample.pdf').
  useEffect(() => {
    if (!import.meta.env.DEV) return
    Object.assign(window, {
      __open: async (url: string) => openFile(new File([await (await fetch(url)).blob()], url.split('/').pop()!)),
    })
  }, [openFile])

  const goHome = () => { for (const panel of [...(api.current?.panels ?? [])]) panel.api.close() }
  const openFromShelf = (name: string) => void fromShelf(name).then(file => { if (file) void openFile(file) })

  // Everything the palette can do. Built when it opens, so the list of books is the current one.
  const commands = (): Command[] => [
    { group: 'Go to', name: 'Open a book or document…', hint: 'Ctrl+O', icon: FolderOpen, run: () => void browse() },
    { group: 'Go to', name: 'Home: your library', icon: HomeIcon, run: goHome },
    { group: 'Go to', name: 'Quick notes', icon: NotebookText, run: () => openNote('written', 'Quick notes') },
    { group: 'Write', name: 'Notes for this book', hint: 'Ctrl+1', icon: NotebookPen, run: () => openNote('written', notebook) },
    { group: 'Write', name: 'Canvas: draw and handwrite', hint: 'Ctrl+2', icon: PenLine, run: () => openNote('canvas', notebook) },
    { group: 'Write', name: 'Mind map', hint: 'Ctrl+3', icon: Workflow, run: () => openNote('mindmap', notebook) },
    { group: 'Study', name: 'Study guide for this page', icon: Sparkles, run: openGuide },
    { group: 'Study', name: 'Review flashcards', icon: GraduationCap, run: openReview },
    { group: 'Study', name: 'All highlights', icon: Highlighter, run: openHighlights },
    { group: 'Study', name: 'Graph of linked notes', icon: Share2, run: openGraph },
    { group: 'View', name: 'Focus: hide the toolbars', hint: 'Ctrl+.', icon: Maximize2, run: () => setFocus(!empty) },
    { group: 'View', name: ruler ? 'Put the reading ruler away' : 'Reading ruler', icon: Ruler, run: () => setRuler(!ruler) },
    ...(Object.keys(LAYOUTS) as Layout[]).map(key => ({ group: 'View', name: `Layout: ${LAYOUTS[key]}`, icon: LAYOUT_ICONS[key], run: () => setLayout(key) })),
    ...THEME_CHOICES.map(choice => ({ group: 'View', name: `Theme: ${THEME_NAMES[choice]}`, icon: THEME_ICONS[choice], run: () => setTheme(choice) })),
    ...PAPERS.map(kind => ({ group: 'View', name: `Paper: ${kind}`, icon: NotebookPen, run: () => setPaper(kind) })),
    { group: 'Keep', name: 'Save the book and its notes as one file', icon: Package, run: () => void saveWhole() },
    { group: 'Keep', name: 'Export this book\'s notes', icon: FileDown, run: () => void exportNotes() },
    { group: 'Keep', name: 'Save a bibliography of every book (BibTeX)', icon: FileDown, run: () => void bibliography('BibTeX').then(text => saveFileAs('Sidepage library.bib', new TextEncoder().encode(text + '\n'))) },
    { group: 'Keep', name: 'Save a reading list of every book (APA)', icon: FileDown, run: () => void bibliography('APA').then(text => saveFileAs('Reading list.md', new TextEncoder().encode('# Reading list\n\n' + text.split('\n\n').map(line => `- ${line}`).join('\n') + '\n'))) },
    ...books.map(book => ({ group: 'Your books', name: baseName(book.name), icon: BookOpenText, run: () => openFromShelf(book.name) })),
  ]

  const onReady = (event: DockviewReadyEvent) => {
    api.current = event.api
    void launchFile().then(file => { if (file) void openFile(file) })
    const sync = () => setEmpty(event.api.panels.length === 0)
    event.api.onDidAddPanel(sync)
    event.api.onDidRemovePanel(sync)
    event.api.onDidActivePanelChange(() => {
      // A reader brought to the front tells the guide and the notes where it is.
      event.api.activePanel?.view.content.element.querySelector('.viewer')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
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
        <button className="brand" title="Home: your library" aria-label="Home" onClick={goHome}>
          <img className="brand-mark" src="./favicon.svg" alt="" />
          <strong className="brand-name">Sidepage</strong>
        </button>
        <Tool icon={FolderOpen} label="Open" hint="Open a book, document, deck or picture (Ctrl+O)" onClick={() => void browse()} />
        <div className="segment" role="group" aria-label="Write beside the book">
          <Tool icon={NotebookPen} label="Notes" hint="Written notes (Ctrl+1)" onClick={() => openNote('written', notebook)} />
          <Tool icon={PenLine} label="Canvas" hint="Draw and handwrite (Ctrl+2)" onClick={() => openNote('canvas', notebook)} />
          <Tool icon={Workflow} label="Mind map" hint="Mind map (Ctrl+3)" onClick={() => openNote('mindmap', notebook)} />
          <Tool icon={Share2} label="Graph" hint="How your books' notes link to each other" onClick={openGraph} />
          <Tool icon={Highlighter} label="Highlights" hint="Every highlight from every book" onClick={openHighlights} />
          <Tool icon={Sparkles} label="Guide" hint="The gist of this page, the book's key terms, and kindred places in your other books" onClick={openGuide} />
          <Tool icon={GraduationCap} label="Review" hint="Go through the flashcards made from your highlights and notes" onClick={openReview} />
        </div>
        <span className="spacer" />
        <button className="jump" title="Go to anything (Ctrl+K)" onClick={() => setPalette(true)}><CommandIcon size={15} aria-hidden /><span>Go to…</span><kbd>Ctrl K</kbd></button>
        <NotesSearch />
        <StudyTimer onNotice={setNotice} />
        <Tool quiet icon={Maximize2} label="Focus" hint="Hide everything but the page and your notes (Ctrl+.)" disabled={empty} onClick={() => setFocus(true)} />
        <Tool quiet icon={THEME_ICONS[theme]} label={`Theme: ${THEME_NAMES[theme]}`} hint={`Theme: ${THEME_NAMES[theme]}. Tap to change.`} onClick={() => setTheme(next(THEME_CHOICES, theme))} />
        <Tool quiet icon={Ellipsis} label="More" on={more} onClick={() => setMore(!more)} />
        {more && <>
          <div className="menu-backdrop" onClick={() => setMore(false)} />
          <div className="menu settings" onClick={e => { if ((e.target as HTMLElement).closest('button:not(.stay)')) setMore(false) }}>
            <Tool icon={Package} label="Save as one file" hint="Save the book and all its notes together as one .sidepage file" disabled={empty} onClick={() => void saveWhole()} />
            <Tool
              icon={Archive}
              label="Back up all notes"
              hint="Save the notes, drawings, highlights and bookmarks of every book as one file"
              onClick={() => void packBackup().then(async ({ data, notebooks }) => {
                await saveFileAs(`Sidepage backup ${new Date().toLocaleDateString('en-CA')}.zip`, data)
                setNotice(`Backed up the notes of ${notebooks} book${notebooks === 1 ? '' : 's'}.`)
              })}
            />
            <Tool icon={ArchiveRestore} label="Restore a backup" hint="Put back notes from a backup file. Nothing already here is overwritten." onClick={() => void browse()} />
            <Tool icon={FileDown} label="Export notes" hint="Save this book's notes, highlights and bookmarks as one Markdown file" disabled={empty} onClick={() => void exportNotes()} />
            {canPickNotesFolder && (
              <Tool
                icon={FolderCog}
                label={!folder.name ? 'Choose notes folder' : folder.locked ? `Reconnect notes folder: ${folder.name}` : `Notes folder: ${folder.name}`}
                hint="Where your notes are saved as files"
                onClick={() => void chooseNotesFolder()}
              />
            )}
            <p className="menu-head">Look</p>
            <div className="menu-row">Accent
              <span className="swatches">
                {(Object.keys(ACCENTS) as Accent[]).map(name => (
                  <button key={name} className={accent === name ? 'swatch stay on' : 'swatch stay'} style={{ background: ACCENTS[name] || 'var(--muted)' }} title={name[0].toUpperCase() + name.slice(1)} aria-label={`${name} accent`} onClick={() => { setAccent(name); applyAccent(name) }} />
                ))}
              </span>
            </div>
            <label className="menu-row">Warmth<input type="range" min={0} max={100} step={5} value={warmth} onChange={e => setWarmth(Number(e.target.value))} /></label>
            <label className="menu-row">Dim<input type="range" min={0} max={60} step={5} value={dim} onChange={e => setDim(Number(e.target.value))} /></label>
            <label className="menu-row">Reading ruler<input type="checkbox" checked={ruler} onChange={e => setRuler(e.target.checked)} /></label>
            <label className="menu-row">Keep the screen on<input type="checkbox" checked={awake} onChange={e => setAwake(e.target.checked)} /></label>
            <VoiceSettings />
            <p className="menu-head">Reading</p>
            <label className="menu-row">Text in pictures
              <select value={ocrLanguage} onChange={e => setOcrLanguage(e.target.value)} title="The language “Read text” looks for in scans and pictures">
                {Object.entries(OCR_LANGUAGES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label className="menu-row">
              Daily goal
              <select value={goal} onChange={e => { setGoal(Number(e.target.value)); localStorage.setItem('sidepage:goal', e.target.value) }}>
                <option value={0}>None</option>
                {[15, 30, 45, 60, 90, 120].map(minutes => <option key={minutes} value={minutes}>{asTime(minutes)}</option>)}
              </select>
            </label>
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
              <select value={theme} onChange={e => setTheme(e.target.value as ThemeChoice)}>
                {THEME_CHOICES.map(t => <option key={t} value={t}>{THEME_NAMES[t]}</option>)}
              </select>
            </label>
          </div>
        </>}
      </header>
      {focus && <FocusClock />}
      {focus && <button className="focus-exit" title="Show the toolbars again" aria-label="Leave focus" onClick={() => setFocus(false)}><Minimize2 size={18} aria-hidden /></button>}
      <Comfort />
      <LookUp />
      {palette && <Palette commands={commands()} onClose={() => setPalette(false)} />}
      {notice && <div className="notice" role="status" onClick={() => setNotice('')}>{notice}</div>}
      <main className="workspace">
        <DockviewReact components={components} onReady={onReady} theme={PANELS} defaultRenderer="always" />
        {empty && (
          <Home
            books={books} covers={covers} favourites={favourites} goal={goal}
            onOpen={openFromShelf} onBrowse={() => void browse()} onFavourite={toggleFavourite}
            onRemove={name => void unshelve(name).then(shelf).then(setBooks)}
            onQuickNotes={() => openNote('written', 'Quick notes')}
          />
        )}
      </main>
    </div>
  )
}
