import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFViewer, ToolbarItem, type Layout, type Viewer, type CommandDefinition } from '@embedpdf/viewer-react'
import { BookOpen, ChevronsDown, Ellipsis, Gauge, ListTree, Pause, Play, Pointer, ScanText, Square, TextQuote, Volume2, WrapText, Crop, Table2, SquareDashed } from 'lucide-react'
import FlipBook from './FlipBook'
import Reflow from './Reflow'
import PageMap from './PageMap'
import LectureChip from './LectureChip'
import { usePeek } from './Peek'
import { PacerBar, usePacer, type PacerHost } from './Pacer'
import { PictureCardMaker, addPictureCards } from '../notes/PictureCards'
import { KNOWN, QuestionsMenu, RecapCard, StudySheet, usePageMarks, type Sheet } from './PageStudy'
import { SelectionSheet, type Selected } from './SelectionTools'
import { BookmarksMenu, HIGHLIGHT_COLOURS, HighlightsMenu } from './ReaderMenus'
import { openReader, readText } from '../lib/ocr'
import { readableText } from '../lib/insight'
import { planToday, loadHighlights, saveHighlights, setProgress, useBookmarks, saveCover, type Highlight } from '../lib/reading'
import { keepFacts, openCite } from './Cite'
import { hardnessOf, markKnown, noteVisit } from '../lib/pages'
import { asMarkdownTable, headingsOf, layoutOf, tableIn } from '../lib/paper'
import { canSpeak, useReadAloud } from '../lib/speech'
import { hasWords, keepWords, lettersKept, type Stretch } from '../lib/library'
import { pageFilter, useTheme } from '../lib/theme'
import { usePref } from '../lib/prefs'
import { uiLanguage } from '../lib/language'
import { lookUp, translate } from '../Extras'
import { Menu, Tool } from '../ui'
import { picturesOf, stripsOf, wordsOf, wordsOfSentence, type Box, type Word } from '../lib/pdfWords'
import { askAi, baseName, debounce, loadNoteFile, onGoToPlace, placeNow, prefersFlip, rememberFlip, saveNoteFile, sendClip, sendQuote, tellContents, tellPlace, type ContentsItem } from '../lib/platform'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

// The PDF reader: EmbedPDF's complete viewer, as it comes (its scrolling, zoom, touch, search, thumbnails, outline,
// highlights, drawing, pages and snapshots). Sidepage only adds what is its own: the notes beside the book (quotes,
// clips, tables, picture cards, questions), study marks, the pacer, read aloud, Peek, page flip, flowing text, dark
// and sepia pages, and keeping the place. Those that need the page's words or pictures read them from the file
// with PDF.js (lib/pdfWords.ts) and lay their marks over the viewer where EmbedPDF says the page stands.
const FLIP_CHUNK = 80

const ICONS = {
  quote: ['M17 5H3', 'M21 12H8', 'M21 19H8', 'M3 12v7'],
  translate: ['m5 8 6 6', 'm4 14 6-6 2-3', 'M2 5h12', 'M7 2h1', 'm22 22-5-10-5 10', 'M14 18h6'],
  table: ['M12 3v18', 'M3 3h18v18H3z', 'M3 9h18', 'M3 15h18'],
}

type Actions = {
  quote(): void; lookUp(): void; translate(): void; ask(): void; more(kind: string): void
  clip(kind: 'picture' | 'words' | 'table' | 'cards'): void
}

const commandsFor = (act: { current: Actions }): CommandDefinition[] => [
  { id: 'sidepage:quote', label: 'Quote', icon: 'quote', run: () => act.current.quote() },
  { id: 'sidepage:look-up', label: 'Look up', icon: 'book', run: () => act.current.lookUp() },
  { id: 'sidepage:translate', label: 'Translate', icon: 'translate', run: () => act.current.translate() },
  { id: 'sidepage:ask', label: 'Ask AI', icon: 'message', run: () => act.current.ask() },
  { id: 'sidepage:text-more', label: 'More', icon: 'dots', menu: 'sidepage-text' },
  { id: 'sidepage:explained', label: 'Where is this explained?', run: () => act.current.more('explained') },
  { id: 'sidepage:uses', label: 'Every use in this book', run: () => act.current.more('uses') },
  { id: 'sidepage:question', label: 'A question about this', run: () => act.current.more('question') },
  { id: 'sidepage:cloze', label: 'Gap cards from this passage', run: () => act.current.more('cloze') },
  { id: 'sidepage:plot', label: 'Plot this formula', run: () => act.current.more('plot') },
  { id: 'sidepage:units', label: 'Convert units', run: () => act.current.more('units') },
  { id: 'sidepage:cite', label: 'Cite this passage', run: () => act.current.more('cite') },
  { id: 'sidepage:clip', label: 'Into my notes', icon: 'send', run: () => act.current.clip('picture') },
  { id: 'sidepage:clip-words', label: 'Its words into my notes', icon: 'text', run: () => act.current.clip('words') },
  { id: 'sidepage:clip-table', label: 'Table into my notes', icon: 'table', run: () => act.current.clip('table') },
  { id: 'sidepage:clip-cards', label: 'Picture cards', icon: 'squares', run: () => act.current.clip('cards') },
] as CommandDefinition[]

const layoutOfViewer = (layout: Layout) => {
  layout.add({ custom: 'sidepage-start' }, { to: 'main', section: 'start' }).add({ custom: 'sidepage' }, { to: 'main', section: 'end' })
  for (const id of ['sidepage:quote', 'sidepage:look-up', 'sidepage:translate', 'sidepage:ask', 'sidepage:text-more']) layout.add(id, { to: 'selection' })
  layout.addMenu('sidepage-text', [['sidepage:explained', 'sidepage:uses', 'sidepage:question'], ['sidepage:cloze', 'sidepage:plot', 'sidepage:units', 'sidepage:cite']])
  for (const id of ['sidepage:clip', 'sidepage:clip-words', 'sidepage:clip-table', 'sidepage:clip-cards']) layout.add(id, { to: 'snapshot' })
  return layout
}

// The viewer's colours, from Sidepage's own theme variables.
function themeOf(theme: string) {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  const tokens = { accent: v('--accent', '#4b5563'), background: v('--bg', '#f3f4f6'), surface: v('--panel', '#ffffff'), 'surface-raised': v('--panel', '#ffffff'), text: v('--text', '#111827'), 'text-muted': v('--muted', '#6b7280'), border: v('--border', '#d1d5db'), hover: v('--hover', '#f3f4f6'), canvas: v('--bg', '#f3f4f6') }
  return { preference: theme === 'dark' ? 'dark' as const : 'light' as const, accent: tokens.accent, tokens }
}

export default function PdfView({ file }: { file: File }) {
  const theme = useTheme()
  const viewerRef = useRef<Viewer | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<File | null>(null)
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(() => Number(localStorage.getItem(`sidepage:place:${file.name}`)) || 1)
  const [pages, setPages] = useState(0)
  const [camera, setCamera] = useState(0)
  const [busy, setBusyNow] = useState('')
  const setBusy = (text: string, ms = 0) => { setBusyNow(text); if (ms) setTimeout(() => setBusyNow(now => (now === text ? '' : now)), ms) }
  const bookmarks = useBookmarks(file.name)
  const notebook = baseName(file.name)
  const placeKey = `sidepage:place:${file.name}`

  // The book opens with its drawings and highlights when a copy with them was kept (drawings.pdf, beside the notes).
  const madeFrom = `sidepage:drawings:${file.name}`
  useEffect(() => {
    let cancelled = false
    setSrc(null)
    setDoc(null)
    const withDrawings = Number(localStorage.getItem(madeFrom)) === file.size ? loadNoteFile(notebook, 'drawings.pdf') : Promise.resolve(null)
    void withDrawings.then(kept => { if (!cancelled) setSrc(kept ? new File([kept], file.name, { type: 'application/pdf' }) : file) })
    return () => { cancelled = true }
  }, [file]) // eslint-disable-line react-hooks/exhaustive-deps

  // The same file, read by PDF.js for what runs beside the viewer: the book's words for search across books and the
  // study guide, its contents, its cover, and the words and pictures the pacer, Peek and dark pages need.
  const [scanned, setScanned] = useState(false)
  useEffect(() => {
    let cancelled = false
    const task = pdfjs.getDocument({ data: new Uint8Array(0) })
    void task.destroy()
    let loading: pdfjs.PDFDocumentLoadingTask | undefined
    void file.arrayBuffer().then(data => {
      if (cancelled) return
      loading = pdfjs.getDocument({ data })
      loading.onPassword = () => {}
      return loading.promise.then(pdf => {
        if (cancelled) return
        setDoc(pdf)
        void learnBook(file, pdf, () => cancelled, setScanned)
      })
    }).catch(() => {})
    return () => { cancelled = true; void loading?.destroy() }
  }, [file])

  // ── The viewer ──
  const goTo = useCallback((number: number) => {
    const stage = viewerRef.current?.tryGet('stage')
    stage?.goToPage(Math.max(0, number - 1))
  }, [])
  const [cameFrom, setCameFrom] = useState(0)
  const go = (number: number) => { if (Math.abs(number - page) > 1) setCameFrom(page); goTo(number) }

  const onReady = useCallback((viewer: Viewer) => {
    viewerRef.current = viewer
    viewer.documents.onOpened(() => {
      const stage = viewer.get('stage')
      setPages(stage.getPageCount())
      const saved = Number(localStorage.getItem(placeKey))
      if (saved > 1) stage.goToPage(saved - 1)
      stage.onPageChanged(() => {
        const number = stage.getCurrentPageIndex() + 1
        setPage(number)
        noteVisit(file.name, number)
        tellPlace({ book: file.name, place: `page=${number}` })
        localStorage.setItem(placeKey, String(number))
        const count = stage.getPageCount()
        setProgress(file.name, count > 1 ? (number - 1) / (count - 1) : 1)
      })
      stage.onCameraChanged(() => setCamera(n => n + 1))
      stage.onViewportChanged(() => setCamera(n => n + 1))
      tellPlace({ book: file.name, place: `page=${stage.getCurrentPageIndex() + 1}` })
      // Highlights, drawings and notes made on the pages are kept in a copy of the PDF, beside the notes.
      const annotations = viewer.get('annotation')
      const keep = debounce(async () => {
        try {
          const id = viewer.documents.getActiveId?.() ?? undefined
          const bytes = await viewer.documents.download(id as string)
          await saveNoteFile(notebook, 'drawings.pdf', new Blob([bytes as BlobPart], { type: 'application/pdf' }))
          localStorage.setItem(madeFrom, String(file.size))
        } catch { /* kept at the next change */ }
      }, 2000)
      annotations.onCreated(event => {
        keep()
        void mirrorHighlight(event as unknown as { annotation: { id?: string; type?: string; subtype?: string; color?: string; pageIndex?: number } })
      })
      annotations.onUpdated(() => keep())
      annotations.onDeleted(() => keep())
    })
  }, [file]) // eslint-disable-line react-hooks/exhaustive-deps

  // A link in a note brings the reader to its page.
  useEffect(() => onGoToPlace(({ book, place }) => {
    if (book !== file.name) return
    setMode('scroll')
    goTo(Number(place.match(/page=(\d+)/)?.[1]) || 1)
  }), [file]) // eslint-disable-line react-hooks/exhaustive-deps

  // Where things stand on screen: the viewer's own stage, inside its shadow root, gives the page boxes in its own
  // coordinates; its corner on screen turns them into client pixels for what Sidepage lays over it.
  const stageCorner = useRef<{ el: Element | null }>({ el: null })
  const stageRect = (): DOMRect | null => {
    const stage = viewerRef.current?.tryGet('stage')
    const host = wrap.current?.querySelector('[data-epdf-wrapped]') as HTMLElement | null
    const root = host?.shadowRoot
    if (!stage || !root) return null
    const size = stage.getViewportSize()
    const known = stageCorner.current.el
    if (known?.isConnected && Math.abs(known.clientWidth - size.width) < 2 && Math.abs(known.clientHeight - size.height) < 2) return known.getBoundingClientRect()
    for (const el of root.querySelectorAll('*')) {
      if (Math.abs(el.clientWidth - size.width) < 2 && Math.abs(el.clientHeight - size.height) < 2 && el.clientWidth > 50) {
        stageCorner.current.el = el
        return el.getBoundingClientRect()
      }
    }
    return null
  }
  const toScreen = (number: number, box: Box): DOMRect | null => {
    const stage = viewerRef.current?.tryGet('stage')
    const corner = stageRect()
    if (!stage || !corner) return null
    const r = stage.pageRectToViewport(number - 1, { x: box.x, y: box.y, width: box.w, height: box.h })
    if (!r) return null
    return new DOMRect(corner.left + r.x, corner.top + r.y, r.width, r.height)
  }
  const pageAt = (x: number, y: number) => {
    const stage = viewerRef.current?.tryGet('stage')
    const corner = stageRect()
    if (!stage || !corner) return null
    const hit = stage.getPageAt({ x: x - corner.left, y: y - corner.top })
    const box = hit && stage.getPageBox(hit.ref)
    return hit && box ? { page: box.pageIndex + 1, x: hit.point.x, y: hit.point.y } : null
  }
  const visiblePages = (): number[] => {
    const stage = viewerRef.current?.tryGet('stage')
    return stage ? stage.listVisiblePages().map(p => stage.getPageBox(p.ref)?.pageIndex ?? -1).filter(i => i >= 0).map(i => i + 1) : []
  }

  // The words and pictures of the pages in view, read once each, for what is laid over the pages.
  const wordsNow = useRef(new Map<number, Word[]>())
  const picturesNow = useRef(new Map<number, Box[]>())
  const sizes = useRef(new Map<number, { w: number; h: number }>())
  useEffect(() => {
    if (!doc) return
    for (const number of visiblePages()) {
      if (!sizes.current.has(number)) void doc.getPage(number).then(p => { sizes.current.set(number, { w: p.view[2] - p.view[0], h: p.view[3] - p.view[1] }); setCamera(n => n + 1) })
      if (!wordsNow.current.has(number)) void wordsOf(doc, number).then(words => { wordsNow.current.set(number, words); setCamera(n => n + 1) })
      if (theme !== 'light' && !picturesNow.current.has(number)) void picturesOf(doc, number).then(boxes => { picturesNow.current.set(number, boxes); setCamera(n => n + 1) }).catch(() => {})
    }
  }, [camera, doc, theme]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Highlights: those made in the viewer are mirrored into Sidepage's list (flashcards, the highlights view, the
  // page map); those made before EmbedPDF are still shown, laid over their pages. ──
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const marks = useRef<Highlight[]>([])
  const saveMarks = (next: Highlight[]) => { marks.current = next; setHighlights(next); void saveHighlights(notebook, 'pdf', next) }
  useEffect(() => { void loadHighlights(notebook, 'pdf').then(saved => { marks.current = saved; setHighlights(saved) }) }, [notebook])
  const lastSelection = useRef<{ text: string; page: number } | null>(null)
  const mirrorHighlight = async ({ annotation }: { annotation: { id?: string; type?: string; subtype?: string; color?: string; pageIndex?: number } }) => {
    const kind = String(annotation.type ?? annotation.subtype ?? '').toLowerCase()
    if (!/highlight|underline|squiggly|strike/.test(kind)) return
    const passage = lastSelection.current
    if (!passage?.text) return
    saveMarks([...marks.current, { cfi: `page=${passage.page}&id=${annotation.id ?? Date.now().toString(36)}`, index: passage.page, text: passage.text, color: annotation.color ?? HIGHLIGHT_COLOURS.Yellow }])
  }
  const pageOf = (place: string) => Number(place.match(/page=(\d+)/)?.[1]) || 1

  // The selected passage, read from the viewer.
  const selected = async (): Promise<{ text: string; page: number } | null> => {
    const selection = viewerRef.current?.tryGet('selection')
    if (!selection?.hasSelection()) return null
    const text = (await selection.readText()).trim().replace(/\s+/g, ' ')
    const first = selection.listSelectedPages()[0]
    const box = first && viewerRef.current?.tryGet('stage')?.getPageBox(first)
    const found = { text, page: box ? box.pageIndex + 1 : page }
    lastSelection.current = found
    return text ? found : null
  }
  useEffect(() => {
    const selection = viewerRef.current?.tryGet('selection')
    if (!selection) return
    return selection.onCommitted(() => { void selected() })
  }, [pages]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── What the bars over selected text and over a snapshot do ──
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [picked, setPicked] = useState<Selected | null>(null)
  const [cardImage, setCardImage] = useState<{ image: string; page: number } | null>(null)
  const act = useRef<Actions>(null as unknown as Actions)
  act.current = {
    quote: () => void selected().then(found => {
      if (!found) return
      void viewerRef.current?.commands.execute('selection:highlight')
      sendQuote({ text: found.text, source: `${notebook}, p. ${found.page}`, book: file.name, place: `page=${found.page}` })
    }),
    lookUp: () => void selected().then(found => found && lookUp(found.text)),
    translate: () => void selected().then(found => found && translate(found.text)),
    ask: () => void selected().then(found => found && askAi(`Explain this passage (p. ${found.page}): “${found.text}”`)),
    more: kind => void selected().then(found => {
      if (!found) return
      if (kind === 'explained') setSheet({ kind: 'explained', words: found.text })
      else if (kind === 'uses') setSheet({ kind: 'uses', words: found.text })
      else if (kind === 'question') setSheet({ kind: 'question', passage: found.text, place: `page=${found.page}` })
      else if (kind === 'cite') openCite({ book: file.name, place: `page=${found.page}`, passage: found.text })
      else setPicked({ kind: kind as Selected['kind'], text: found.text, place: `page=${found.page}` })
    }),
    clip: kind => {
      const render = viewerRef.current?.tryGet('render')
      const shot = render?.getSnapshot()
      const box = shot && viewerRef.current?.tryGet('stage')?.getPageBox(shot.page)
      if (!shot || !box || !doc) return
      const number = box.pageIndex + 1
      const part = { x: shot.rect.x / box.width, y: shot.rect.y / box.height, w: shot.rect.width / box.width, h: shot.rect.height / box.height }
      render?.clearSnapshot()
      if (kind === 'table') {
        void doc.getPage(number).then(pdfPage => {
          const [, , w, h] = [0, 0, pdfPage.view[2] - pdfPage.view[0], pdfPage.view[3] - pdfPage.view[1]]
          return tableIn(pdfPage, { x: shot.rect.x / w, y: shot.rect.y / h, w: shot.rect.width / w, h: shot.rect.height / h })
        }).then(rows => {
          if (rows.length < 2) return setBusy('No table found there. Draw the box round the whole table.', 5000)
          sendQuote({ text: asMarkdownTable(rows), source: '', book: file.name, place: `page=${number}`, table: true })
          setBusy(`A table of ${rows.length} rows is in your notes`, 5000)
        })
        return
      }
      void sharpCanvas(doc, number).then(sharp => {
        const pdfW = sharp.width, pdfH = sharp.height
        void pdfW
        void pdfH
        return doc.getPage(number).then(pdfPage => {
          const w = pdfPage.view[2] - pdfPage.view[0], h = pdfPage.view[3] - pdfPage.view[1]
          const cut = document.createElement('canvas')
          const sx = shot.rect.x / w * sharp.width, sy = shot.rect.y / h * sharp.height, sw = shot.rect.width / w * sharp.width, sh = shot.rect.height / h * sharp.height
          const shrink = kind === 'words' ? 1 : Math.min(1, (kind === 'cards' ? 1600 : 1100) / sw)
          cut.width = Math.max(1, Math.round(sw * shrink))
          cut.height = Math.max(1, Math.round(sh * shrink))
          cut.getContext('2d')!.drawImage(sharp, sx, sy, sw, sh, 0, 0, cut.width, cut.height)
          if (kind === 'words') return void wordsFrom(cut, number)
          if (kind === 'cards') return setCardImage({ image: cut.toDataURL('image/jpeg', 0.9), page: number })
          sendClip({ image: cut.toDataURL('image/jpeg', 0.88), source: `${notebook}, p. ${number}`, book: file.name, place: `page=${number}` })
        })
      })
      void part
    },
  }
  const commands = useMemo(() => commandsFor(act), [])

  // ── Reading the words of pictures (scanned pages) ──
  const wordsFrom = async (picture: HTMLCanvasElement, number: number) => {
    setBusy('Reading the text…')
    try {
      const text = await readText(picture, share => setBusy(`Reading the text… ${Math.round(share * 100)}%`))
      if (text) sendQuote({ text, source: `${notebook}, p. ${number}`, book: file.name, place: `page=${number}` })
      setBusy(text ? '' : 'No words found there', 6000)
    } catch {
      setBusy('The text reader could not be fetched. It needs the internet the first time.', 6000)
    }
  }
  const readWholePage = () => { if (doc) void sharpCanvas(doc, page).then(sharp => wordsFrom(sharp, page)) }
  const [scanning, setScanning] = useState<{ done: number; total: number } | null>(null)
  const stopScan = useRef(false)
  const readScan = async () => {
    if (!doc) return
    stopScan.current = false
    setScanned(false)
    setScanning({ done: 0, total: doc.numPages })
    let reader: Awaited<ReturnType<typeof openReader>> | undefined
    try {
      reader = await openReader()
      const found: Stretch[] = []
      for (let number = 1; number <= doc.numPages && !stopScan.current; number++) {
        found.push({ place: `page=${number}`, text: await reader.read(await sharpCanvas(doc, number)) })
        setScanning({ done: number, total: doc.numPages })
        if (number % 5 === 0 || number === doc.numPages) await keepWords(file.name, found)
      }
      if (!stopScan.current) localStorage.setItem(`sidepage:read-scan:${file.name}`, '1')
      setBusy(stopScan.current ? 'Stopped. Pages read so far can be searched.' : 'Every page has been read: the book can now be searched.', 6000)
    } catch {
      setBusy('The text reader could not be fetched. It needs the internet the first time.', 6000)
    }
    await reader?.close()
    setScanning(null)
  }

  // ── Read aloud, the sentence lit as it is read ──
  const voice = useReadAloud()
  const [speaking, setSpeaking] = useState<{ page: number; strips: Box[] } | null>(null)
  const readAloud = () => {
    if (voice.speaking || !doc) { setSpeaking(null); return voice.stop() }
    let number = page
    let first = true
    void voice.start(async () => {
      if (!first) {
        if (number >= doc.numPages) return null
        number++
        goTo(number)
      }
      first = false
      const content = await (await doc.getPage(number)).getTextContent()
      return readableText(file.name, content.items.map(item => ('str' in item ? item.str : '')).join(' '))
    }, sentence => {
      if (!sentence) return setSpeaking(null)
      void wordsOf(doc, number).then(words => {
        const lit = wordsOfSentence(words, sentence)
        setSpeaking(lit.length ? { page: number, strips: stripsOf(lit) } : null)
        const shown = lit[0] && toScreen(number, lit[0])
        const view = stageRect()
        if (shown && view && (shown.top < view.top || shown.bottom > view.bottom)) viewerRef.current?.tryGet('stage')?.scrollBy({ top: shown.top - view.top - view.height * 0.35, behavior: 'smooth' })
      })
    })
  }

  // ── The pacer ──
  const host: PacerHost = {
    words: async number => (doc && number <= doc.numPages ? wordsOf(doc, number) : null),
    currentPage: () => page,
    toScreen,
    view: stageRect,
    goTo,
    scrollBy: dy => viewerRef.current?.tryGet('stage')?.scrollBy({ top: dy, behavior: 'smooth' }),
    pageAt,
  }
  const pacer = usePacer(host)

  // ── Peek: the line under the pointer, from the page's words ──
  const textAt = (x: number, y: number) => {
    const at = pageAt(x, y)
    const words = at && wordsNow.current.get(at.page)
    if (!at || !words) return null
    const hit = words.find(w => at.x >= w.x - 1 && at.x <= w.x + w.w + 1 && at.y >= w.y - 1 && at.y <= w.y + w.h + 1)
    if (!hit) return null
    const line = words.filter(w => w.line === hit.line)
    let text = '', offset = 0
    for (const w of line) {
      if (w === hit) offset = text.length + Math.round(((at.x - w.x) / Math.max(1, w.w)) * w.text.length)
      text += (text ? ' ' : '') + w.text
      if (w === hit) offset += text.length - w.text.length - offset > 0 ? 0 : 0
    }
    return { text, at: offset, page: at.page }
  }
  const peek = usePeek({ container: wrap, doc, file: file.name, go: number => go(number), textAt })

  // ── Hands-free reading: the page drifts upward by itself ──
  const [drift, setDrift] = useState(0)
  useEffect(() => {
    if (!drift) return
    let carried = 0
    const timer = setInterval(() => {
      carried += drift * 0.32
      const whole = Math.floor(carried)
      if (whole) { viewerRef.current?.tryGet('stage')?.scrollBy({ top: whole, behavior: 'instant' }); carried -= whole }
    }, 16)
    return () => clearInterval(timer)
  }, [drift])

  // ── Page flip and flowing text ──
  const [mode, setMode] = useState<'scroll' | 'flip'>(() => (prefersFlip() ? 'flip' : 'scroll'))
  const [flowing, setFlowing] = usePref(`reflow:${file.name}`, false)
  const [flip, setFlip] = useState<{ pages: string[]; ratio: number; first: number } | null>(null)
  useEffect(() => {
    if (mode !== 'flip' || !doc) return
    let cancelled = false
    const urls: string[] = []
    const first = Math.floor((page - 1) / FLIP_CHUNK) * FLIP_CHUNK + 1
    const last = Math.min(doc.numPages, first + FLIP_CHUNK - 1)
    ;(async () => {
      let ratio = 1.4
      for (let n = first; n <= last && !cancelled; n++) {
        const pdfPage = await doc.getPage(n)
        const natural = pdfPage.getViewport({ scale: 1 })
        const wanted = Math.min(2400, Math.max(1400, Math.round(window.screen.width * (window.devicePixelRatio || 1) * 0.55)))
        const viewport = pdfPage.getViewport({ scale: wanted / natural.width })
        if (n === first) ratio = viewport.height / viewport.width
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        await pdfPage.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
        const shaded = document.createElement('canvas')
        shaded.width = canvas.width
        shaded.height = canvas.height
        const ink = shaded.getContext('2d')!
        ink.filter = pageFilter(theme)
        ink.drawImage(canvas, 0, 0)
        ink.filter = 'none'
        if (theme === 'dark') {
          const scale = viewport.width / natural.width
          for (const box of await picturesOf(doc, n).catch(() => [] as Box[])) {
            ink.drawImage(canvas, box.x * scale, box.y * scale, box.w * scale, box.h * scale, box.x * scale, box.y * scale, box.w * scale, box.h * scale)
          }
        }
        const blob = await new Promise<Blob | null>(resolve => shaded.toBlob(resolve, 'image/jpeg', 0.92))
        if (blob) urls.push(URL.createObjectURL(blob))
      }
      if (!cancelled) setFlip({ pages: urls, ratio, first })
    })()
    return () => { cancelled = true; setFlip(null); urls.forEach(url => URL.revokeObjectURL(url)) }
  }, [mode, doc, theme]) // eslint-disable-line react-hooks/exhaustive-deps
  const leaveFlip = () => { rememberFlip(false); setMode('scroll'); requestAnimationFrame(() => goTo(page)) }

  // ── Study marks ──
  const studied = usePageMarks(file.name)
  const [showHard, setShowHard] = usePref('map-hard', false)
  const [hard, setHard] = useState<number[]>([])
  useEffect(() => {
    if (!showHard || !doc) return setHard([])
    let cancelled = false
    void hardnessOf(file.name, doc.numPages).then(grades => {
      const read = grades.filter(Boolean).sort((a, b) => a - b)
      const usual = read[Math.floor(read.length / 2)] ?? 0
      const spread = read[Math.floor(read.length * 0.85)] ?? usual
      if (!cancelled) setHard(grades.flatMap((grade, i) => (grade && grade >= Math.max(usual + 2, spread) ? [i + 1] : [])))
    })
    return () => { cancelled = true }
  }, [showHard, doc, file.name])
  const knownHere = studied.known[`page=${page}`]
  const nextUnknown = () => {
    const count = pages || doc?.numPages || 0
    for (let step = 1; step <= count; step++) {
      const number = ((page - 1 + step) % count) + 1
      const known = studied.known[`page=${number}`]
      if (known && known < 3) return go(number)
    }
    setBusy('No page marked “Not yet” or “Partly”.', 4000)
  }
  usePref('plans', {})
  const count = pages || doc?.numPages || 0
  const plan = count ? planToday(file.name) : null
  const goalPage = plan && count ? Math.min(count, Math.ceil(plan.target * (count - 1)) + 1) : 0

  // ── The PDF tools by name, from the palette (Ctrl K) ──
  const startSnapshot = () => void viewerRef.current?.commands.execute('tool:snapshot')
  const toolsByName = useRef<Record<string, () => void>>({})
  toolsByName.current = {
    'fit-width': () => void viewerRef.current?.commands.execute('zoom:fit-width'), 'whole-page': () => void viewerRef.current?.commands.execute('zoom:fit-page'),
    'two-pages': () => void viewerRef.current?.commands.execute('view:two-pages'), turn: () => void viewerRef.current?.commands.execute('view:rotate-clockwise'),
    'all-pages': () => void viewerRef.current?.commands.execute('panel:thumbnails'), flowing: () => setFlowing(!flowing),
    paper: () => { rememberFlip(true); setMode('flip') }, 'read-aloud': readAloud, pacer: () => void pacer.start(),
    clip: startSnapshot, 'text-box': startSnapshot, table: startSnapshot, 'picture-cards': startSnapshot,
    draw: () => void viewerRef.current?.commands.execute('tool:ink'), 'page-text': readWholePage, 'next-to-learn': nextUnknown, 'hard-pages': () => setShowHard(!showHard),
    cite: () => openCite({ book: file.name, place: `page=${page}` }), 'new-pdf': () => void viewerRef.current?.commands.execute('panel:thumbnails'),
    'with-marks': () => void viewerRef.current?.commands.execute('document:download'), searchable: () => void readScan(),
  }
  useEffect(() => {
    const run = (e: Event) => { if (placeNow()?.book === file.name) toolsByName.current[(e as CustomEvent<string>).detail]?.() }
    window.addEventListener('sidepage:pdf-tool', run)
    return () => window.removeEventListener('sidepage:pdf-tool', run)
  }, [file.name])

  // The guide and the notes follow whichever book was last opened or touched.
  useEffect(() => { if (doc) tellPlace({ book: file.name, place: `page=${page}` }) }, [doc]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── What Sidepage lays over the pages: old highlights, the lit sentence, the pacer's shade, dark and sepia pages ──
  void camera
  const overlay = () => {
    const view = stageRect()
    const outer = wrap.current?.getBoundingClientRect()
    if (!view || !outer) return null
    const place = (r: DOMRect) => ({ left: r.left - outer.left, top: r.top - outer.top, width: r.width, height: r.height })
    const parts: React.ReactNode[] = []
    const stage = viewerRef.current?.tryGet('stage')
    if (theme !== 'light' && stage) {
      for (const number of visiblePages()) {
        const size = sizes.current.get(number)
        const whole = size && toScreen(number, { x: 0, y: 0, w: size.w, h: size.h })
        if (!whole) continue
        // The pictures are left out of the shading, so they keep their colours.
        const holes = (picturesNow.current.get(number) ?? []).map(p => toScreen(number, p)).filter((r): r is DOMRect => !!r)
        const path = [`M0 0H${whole.width}V${whole.height}H0Z`, ...holes.map(h => `M${h.left - whole.left} ${h.top - whole.top}h${h.width}v${h.height}h${-h.width}Z`)].join(' ')
        parts.push(<div key={`t${number}`} className="pdf-tint" style={{ ...place(whole), backdropFilter: pageFilter(theme), WebkitBackdropFilter: pageFilter(theme), clipPath: `path(evenodd, '${path}')` }} />)
      }
    }
    for (const mark of highlights) {
      if (!mark.rects?.length || !visiblePages().includes(mark.index)) continue
      const size = sizes.current.get(mark.index)
      if (!size) continue
      const { w, h } = size
      mark.rects.forEach(([x, y, rw, rh], i) => {
        const r = toScreen(mark.index, { x: x * w, y: y * h, w: rw * w, h: rh * h })
        if (r) parts.push(<div key={`h${mark.cfi}${i}`} className="pdf-mark-over" style={{ ...place(r), background: mark.color ?? HIGHLIGHT_COLOURS.Yellow }} />)
      })
    }
    if (speaking) speaking.strips.forEach((s, i) => { const r = toScreen(speaking.page, s); if (r) parts.push(<div key={`s${i}`} className="pdf-speaking" style={place(r)} />) })
    if (pacer.word) { const r = toScreen(pacer.word.page, { x: pacer.word.x - 2, y: pacer.word.y - 2, w: pacer.word.w + 4, h: pacer.word.h + 4 }); if (r) parts.push(<div key="pacer" className="pacer-mark" style={place(r)} />) }
    const clip = place(view)
    return <div className="pdf-over" style={{ clipPath: `inset(${clip.top}px ${outer.width - clip.left - clip.width}px ${outer.height - clip.top - clip.height}px ${clip.left}px)` }}>{parts}</div>
  }

  const viewerTheme = useMemo(() => themeOf(theme), [theme])

  return (
    <div className="viewer embed-viewer" ref={wrap}
      onPointerDownCapture={e => {
        tellPlace({ book: file.name, place: `page=${page}` })
        pacer.touched(e.clientX, e.clientY)
        // A stylus touching the page means writing on it: switch to the pen without being asked.
        if (e.pointerType === 'pen') void viewerRef.current?.commands.execute('tool:ink')
      }}
      onWheelCapture={() => pacer.scrolledByHand()}
      onTouchMoveCapture={() => pacer.scrolledByHand()}
      {...peek.handlers}
    >
      {src && (
        <PDFViewer
          src={src}
          theme={viewerTheme}
          commands={commands}
          icons={ICONS}
          layout={layoutOfViewer}
          features={{ snapshots: true }}
          locale={uiLanguage()}
          onReady={onReady}
          style={{ height: '100%', width: '100%' }}
        >
          <ToolbarItem id="sidepage-start">
            <span className="embed-chips">
              {cameFrom > 0 && cameFrom !== page && <button className="viewer-pos" title="Return to the page you were on" onClick={() => go(cameFrom)}>↩ p. {cameFrom}</button>}
              {scanned && !scanning && <button className="viewer-pos plan-pill" title="Its pages are pictures. Read their words once so the book can be searched, summed up and quizzed on." onClick={() => void readScan()}>Scanned: make it searchable</button>}
              {scanning && <button className="viewer-pos" title="Stop reading the pages" onClick={() => { stopScan.current = true }}>Reading pages {scanning.done} / {scanning.total} · stop</button>}
              <LectureChip book={file.name} place={`page=${page}`} />
              {plan && <span className={page >= goalPage ? 'viewer-pos plan-pill done' : 'viewer-pos plan-pill'} title="Today's mark in your reading plan">{page >= goalPage ? 'Today’s reading done' : `Today: to p. ${goalPage}`}</span>}
              {busy && <span className="viewer-pos">{busy}</span>}
            </span>
          </ToolbarItem>
          <ToolbarItem id="sidepage">
            <span className="embed-tools">
              {drift > 0 && <Tool quiet icon={ChevronsDown} label="Stop scrolling" on onClick={() => setDrift(0)} />}
              {voice.speaking && <Tool quiet icon={voice.paused ? Play : Pause} label={voice.paused ? 'Resume reading' : 'Pause reading'} on={voice.paused} onClick={voice.paused ? voice.resume : voice.pause} />}
              {voice.speaking && <Tool quiet icon={Square} label="Stop reading" on onClick={readAloud} />}
              <BookmarksMenu marks={bookmarks} here={{ place: `page=${page}`, label: `Page ${page}` }} onGo={place => go(pageOf(place))} />
              <HighlightsMenu marks={highlights} notebook={notebook} onHighlight={() => void viewerRef.current?.commands.execute('selection:highlight')} onGo={place => go(pageOf(place))}
                onChange={(place, change) => saveMarks(marks.current.map(mark => (mark.cfi === place ? { ...mark, ...change } : mark)))}
                onRemove={place => saveMarks(marks.current.filter(mark => mark.cfi !== place))} />
              <QuestionsMenu book={file.name} marks={studied} onGo={place => go(pageOf(place))} />
              <Menu quiet icon={Ellipsis} label="Sidepage" hint="Reading aids, taking from the page, study marks" wide>
                <p className="menu-head">Reading</p>
                <div className="menu-tiles">
                  <Tool icon={BookOpen} label="Like paper" hint="Turn pages like paper" onClick={() => { rememberFlip(true); setMode('flip') }} />
                  <Tool icon={WrapText} label="Flowing text" hint="The words of the pages set at the width of the screen, in your text size and typeface: easier on a phone" on={flowing} onClick={() => setFlowing(!flowing)} />
                  <Tool icon={Pointer} label={pacer.on ? 'Stop pacer' : 'Pacer'} hint="A soft shade moves from word to word at a steady reading pace, to keep your place. Tap a word to move it there" on={pacer.on} onClick={() => void pacer.start()} />
                  {canSpeak && <Tool icon={voice.speaking ? Square : Volume2} label={voice.speaking ? 'Stop reading' : 'Read aloud'} hint="Read the book aloud from this page" on={voice.speaking} onClick={readAloud} />}
                </div>
                <div className="menu-line">
                  <span className="menu-note">Scroll by itself</span>
                  {[['Off', 0], ['Slow', 1], ['Steady', 2], ['Fast', 4]].map(([name, speed]) => (
                    <button key={name} className={drift === speed ? 'menu-item on' : 'menu-item'} onClick={() => setDrift(speed as number)}>{name}</button>
                  ))}
                </div>
                <p className="menu-head">Take from the page</p>
                <div className="menu-tiles">
                  <Tool icon={Crop} label="Clip a picture" hint="Draw a box over part of a page, then put it in your notes" onClick={startSnapshot} />
                  <Tool icon={ScanText} label="Text in a box" hint="Draw a box over a scanned page or a picture, then put the words in it into your notes" onClick={startSnapshot} />
                  <Tool icon={Table2} label="A table" hint="Draw a box round a table, then put it in your notes as a table you can edit" onClick={startSnapshot} />
                  <Tool icon={SquareDashed} label="Picture cards" hint="Draw a box over a diagram, then cover its labels: each one becomes a flashcard" onClick={startSnapshot} />
                  <Tool icon={ScanText} label="Page's text" hint="For a scanned page: put the words of the whole page into your notes" onClick={readWholePage} />
                </div>
                <p className="menu-head">This page</p>
                <div className="known-row" title="Mark how well you know this page: it shows on the page map, and you can come back to the pages you do not know yet">
                  <span className="menu-note">I know it</span>
                  {([1, 2, 3] as const).map(level => (
                    <button key={level} className={knownHere === level ? 'stay on' : 'stay'} style={knownHere === level ? { background: KNOWN[level].colour } : undefined}
                      onClick={() => void markKnown(file.name, `page=${page}`, knownHere === level ? null : level)}>{KNOWN[level].name}</button>
                  ))}
                </div>
                <div className="menu-tiles">
                  <Tool icon={Gauge} label="Next to learn" hint="The next page marked Not yet or Partly" onClick={nextUnknown} />
                  <Tool icon={ListTree} label="Hard pages" hint="Shade the pages much harder to read than the rest of the book on the page map" on={showHard} onClick={() => setShowHard(!showHard)} />
                </div>
                <p className="menu-head">This book</p>
                <div className="menu-tiles">
                  <Tool icon={TextQuote} label="Cite it" hint="As a reference, in your text with this page" onClick={() => openCite({ book: file.name, place: `page=${page}` })} />
                  <Tool icon={ScanText} label="Searchable" hint="For a scanned book: read every page's words once, so it can be searched and studied" onClick={() => void readScan()} />
                </div>
                <p className="menu-note small">Select words on the page for more: quote, look up, translate, ask AI, and more under ⋯.</p>
              </Menu>
            </span>
          </ToolbarItem>
        </PDFViewer>
      )}
      {overlay()}
      {peek.view}
      <PacerBar pacer={pacer} />
      {count > 0 && !flowing && mode === 'scroll' && (
        <PageMap
          file={file.name} pages={count} current={page} goal={plan ? goalPage : undefined}
          highlights={highlights.map(mark => ({ page: pageOf(mark.cfi), colour: mark.color ?? '#ffd84d' }))}
          bookmarks={bookmarks.list.map(mark => pageOf(mark.place))}
          known={Object.fromEntries(Object.entries(studied.known).map(([place, level]) => [pageOf(place), KNOWN[level].colour]))}
          questions={studied.questions.filter(q => !q.answered).map(q => pageOf(q.place))}
          hard={hard}
          onGo={number => go(number)}
        />
      )}
      {sheet && <StudySheet book={file.name} sheet={sheet} onGo={place => { setSheet(null); go(pageOf(place)) }} onClose={() => setSheet(null)} />}
      {picked && <SelectionSheet book={file.name} selected={picked} onClose={() => setPicked(null)} />}
      {doc && <RecapCard book={file.name} onGo={number => go(number)} />}
      {cardImage && (
        <PictureCardMaker
          image={cardImage.image}
          onCancel={() => setCardImage(null)}
          onSave={boxes => {
            const { image, page: from } = cardImage
            setCardImage(null)
            void fetch(image).then(answer => answer.blob()).then(blob => addPictureCards(notebook, blob, { source: `${notebook}, p. ${from}`, place: `page=${from}`, boxes }))
            setBusy(`${boxes.length} picture card${boxes.length === 1 ? '' : 's'} made: they come up in Review`, 5000)
          }}
        />
      )}
      {flowing && doc && mode === 'scroll' && (
        <div className="embed-cover">
          <Reflow doc={doc} page={page} onPage={number => { setPage(number); tellPlace({ book: file.name, place: `page=${number}` }); localStorage.setItem(placeKey, String(number)) }} />
          <button className="viewer-pos embed-leave" onClick={() => { setFlowing(false); goTo(page) }}>Back to the pages</button>
        </div>
      )}
      {mode === 'flip' && (
        <div className="embed-cover">
          {flip
            ? <FlipBook pages={flip.pages} ratio={flip.ratio} startPage={page - flip.first} onFlip={i => {
                setPage(flip.first + i)
                tellPlace({ book: file.name, place: `page=${flip.first + i}` })
                localStorage.setItem(placeKey, String(flip.first + i))
              }} />
            : <div className="viewer-message">Preparing pages…</div>}
          <button className="viewer-pos embed-leave" onClick={leaveFlip}>Back to scrolling</button>
        </div>
      )}
    </div>
  )
}

// A page drawn large, for reading the words of a picture or cutting a sharp clip from it.
async function sharpCanvas(doc: pdfjs.PDFDocumentProxy, number: number) {
  const pdfPage = await doc.getPage(number)
  const base = pdfPage.getViewport({ scale: 1 })
  const viewport = pdfPage.getViewport({ scale: Math.min(3, 2600 / Math.max(base.width, base.height)) })
  const sharp = document.createElement('canvas')
  sharp.width = viewport.width
  sharp.height = viewport.height
  await pdfPage.render({ canvas: sharp, canvasContext: sharp.getContext('2d')!, viewport }).promise
  return sharp
}

// What Sidepage learns of a book once, in the background: its contents (from its outline, or from its headings),
// its words (for search across books and the study guide), whether it is scanned, its facts for citing, its cover.
async function learnBook(file: File, pdf: pdfjs.PDFDocumentProxy, cancelled: () => boolean, onScanned: (scanned: boolean) => void) {
  type Entry = { title: string; dest: string | unknown[] | null; items: Entry[] }
  void pdf.getOutline().then(async outline => {
    if (cancelled()) return
    if (outline?.length) {
      const pageOf = async (dest: Entry['dest']) => {
        try {
          const target = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
          const ref = target?.[0]
          return ref && typeof ref === 'object' ? (await pdf.getPageIndex(ref as never)) + 1 : typeof ref === 'number' ? ref + 1 : undefined
        } catch { return undefined }
      }
      const listed = async (items: Entry[], depth = 0): Promise<ContentsItem[]> => (await Promise.all(items.map(async item => {
        const page = await pageOf(item.dest)
        return [{ label: item.title, depth, place: page ? `page=${page}` : undefined }, ...await listed(item.items ?? [], depth + 1)]
      }))).flat()
      tellContents(file.name, await listed(outline as Entry[]))
    } else {
      const layout = await layoutOf(pdf)
      if (!cancelled()) tellContents(file.name, headingsOf(layout).map(heading => ({ label: heading.label, depth: heading.depth, place: `page=${heading.page}` })))
    }
  }).catch(() => {})
  void hasWords(file.name).then(async known => {
    if (known) return
    const pages: Stretch[] = []
    for (let number = 1; number <= Math.min(pdf.numPages, 2000) && !cancelled(); number++) {
      const content = await (await pdf.getPage(number)).getTextContent()
      pages.push({ place: `page=${number}`, text: content.items.map(item => ('str' in item ? item.str : '')).join(' ') })
      if (number % 10 === 0) await new Promise(resolve => setTimeout(resolve, 30))
    }
    if (!cancelled()) await keepWords(file.name, pages)
  }).then(async () => {
    if (!cancelled() && (await lettersKept(file.name)) < pdf.numPages * 40 && !localStorage.getItem(`sidepage:read-scan:${file.name}`)) onScanned(true)
  }).catch(() => {})
  void pdf.getMetadata().then(({ info }) => {
    const facts = info as { Title?: string; Author?: string; CreationDate?: string }
    return keepFacts(file.name, { title: facts.Title, authors: (facts.Author ?? '').split(/;|\band\b|&/).map(name => name.trim()).filter(Boolean), year: (facts.CreationDate ?? '').replace(/^D:/, ''), pages: pdf.numPages, kind: 'document' })
  }).catch(() => {})
  void pdf.getPage(1).then(async first => {
    const viewport = first.getViewport({ scale: 320 / first.getViewport({ scale: 1 }).width })
    const cover = document.createElement('canvas')
    cover.width = viewport.width
    cover.height = viewport.height
    await first.render({ canvas: cover, canvasContext: cover.getContext('2d')!, viewport }).promise
    await saveCover(file.name, cover)
  }).catch(() => {})
}
