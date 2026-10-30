import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { DockviewReact, type DockviewApi, type DockviewTheme, type DockviewReadyEvent, type IDockviewHeaderActionsProps, type IDockviewPanelProps } from 'dockview-react'
import { ErrorBoundary } from 'react-error-boundary'
import {
  Coffee, MoonStar, Columns2, Ellipsis, FolderCog, FolderOpen, LayoutDashboard, Moon, NotebookPen, Package, PanelTop, PenLine, Rows2,
  Archive, ArchiveRestore, Highlighter, FileDown, GraduationCap, Maximize2, Minimize2, Share2, Sun, SunMoon, Workflow, Command as CommandIcon,
  CircleHelp, RefreshCw, ChevronDown, Timer, ChevronLeft, ChevronRight, Folders, MessageCircleQuestion, Network, ArrowLeftRight, BookOpen, CalendarPlus, Globe, BookMarked, BookOpenText, Home as HomeIcon, NotebookText, Ruler, Sparkles,
} from 'lucide-react'
import { bookmarksFile } from './lib/reading'
import NotesSearch from './notes/NotesSearch'
import { coverOf } from './lib/reading'
import Home from './Home'
import { canUpdateInPlace, findUpdate, restart, updatesByThemselves, updatesHere, type Update } from './lib/update'
import { Comfort, FocusClock, LookUp, Palette, SittingCard, Soundscape, StudyTimer, Translator, VoiceSettings, useScreenOn, type Command } from './Extras'
import { beginSitting, endSitting, type Sitting } from './lib/session'
import { ACCENTS, applyAccent, usePref, type Accent, setPref } from './lib/prefs'
import { OCR_LANGUAGES } from './lib/ocr'
import { LANGUAGES, setLanguage, uiLanguage, type Language } from './lib/language'
import { bibliography, CiteDialog, openCite } from './viewers/Cite'
import { Tool, Menu } from './ui'
import 'dockview-react/dist/styles/dockview.css'
import {
  loadNote,
  baseName, finishSaving, moveNotebook, saveWaiting, canPickNotesFolder, chooseNotesFolder, extensionOf, fromShelf, isShown, notesFolder, onClip, onFindInNotes, onGoToPlace, onOpenBookByName, onQuote, sendClip, sendQuote,
  onNotesFolderChange, canRunTools, openOutside, onOpenedFiles, onOpenFileNow, pickFile, placeNow, tellPlace, PICTURE_EXTENSIONS, restoreNotesFolder, saveFileAs, shelf, shelve, unshelve, type Shelved,
} from './lib/platform'
import { BUNDLE_EXTENSION, packBundle, unpackBundle } from './lib/bundle'
import { withDetectedType } from './lib/sniff'
import { deviceIsDark, setTheme, THEME_CHOICES, useThemeChoice, type ThemeChoice } from './lib/theme'
import { BACKUP_EXTENSION, packBackup, restoreBackup } from './lib/backup'
import { addReadingTime, addSpent, asTime } from './lib/reading'

// The panels float a little apart, each a sheet of its own.
const PANELS: DockviewTheme = { name: 'sidepage', className: 'dockview-theme-light', gap: 8, dndOverlayMounting: 'absolute', dndPanelOverlay: 'group' }
// Reading side by side: the books meet with a hairline between them.
const PANELS_READING: DockviewTheme = { ...PANELS, name: 'sidepage-reading', gap: 2 }

const isTauriApp = '__TAURI_INTERNALS__' in window

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
const THEME_ICONS = { auto: SunMoon, light: Sun, sepia: Coffee, dark: Moon, black: MoonStar } as const
const THEME_NAMES = { auto: 'Follow the device', light: 'Light', sepia: 'Sepia', dark: 'Dark', black: 'Black' } as const
// The theme button goes round the looks that differ; following the device is chosen in the More menu.
const CYCLE = ['light', 'sepia', 'dark', 'black'] as const
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
const CompareView = lazy(() => import('./notes/CompareView'))
const PapersView = lazy(() => import('./notes/PapersView'))
const AskView = lazy(() => import('./notes/AskView'))
const FilesView = lazy(() => import('./notes/FilesView'))
const FilesPanel = () => <ErrorBoundary FallbackComponent={Broken}><Suspense fallback={<Loading />}><FilesView /></Suspense></ErrorBoundary>
const AskPanel = () => <ErrorBoundary FallbackComponent={Broken}><Suspense fallback={<Loading />}><AskView /></Suspense></ErrorBoundary>
const PapersPanel = () => <ErrorBoundary FallbackComponent={Broken}><Suspense fallback={<Loading />}><PapersView /></Suspense></ErrorBoundary>
const ComparePanel = ({ params }: IDockviewPanelProps<{ older?: string; newer?: string }>) => <ErrorBoundary FallbackComponent={Broken}><Suspense fallback={<Loading />}><CompareView older={params.older} newer={params.newer} /></Suspense></ErrorBoundary>
const HighlightsPanel = () => <ErrorBoundary FallbackComponent={Broken}><Suspense fallback={<Loading />}><HighlightsView /></Suspense></ErrorBoundary>
const ReviewPanel = () => <ErrorBoundary FallbackComponent={Broken}><Suspense fallback={<Loading />}><ReviewView /></Suspense></ErrorBoundary>

// Books the reader set in a column of their own, beside the others: the automatic arrangement leaves them there.
const apart = new Set<string>()
// What the buttons at the end of each tab strip do; App fills these in.
const sides = { beside: (_group: string) => {}, openBeside: (_group: string) => {}, read: () => {} }

// At the end of each tab strip: put this book in its own column (or open another book beside it), and fill the
// window with this side alone, then show every side again.
function SideActions({ group, containerApi }: IDockviewHeaderActionsProps) {
  const [, redraw] = useState(0)
  useEffect(() => {
    const again = () => redraw(n => n + 1)
    const watching = [containerApi.onDidMaximizedGroupChange(again), containerApi.onDidLayoutChange(again), containerApi.onDidActivePanelChange(again)]
    return () => watching.forEach(watch => watch.dispose())
  }, [containerApi])
  const books = group.panels.filter(panel => panel.id.startsWith('doc:'))
  const filled = group.api.isMaximized()
  const wide = window.innerWidth >= 700
  return (
    <div className="side-actions">
      {wide && books.length > 0 && !filled && (
        <button
          title={books.length > 1 ? 'Put this book in its own column, beside the others' : 'Open another book beside this one'}
          aria-label={books.length > 1 ? 'Put this book beside' : 'Open a book beside'}
          onClick={() => (books.length > 1 ? sides.beside(group.id) : sides.openBeside(group.id))}
        ><Columns2 size={17} aria-hidden /></button>
      )}
      {wide && !filled && books.length > 0 && containerApi.groups.filter(other => other.panels.some(panel => panel.id.startsWith('doc:'))).length > 1 && (
        <button
          title="Read side by side: the books share the whole screen, with no notes and no bars (Esc to come back)"
          aria-label="Read side by side"
          onClick={() => sides.read()}
        ><BookOpen size={17} aria-hidden /></button>
      )}
      {(filled || containerApi.groups.length > 1) && (
        <button
          title={filled ? 'Show every side again' : 'Fill the window with this side (the full screen button then gives it the whole screen)'}
          aria-label={filled ? 'Show every side' : 'Fill the window with this side'}
          onClick={() => (filled ? containerApi.exitMaximizedGroup() : group.api.maximize())}
        >{filled ? <Minimize2 size={17} aria-hidden /> : <Maximize2 size={17} aria-hidden />}</button>
      )}
    </div>
  )
}

// Over the book, when the folder's list is out of sight: the file's place in its folder, and the files either side.
function FolderStepper() {
  const [where, setWhere] = useState<{ index: number; total: number; shown: boolean } | null>(null)
  useEffect(() => {
    const hear = (e: Event) => setWhere((e as CustomEvent<{ index: number; total: number; shown: boolean }>).detail)
    window.addEventListener('sidepage:folder-position', hear)
    return () => window.removeEventListener('sidepage:folder-position', hear)
  }, [])
  // Whether the list of files is really in sight (a panel behind another tab keeps its size): looked at often, it is cheap.
  const [listInSight, setListInSight] = useState(false)
  useEffect(() => {
    const look = () => {
      const list = document.querySelector<HTMLElement>('.note.files')
      const box = list?.getBoundingClientRect()
      setListInSight(!!list && !!box && box.width > 0 && list.contains(document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(box.height / 2, 120))))
    }
    look()
    const timer = setInterval(look, 700)
    return () => clearInterval(timer)
  }, [where])
  if (!where || listInSight || where.index < 0 || where.total < 2) return null
  const step = (by: number) => window.dispatchEvent(new CustomEvent('sidepage:folder-step', { detail: by }))
  return (
    <div className="folder-stepper" role="group" aria-label="Files in this folder">
      <button onClick={() => step(-1)} aria-label="The previous file" title="The previous file (Alt+↑)"><ChevronLeft size={18} aria-hidden /></button>
      <span>{`${where.index + 1} of ${where.total}`}</span>
      <button onClick={() => step(1)} aria-label="The next file" title="The next file (Alt+↓)"><ChevronRight size={18} aria-hidden /></button>
    </div>
  )
}

// A new version of Sidepage: looked for a minute after starting (and when asked), fetched in the background on a
// computer when updates may come by themselves, then offered as a small card. Nothing interrupts the reading.
function UpdateCard() {
  const [update, setUpdate] = useState<Update | null>(null)
  const [state, setState] = useState<'offered' | 'fetching' | 'ready' | 'failed' | 'hidden'>('hidden')
  const [share, setShare] = useState(0)
  const look = useCallback(async (asked: boolean) => {
    try {
      const found = await findUpdate()
      if (!found) { if (asked) window.dispatchEvent(new CustomEvent('sidepage:notice', { detail: 'Sidepage is up to date.' })); return }
      setUpdate(found)
      if (canUpdateInPlace && updatesByThemselves() && !asked) {
        setState('fetching')
        await found.install(setShare)
        setState('ready')
      } else setState('offered')
    } catch {
      if (asked) window.dispatchEvent(new CustomEvent('sidepage:notice', { detail: 'Sidepage could not look for updates. It needs the internet.' }))
    }
  }, [])
  useEffect(() => {
    const timer = setTimeout(() => void look(false), 60_000)
    const ask = () => void look(true)
    window.addEventListener('sidepage:check-updates', ask)
    return () => { clearTimeout(timer); window.removeEventListener('sidepage:check-updates', ask) }
  }, [look])
  if (!update || state === 'hidden') return null
  const fetchNow = async () => {
    if (!canUpdateInPlace) return void update.install(() => {}).then(() => setState('hidden'))
    setState('fetching')
    try { await update.install(setShare); setState('ready') } catch { setState('failed') }
  }
  return (
    <div className="update-card" role="status">
      <Sparkles size={18} aria-hidden />
      <div className="update-text">
        <b>{state === 'ready' ? `Sidepage ${update.version} is ready` : `Sidepage ${update.version} is out`}</b>
        <span>{state === 'fetching' ? `Fetching it… ${Math.round(share * 100)}%` : state === 'ready' ? 'Start again to use it. Your notes are saved.' : state === 'failed' ? 'The download broke off. Try again later.' : canUpdateInPlace ? 'Fetch it now; it is used when Sidepage starts again.' : 'Download it; it installs over this one and keeps your notes.'}</span>
      </div>
      {state === 'ready' && <button className="primary" onClick={() => { void finishSaving().then(() => restart()) }}>Restart now</button>}
      {state === 'offered' && <button className="primary" onClick={() => void fetchNow()}>{canUpdateInPlace ? 'Update' : 'Download'}</button>}
      {state !== 'fetching' && <button className="soft" onClick={() => setState('hidden')}>Not now</button>}
    </div>
  )
}

const components = { doc: DocPanel, note: NotePanel, graph: GraphPanel, review: ReviewPanel, highlights: HighlightsPanel, guide: GuidePanel, compare: ComparePanel, papers: PapersPanel, ai: AskPanel, files: FilesPanel }

export default function App() {
  const api = useRef<DockviewApi | null>(null)
  const [notebook, setNotebook] = useState('My notebook')
  const [paper, setPaper] = useState<Paper>(() => (localStorage.getItem('sidepage:paper') as Paper) || 'lined')
  const [empty, setEmpty] = useState(true)
  const theme = useThemeChoice()
  // A short message after something has been done out of sight (a backup made, notes restored).
  const [notice, setNotice] = useState('')
  // Messages from out of the way (a voice being fetched): the latest one shown, an empty one clears it.
  useEffect(() => {
    const show = (e: Event) => setNotice((e as CustomEvent<string>).detail)
    window.addEventListener('sidepage:notice', show)
    return () => window.removeEventListener('sidepage:notice', show)
  }, [])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(timer)
  }, [notice])
  const [palette, setPalette] = useState(false)
  // Reading a web page: an address asked for, the article taken from it and opened like a book.
  const [asking, setAsking] = useState<null | { address: string; busy: boolean; problem: string }>(null)
  // Reading plans and the coming flashcard reviews, as a calendar file for any calendar app.
  const toCalendar = async () => {
    const { calendarFile } = await import('./lib/calendar')
    const { text, count } = await calendarFile()
    if (!count) return setNotice('Nothing to put in a calendar yet: set a plan for a book, or make some flashcards.')
    await saveFileAs('Sidepage reading.ics', new TextEncoder().encode(text))
    setNotice('Calendar saved. Open it (or import it in Google Calendar, Outlook or Apple Calendar) to get the reminders.')
  }
  const readWebPage = async (address: string) => {
    setAsking({ address, busy: true, problem: '' })
    try {
      const { articleFrom } = await import('./lib/webpage')
      const article = await articleFrom(address)
      setAsking(null)
      void openFile(article)
    } catch (error) {
      setAsking({ address, busy: false, problem: isTauriApp ? String((error as Error)?.message ?? error) : 'In the browser version, most sites do not let other pages read them. The installed app can.' })
    }
  }
  const [sitting, setSitting] = useState<Sitting | null>(null)
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
  // Reading two books side by side, full screen (see readSideBySide).
  const [reading, setReading] = useState(false)
  const [autoUpdate, setAutoUpdate] = usePref('auto-update', true)
  useEffect(() => { if (!focus) setReading(false) }, [focus])
  // The books refit themselves once the room has settled, on the way in and on the way out.
  useEffect(() => {
    const timers = [150, 600, 1300].map(delay => setTimeout(() => window.dispatchEvent(new Event('sidepage:reading')), delay))
    return () => timers.forEach(clearTimeout)
  }, [reading])
  useScreenOn(awake && !empty)
  // Notes save themselves a moment after you stop writing. Closing the app, or putting it in the background, saves
  // at once whatever is still waiting, so nothing typed is lost and there is nothing to be asked about.
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') saveWaiting() }
    window.addEventListener('pagehide', saveWaiting)
    window.addEventListener('beforeunload', saveWaiting)
    document.addEventListener('visibilitychange', hidden)
    let stop: (() => void) | undefined
    if ('__TAURI_INTERNALS__' in window) {
      void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
        const win = getCurrentWindow()
        stop = await win.onCloseRequested(async event => {
          event.preventDefault()
          await finishSaving()
          await win.destroy()
        })
      }).catch(() => {})
    }
    return () => {
      window.removeEventListener('pagehide', saveWaiting)
      window.removeEventListener('beforeunload', saveWaiting)
      document.removeEventListener('visibilitychange', hidden)
      stop?.()
    }
  }, [])
  // Focus also takes the whole screen, where the device lets an app do that.
  // Entering or leaving Focus changes the room the panels have: they are laid out again once the bars are gone
  // (or back) and the screen has settled, so the notes sit beside the book and never over it.
  useEffect(() => {
    const relayout = () => {
      const room = document.querySelector<HTMLElement>('.workspace')
      if (room && api.current) api.current.layout(room.clientWidth, room.clientHeight, true)
    }
    const timers = [50, 300, 900].map(delay => setTimeout(relayout, delay))
    document.addEventListener('fullscreenchange', relayout)
    return () => { timers.forEach(clearTimeout); document.removeEventListener('fullscreenchange', relayout) }
  }, [focus])
  useEffect(() => {
    if (focus || !hiddenForReading.current.length) return
    for (const id of hiddenForReading.current) api.current?.groups.find(group => group.id === id)?.api.setVisible(true)
    hiddenForReading.current = []
    shareNow.current()
  }, [focus])
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
    // The folders panel keeps its own column, to the left.
    const notes = dock.panels.filter(p => !p.id.startsWith('doc:') && p.id !== 'files')
    if (!books.length || !notes.length) return
    const shown = [dock.activePanel, ...dock.groups.map(group => group.activePanel)]
    const home = books[0].group
    for (const book of books.slice(1)) if (book.group !== home && !apart.has(book.id)) book.api.moveTo({ group: home, position: 'center' })
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

  // The group a book about to be opened goes beside (set by the side-by-side button, used once).
  const besideNext = useRef('')
  const shareNow = useRef<() => void>(() => {})
  const readNow = useRef<() => void>(() => {})
  // Note columns put out of sight while reading side by side.
  const hiddenForReading = useRef<string[]>([])
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
    // Asked for beside a book: a column of its own to the right of that book.
    const besideGroup = besideNext.current ? dock.groups.find(group => group.id === besideNext.current) : undefined
    besideNext.current = ''
    if (besideGroup) apart.add(id)
    dock.addPanel({
      id,
      component: 'doc',
      title: file.name,
      params: { file },
      position: besideGroup
        ? { referenceGroup: besideGroup, direction: 'right' }
        : sibling
        ? { referencePanel: sibling.id, direction: 'within' }
        : note ? { referencePanel: note.id, direction: besideNotes() }
        : dock.getPanel('files') && window.innerWidth >= 700 ? { referencePanel: 'files', direction: 'right' } : undefined,
    })
    openNote('written', book)
    dock.getPanel(id)?.api.setActive()
    // The folder's files stay a narrow column beside the book.
    const files = dock.getPanel('files')
    if (files && window.innerWidth >= 700 && files.group.width > 360) setTimeout(() => {
      const narrow = Math.min(340, Math.max(260, Math.round(window.innerWidth * 0.2)))
      files.group.api.setSize({ width: narrow })
      // What is left goes mostly to the book.
      const room = (document.querySelector<HTMLElement>('.workspace')?.clientWidth ?? window.innerWidth) - narrow
      if (besideBook() === 'right') dock.getPanel(id)?.group.api.setSize({ width: Math.round(room * 0.56) })
    }, 50)
    if (besideGroup) shareNow.current()
  }, [openNote])

  // A .sidepage file is unpacked into its book and notes first; every opened book goes on the shelf.
  const openFile = useCallback(async (given: File) => {
    // A book is known by its file name alone. Earlier versions on Windows kept the whole path as the name; such a
    // book is opened under its own name and its old entry in the library is taken away.
    const pathed = /[\\/]/.test(given.name) ? given.name : ''
    const picked = pathed ? new File([given], pathed.replace(/^.*[\\/]/, ''), { type: given.type }) : given
    if (pathed) {
      void unshelve(pathed)
      await moveNotebook(pathed.replace(/\.[^.]+$/, ''), baseName(picked.name))
    }
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

  // Two books compared word by word. With two books side by side, those two: the left one as the earlier.
  const openCompare = useCallback(() => {
    const dock = api.current
    if (!dock) return
    dock.getPanel('compare')?.api.close()
    const columns = dock.groups.map(group => group.activePanel).filter(panel => panel?.id.startsWith('doc:'))
    const [older, newer] = columns.length >= 2 ? [columns[0]!.id.slice(4), columns[1]!.id.slice(4)] : [undefined, undefined]
    const sibling = dock.panels.find(p => !p.id.startsWith('doc:') && p.id !== 'files')
    dock.addPanel({ id: 'compare', component: 'compare', title: 'Compare', params: { older, newer }, position: sibling ? { referencePanel: sibling.id, direction: 'within' } : undefined })
  }, [])
  // A folder's files, to the left of the book (or in the same tab strip on a phone).
  const openFiles = useCallback((folderId?: string) => {
    const dock = api.current
    if (!dock) return
    if (folderId) setPref('folder-current', folderId)
    const existing = dock.getPanel('files')
    if (existing) return existing.api.setActive()
    const book = dock.panels.find(p => p.id.startsWith('doc:'))
    const narrow = window.innerWidth < 700
    dock.addPanel({
      id: 'files', component: 'files', title: 'Files',
      position: book ? { referenceGroup: book.group, direction: narrow ? 'within' : 'left' } : undefined,
      initialWidth: narrow ? undefined : Math.min(340, Math.max(260, Math.round(window.innerWidth * 0.2))),
    })
  }, [])
  // Ask AI: the reader's own AI subscription, beside the book, in place of the notes.
  const openAsk = useCallback(() => {
    const dock = api.current
    if (!dock) return
    const existing = dock.getPanel('ai')
    if (existing) return existing.api.setActive()
    const sibling = dock.panels.find(p => !p.id.startsWith('doc:') && p.id !== 'files')
    const book = dock.panels.find(p => p.id.startsWith('doc:'))
    dock.addPanel({ id: 'ai', component: 'ai', title: 'Ask AI', position: sibling ? { referencePanel: sibling.id, direction: 'within' } : book ? { referencePanel: book.id, direction: besideBook() } : undefined })
  }, [])
  // The paper explorer (OpenAlex), beside the notes.
  const openPapers = useCallback(() => {
    const dock = api.current
    if (!dock) return
    const existing = dock.getPanel('papers')
    if (existing) return existing.api.setActive()
    const sibling = dock.panels.find(p => !p.id.startsWith('doc:') && p.id !== 'files')
    const book = dock.panels.find(p => p.id.startsWith('doc:'))
    dock.addPanel({ id: 'papers', component: 'papers', title: 'Papers', position: sibling ? { referencePanel: sibling.id, direction: 'within' } : book ? { referencePanel: book.id, direction: besideBook() } : undefined })
  }, [])
  const openHighlights = useCallback(() => {
    const dock = api.current
    if (!dock) return
    // Closed and opened again, so it always shows what has been highlighted since.
    dock.getPanel('highlights')?.api.close()
    const sibling = dock.panels.find(p => !p.id.startsWith('doc:') && p.id !== 'files')
    dock.addPanel({ id: 'highlights', component: 'highlights', title: 'Highlights', position: sibling ? { referencePanel: sibling.id, direction: 'within' } : undefined })
  }, [])

  const openGuide = useCallback(() => {
    const dock = api.current
    if (!dock) return
    const existing = dock.getPanel('guide')
    if (existing) return existing.api.setActive()
    const sibling = dock.panels.find(p => !p.id.startsWith('doc:') && p.id !== 'files')
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
    const sibling = dock.panels.find(p => !p.id.startsWith('doc:') && p.id !== 'files')
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
      else if (key === 'd' && e.shiftKey) act(() => setTheme(next(CYCLE, theme === 'auto' ? (deviceIsDark() ? 'dark' : 'light') : theme)))
      else if (key === '.' && !e.shiftKey) act(() => setFocus(on => !on && !empty))
      else if (key === 'k' && !e.shiftKey) act(() => setPalette(on => !on))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openNote, notebook, theme, empty])

  // A highlight clicked in the book brings its notebook forward.
  useEffect(() => onFindInNotes(() => api.current?.getPanel(`note:written:${notebook}`)?.api.setActive()), [notebook])

  // A study pack for the book in front: everything kept about it as one document to print or keep.
  const makeStudyPack = useCallback(async () => {
    const dock = api.current
    const file = (dock?.activePanel?.params as { file?: File } | undefined)?.file
      ?? dock?.panels.map(p => (p.params as { file?: File } | undefined)?.file).find(f => f && baseName(f.name) === notebook)
    if (!file) return setNotice('Open the book first: the study pack is made for the book in front.')
    setNotice('Making the study pack…')
    const { studyPack } = await import('./lib/studypack')
    const html = await studyPack(file.name)
    await saveFileAs(`${baseName(file.name)} study pack.html`, new TextEncoder().encode(html))
    setNotice('Study pack saved. Open it in a browser to read it, or print it (or print to PDF).')
  }, [notebook])

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
  // Two books side by side, each in a tall column with its own bars.
  sides.openBeside = groupId => { besideNext.current = groupId; void browse().finally(() => { setTimeout(() => { besideNext.current = '' }, 2000) }) }
  sides.beside = groupId => {
    const group = api.current?.groups.find(found => found.id === groupId)
    const book = group?.activePanel
    if (!group || !book?.id.startsWith('doc:')) return
    apart.add(book.id)
    book.api.moveTo({ group, position: 'right' })
    shareWidth()
  }
  // With books side by side the books take most of the width, shared equally; the notes keep a narrower column.
  const shareWidth = (delay = 60) => setTimeout(() => {
    const dock = api.current
    if (!dock) return
    const room = document.querySelector<HTMLElement>('.workspace')?.clientWidth ?? window.innerWidth
    const bookGroups = dock.groups.filter(group => group.panels.some(panel => panel.id.startsWith('doc:')))
    const noteGroups = dock.groups.filter(group => !bookGroups.includes(group) && group.api.isVisible && !group.panels.some(panel => panel.id === 'files'))
    const filesWidth = dock.groups.filter(group => group.api.isVisible && group.panels.some(panel => panel.id === 'files')).reduce((sum, group) => sum + group.width, 0)
    if (bookGroups.length < 2 || (noteGroups.length && besideBook() !== 'right')) return
    const notes = noteGroups.length ? Math.max(340, Math.round(room * 0.26)) : 0
    for (const group of noteGroups) group.api.setSize({ width: notes })
    for (const group of bookGroups) group.api.setSize({ width: Math.floor((room - notes - filesWidth) / bookGroups.length) })
  }, delay)
  shareNow.current = shareWidth

  // Reading two books side by side and nothing else: the notes are put out of sight (not closed), the books share
  // the screen equally, and the screen is taken whole with every bar hidden. Leaving it brings the notes back.
  const readSideBySide = () => {
    const dock = api.current
    if (!dock) return
    if (dock.hasMaximizedGroup()) dock.exitMaximizedGroup()
    const withBooks = () => dock.groups.filter(group => group.panels.some(panel => panel.id.startsWith('doc:')))
    // Two books in one tab strip are first set in columns of their own.
    if (withBooks().length < 2) {
      const crowded = withBooks().find(group => group.panels.filter(panel => panel.id.startsWith('doc:')).length > 1)
      if (!crowded) return setNotice('Open a second book first (the columns button at the end of the tab strip opens one beside).')
      sides.beside(crowded.id)
    }
    for (const group of dock.groups) {
      if (withBooks().includes(group) || !group.api.isVisible) continue
      group.api.setVisible(false)
      hiddenForReading.current.push(group.id)
    }
    // Each book is told which side it is on, so its pages can sit against the middle.
    const columns = withBooks().sort((a, b) => a.element.getBoundingClientRect().left - b.element.getBoundingClientRect().left)
    columns.forEach((group, i) => {
      const side = i === 0 ? 'left' : i === columns.length - 1 ? 'right' : 'middle'
      for (const panel of group.panels) panel.view.content.element.querySelector<HTMLElement>('.viewer')?.setAttribute('data-side', side)
    })
    setReading(true)
    setFocus(true)
    for (const delay of [100, 500, 1200]) shareWidth(delay)
  }
  readNow.current = readSideBySide
  sides.read = readSideBySide

  // Dev helper: open a file by URL from the console, e.g. __open('/samples/sample.pdf').
  useEffect(() => {
    if (!import.meta.env.DEV) return
    Object.assign(window, {
      __open: async (url: string) => openFile(new File([await (await fetch(url)).blob()], url.split('/').pop()!)),
    })
  }, [openFile])

  const goHome = () => { for (const panel of [...(api.current?.panels ?? [])]) panel.api.close() }
  useEffect(() => onOpenFileNow(file => void openFile(file)), [openFile])
  useEffect(() => {
    let stop = () => {}
    void onOpenedFiles(file => void openFile(file)).then(off => { stop = off })
    return () => stop()
  }, [openFile])
  const openFromShelf = (name: string) => void fromShelf(name).then(file => { if (file) void openFile(file) })

  // Everything the palette can do. Built when it opens, so the list of books is the current one.
  const commands = (): Command[] => [
    { group: 'Go to', name: 'Open a book or document…', hint: 'Ctrl+O', icon: FolderOpen, run: () => void browse() },
    { group: 'Go to', name: 'Home: your library', icon: HomeIcon, run: goHome },
    { group: 'Go to', name: 'Read a web page…', icon: Globe, run: () => setAsking({ address: '', busy: false, problem: '' }) },
    { group: 'Go to', name: 'Open a book beside this one…', icon: Columns2, run: () => { const book = api.current?.panels.find(p => p.id.startsWith('doc:') && p.api.isActive) ?? api.current?.panels.find(p => p.id.startsWith('doc:')); if (book) sides.openBeside(book.group.id); else void browse() } },
    { group: 'Go to', name: 'Read side by side, full screen', icon: BookOpen, run: () => readNow.current() },
    { group: 'Go to', name: 'Your folders', icon: Folders, run: () => openFiles() },
    { group: 'Go to', name: 'Next file in the folder', hint: 'Alt+↓', icon: Folders, run: () => { openFiles(); setTimeout(() => window.dispatchEvent(new CustomEvent('sidepage:folder-step', { detail: 1 })), 400) } },
    { group: 'Go to', name: 'Previous file in the folder', hint: 'Alt+↑', icon: Folders, run: () => { openFiles(); setTimeout(() => window.dispatchEvent(new CustomEvent('sidepage:folder-step', { detail: -1 })), 400) } },
    { group: 'Go to', name: 'Help: how to do anything in Sidepage', icon: CircleHelp, run: () => void openOutside('https://clleb.github.io/sidepage/docs/') },
    { group: 'Go to', name: 'Quick notes', icon: NotebookText, run: () => openNote('written', 'Quick notes') },
    { group: 'Write', name: 'Notes for this book', hint: 'Ctrl+1', icon: NotebookPen, run: () => openNote('written', notebook) },
    { group: 'Write', name: 'Canvas: draw and handwrite', hint: 'Ctrl+2', icon: PenLine, run: () => openNote('canvas', notebook) },
    { group: 'Write', name: 'Mind map', hint: 'Ctrl+3', icon: Workflow, run: () => openNote('mindmap', notebook) },
    { group: 'Study', name: 'Study guide for this page', icon: Sparkles, run: openGuide },
    { group: 'Study', name: 'Ask your books a question', icon: Sparkles, run: () => { openGuide(); setTimeout(() => document.querySelector<HTMLInputElement>('.ask input')?.focus(), 600) } },
    { group: 'Study', name: 'Review flashcards', icon: GraduationCap, run: openReview },
    ...(canRunTools ? [{ group: 'Study', name: 'Ask AI about this book', icon: MessageCircleQuestion, run: openAsk }] : []),
    { group: 'Study', name: 'Explore papers: what it cites, what cites it', icon: Network, run: openPapers },
    { group: 'Study', name: 'Compare two books, word by word', icon: ArrowLeftRight, run: openCompare },
    { group: 'Study', name: 'All highlights', icon: Highlighter, run: openHighlights },
    { group: 'Study', name: 'Graph of linked notes', icon: Share2, run: openGraph },
    { group: 'View', name: 'Focus: hide the toolbars', hint: 'Ctrl+.', icon: Maximize2, run: () => setFocus(!empty) },
    { group: 'View', name: ruler ? 'Put the reading ruler away' : 'Reading ruler', icon: Ruler, run: () => setRuler(!ruler) },
    ...(Object.keys(LAYOUTS) as Layout[]).map(key => ({ group: 'View', name: `Layout: ${LAYOUTS[key]}`, icon: LAYOUT_ICONS[key], run: () => setLayout(key) })),
    ...THEME_CHOICES.map(choice => ({ group: 'View', name: `Theme: ${THEME_NAMES[choice]}`, icon: THEME_ICONS[choice], run: () => setTheme(choice) })),
    ...PAPERS.map(kind => ({ group: 'View', name: `Paper: ${kind}`, icon: NotebookPen, run: () => setPaper(kind) })),
    { group: 'Keep', name: 'Save the book and its notes as one file', icon: Package, run: () => void saveWhole() },
    { group: 'Keep', name: 'Export this book\'s notes', icon: FileDown, run: () => void exportNotes() },
    { group: 'Study', name: 'Make a study pack for this book', icon: BookMarked, run: () => void makeStudyPack() },
    { group: 'Keep', name: 'Cite this book…', icon: FileDown, run: () => { const here = placeNow(); if (here) openCite({ book: here.book, place: here.place }) } },
    { group: 'Keep', name: 'Save a bibliography of every book (BibTeX)', icon: FileDown, run: () => void bibliography('BibTeX').then(text => saveFileAs('Sidepage library.bib', new TextEncoder().encode(text + '\n'))) },
    { group: 'Keep', name: 'Save a reading list of every book (APA)', icon: FileDown, run: () => void bibliography('APA').then(text => saveFileAs('Reading list.md', new TextEncoder().encode('# Reading list\n\n' + text.split('\n\n').map(line => `- ${line}`).join('\n') + '\n'))) },
    { group: 'Keep', name: 'Put reading plans and reviews in your calendar (.ics)', icon: CalendarPlus, run: () => void toCalendar() },
    ...books.map(book => ({ group: 'Your books', name: baseName(book.name), icon: BookOpenText, run: () => openFromShelf(book.name) })),
  ]

  const onReady = (event: DockviewReadyEvent) => {
    api.current = event.api
    const sync = () => setEmpty(event.api.panels.length === 0)
    event.api.onDidAddPanel(panel => {
      sync()
      if (panel.id.startsWith('doc:')) beginSitting(panel.id.slice(4))
    })
    event.api.onDidRemovePanel(panel => {
      sync()
      // A book closed: what that sitting with it came to.
      apart.delete(panel.id)
      if (!panel.id.startsWith('doc:')) shareNow.current()
      if (panel.id.startsWith('doc:')) void endSitting(panel.id.slice(4)).then(found => { if (found) setSitting(found) })
    })
    event.api.onDidActivePanelChange(() => {
      // A reader brought to the front tells the guide and the notes where it is.
      event.api.activePanel?.view.content.element.querySelector('.viewer')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      const book = (event.api.activePanel?.params as { notebook?: string; file?: File } | undefined)
      // Readers without pages (a picture, a text file) still say which book is in front.
      const front = event.api.activePanel?.id.startsWith('doc:') ? event.api.activePanel.id.slice(4) : ''
      if (front && placeNow()?.book !== front) tellPlace({ book: front, place: '' })
      if (book?.notebook) setNotebook(book.notebook)
      else if (book?.file) setNotebook(baseName(book.file.name))
    })
  }

  return (
    <div
      className={`app${focus ? ' focus' : ''}${reading ? ' reading' : ''}`}
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
        <Tool icon={Folders} label="Files" hint="Your folders: open any file, and move to the next or previous one (Alt+↓, Alt+↑)" onClick={() => openFiles()} />
        <div className="segment" role="group" aria-label="Beside the book">
          <span className="split">
            <Tool icon={NotebookPen} label="Notes" hint="Written notes (Ctrl+1)" onClick={() => openNote('written', notebook)} />
            <Menu quiet icon={ChevronDown} label="Other ways of writing" hint="Canvas and mind map">
              <Tool icon={NotebookPen} label="Written notes" hint="Ctrl+1" onClick={() => openNote('written', notebook)} />
              <Tool icon={PenLine} label="Canvas" hint="Draw and handwrite (Ctrl+2)" onClick={() => openNote('canvas', notebook)} />
              <Tool icon={Workflow} label="Mind map" hint="Mind map (Ctrl+3)" onClick={() => openNote('mindmap', notebook)} />
            </Menu>
          </span>
          {/* Ask AI runs the AI's own app for computers: where it cannot (phones, tablets, the browser), it is not offered. */}
          {canRunTools && <Tool icon={MessageCircleQuestion} label="Ask AI" hint="Ask your own AI (Claude, ChatGPT or Gemini, with your subscription) about the book" onClick={openAsk} />}
          <Menu icon={Sparkles} label="Study" hint="Guide, highlights, flashcards, papers and more">
            <Tool icon={Sparkles} label="Guide" hint="The gist of this page, the book's key terms, a quiz, and kindred places in your other books" onClick={openGuide} />
            <Tool icon={GraduationCap} label="Review flashcards" hint="Go through the flashcards made from your highlights and notes" onClick={openReview} />
            <Tool icon={Highlighter} label="All highlights" hint="Every highlight from every book" onClick={openHighlights} />
            <Tool icon={Network} label="Papers" hint="What this paper cites, what cites it, and related work, with free PDFs to open (OpenAlex)" onClick={openPapers} />
            <Tool icon={ArrowLeftRight} label="Compare two books" hint="What changed between two versions, word by word" onClick={openCompare} />
            <Tool icon={Share2} label="Graph of your notes" hint="How your books' notes link to each other" onClick={openGraph} />
            <Tool icon={Timer} label="Study timer" hint="Study for a stretch, then take a break" onClick={() => setTimeout(() => window.dispatchEvent(new Event('sidepage:timer')), 0)} />
          </Menu>
        </div>
        <span className="spacer" />
        <button className="jump" title="Go to anything (Ctrl+K)" onClick={() => setPalette(true)}><CommandIcon size={15} aria-hidden /><span>Go to…</span><kbd>Ctrl K</kbd></button>
        <NotesSearch />
        <StudyTimer onNotice={setNotice} />
        <Tool quiet icon={Maximize2} label="Focus" hint="Hide everything but the page and your notes (Ctrl+.)" disabled={empty} onClick={() => setFocus(true)} />
        <Tool quiet icon={Ellipsis} label="More" on={more} onClick={() => setMore(!more)} />
        {more && <>
          <div className="menu-backdrop" onClick={() => setMore(false)} />
          <div className="menu settings" onClick={e => { if ((e.target as HTMLElement).closest('button:not(.stay)')) setMore(false) }}>
            {updatesHere && <Tool icon={RefreshCw} label="Check for updates" hint="See whether a newer Sidepage is out" onClick={() => window.dispatchEvent(new Event('sidepage:check-updates'))} />}
            {canUpdateInPlace && <label className="menu-row stay">Update by itself
              <input type="checkbox" checked={autoUpdate} onChange={e => setAutoUpdate(e.target.checked)} />
            </label>}
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
            <Tool icon={BookMarked} label="Make a study pack" hint="Notes, highlights, glossary and questions for this book, as one document to print" disabled={empty} onClick={() => void makeStudyPack()} />
            <Tool icon={FileDown} label="Export notes" hint="Save this book's notes, highlights and bookmarks as one Markdown file" disabled={empty} onClick={() => void exportNotes()} />
            {canPickNotesFolder && (
              <Tool
                icon={FolderCog}
                label={!folder.name ? 'Choose notes folder' : folder.locked ? `Reconnect notes folder: ${folder.name}` : `Notes folder: ${folder.name}`}
                hint="Where your notes are saved as files"
                onClick={() => void chooseNotesFolder()}
              />
            )}
            <label className="menu-row">Language
              <select value={uiLanguage()} onChange={e => { setLanguage(e.target.value as Language); setMore(false) }}>
                {(Object.keys(LANGUAGES) as Language[]).map(code => <option key={code} value={code}>{LANGUAGES[code]}</option>)}
              </select>
            </label>
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
                {THEME_CHOICES.map(t => <option key={t} value={t}>{t === 'auto' ? `Follow the device (${deviceIsDark() ? 'dark' : 'light'} now)` : THEME_NAMES[t]}</option>)}
              </select>
            </label>
            <div className="menu-foot">
              <span>Sidepage {__APP_VERSION__}</span>
              <button className="menu-link" onClick={() => void openOutside('https://clleb.github.io/sidepage/docs/')}><CircleHelp size={15} aria-hidden /> Help and how to</button>
            </div>
          </div>
        </>}
      </header>
      {focus && <FocusClock />}
      {focus && <button className="focus-exit" title="Show the toolbars again" aria-label="Leave focus" onClick={() => setFocus(false)}><Minimize2 size={18} aria-hidden /></button>}
      <Comfort />
      <Soundscape />
      {sitting && <SittingCard sitting={sitting} onClose={() => setSitting(null)} />}
      <LookUp />
      <Translator />
      <CiteDialog />
      {asking && (
        <div className="palette-shade" onClick={() => setAsking(null)}>
          <form className="palette lookup" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); if (asking.address.trim()) void readWebPage(asking.address) }}>
            <h2><Globe size={20} aria-hidden /> Read a web page</h2>
            <p className="menu-note">Paste the address of an article. Only the article is kept (no menus or adverts), and it opens like a book, with your notes beside it.</p>
            <input className="menu-input" autoFocus value={asking.address} placeholder="https://…" onChange={e => setAsking({ ...asking, address: e.target.value, problem: '' })} />
            {asking.problem && <p className="menu-note">{asking.problem}</p>}
            <div className="lookup-actions">
              <button type="button" className="soft" onClick={() => setAsking(null)}>Cancel</button>
              <button className="primary" disabled={asking.busy || !asking.address.trim()}>{asking.busy ? 'Fetching the article…' : 'Read it'}</button>
            </div>
          </form>
        </div>
      )}
      <FolderStepper />
      <UpdateCard />
      {palette && <Palette commands={commands()} onClose={() => setPalette(false)} />}
      {notice && <div className="notice" role="status" onClick={() => setNotice('')}>{notice}</div>}
      <main className="workspace">
        <DockviewReact components={components} onReady={onReady} theme={reading ? PANELS_READING : PANELS} defaultRenderer="always" rightHeaderActionsComponent={SideActions} />
        {empty && (
          <Home
            books={books} covers={covers} favourites={favourites} goal={goal}
            onOpen={openFromShelf} onBrowse={() => void browse()} onFavourite={toggleFavourite}
            onRemove={name => void unshelve(name).then(shelf).then(setBooks)}
            onQuickNotes={() => openNote('written', 'Quick notes')}
            onWebPage={() => setAsking({ address: '', busy: false, problem: '' })}
            onFolder={id => openFiles(id)}
          />
        )}
      </main>
    </div>
  )
}
