import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import 'pdfjs-dist/web/pdf_viewer.css'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import FlipBook from './FlipBook'
import SearchBox from './SearchBox'
import PageGrid from './PageGrid'
import {
  BookA, BookCopy, BookOpen, ChevronLeft, ChevronRight, ChevronsDown, Crop, Download, Eye, LayoutGrid, Maximize, MoveHorizontal, Pencil, RotateCw, Square, TextQuote,
  Volume2, ZoomIn, ZoomOut,
} from 'lucide-react'
import { lookUp } from '../Extras'
import { Menu, Tool } from '../ui'
import { BookmarksMenu, ContentsMenu, HIGHLIGHT_COLOURS, HighlightsMenu } from './ReaderMenus'
import { loadHighlights, saveCover, saveHighlights, setProgress, useBookmarks, type Highlight } from '../lib/reading'
import { canSpeak, useReadAloud } from '../lib/speech'
import { hasWords, keepWords, type Stretch } from '../lib/library'
import { pageFilter, useTheme } from '../lib/theme'
import { baseName, debounce, loadNoteFile, onGoToPlace, prefersFlip, rememberFlip, saveFileAs, saveNoteFile, sendClip, sendQuote } from '../lib/platform'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const FLIP_CHUNK = 80

// The pictures of a page, cut out of the finished page exactly along their own outlines.
// PDF.js draws the page a second time doing nothing but its pictures, on a clear sheet; that gives the precise
// shape of every picture, soft edges and see-through parts included. The finished page is then kept only where
// that shape is. Laid over a page shaded for the dark theme, the result puts each picture back in its real
// colours and leaves everything else, including whatever shows through a picture's clear parts, dark.
async function picturesOf(page: pdfjs.PDFPageProxy, viewport: pdfjs.PageViewport, finished: HTMLCanvasElement) {
  const { OPS } = pdfjs
  const isPicture = (fn: number) => fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat
  // Everything that puts ink on the page without being a picture: text, lines, fills, shadings, stencils.
  const ink = new Set<number>([
    OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke,
    OPS.closeEOFillStroke, OPS.shadingFill, OPS.showText, OPS.showSpacedText, OPS.nextLineShowText,
    OPS.nextLineSetSpacingShowText, OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup,
    OPS.paintImageMaskXObjectRepeat, OPS.paintSolidColorImageMask,
  ])
  const list = await page.getOperatorList()
  if (!list.fnArray.some(isPicture)) return null
  const cut = document.createElement('canvas')
  cut.width = finished.width
  cut.height = finished.height
  await page.render({
    canvas: cut,
    canvasContext: cut.getContext('2d')!,
    viewport,
    background: 'rgba(0,0,0,0)',
    // A path is kept only when it is there to clip (it ends without painting); state and clipping always stay.
    operationsFilter: (i, ops) => (ops.fnArray[i] === OPS.constructPath ? ops.argsArray[i]?.[0] === OPS.endPath : !ink.has(ops.fnArray[i])),
  }).promise
  const ctx = cut.getContext('2d')!
  ctx.globalCompositeOperation = 'source-in'
  ctx.drawImage(finished, 0, 0, cut.width, cut.height)
  return cut
}

export default function PdfView({ file }: { file: File }) {
  const theme = useTheme()
  const container = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PDFViewer | null>(null)
  const toolUsed = useRef(false)
  const keepDrawings = useRef<() => void>(() => {})
  const [overview, setOverview] = useState(false)
  const bus = useRef<EventBus | null>(null)
  const [matches, setMatches] = useState('')
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(() => Number(localStorage.getItem(`sidepage:place:${file.name}`)) || 1)
  const [mode, setMode] = useState<'scroll' | 'flip'>(() => (prefersFlip() ? 'flip' : 'scroll'))
  const [flip, setFlip] = useState<{ pages: string[]; ratio: number; first: number } | null>(null)
  const [error, setError] = useState('')
  const [tool, setTool] = useState<'none' | 'highlight' | 'draw'>('none')
  const bookmarks = useBookmarks(file.name)

  // The reader's highlights. Each is drawn over its page as coloured strips, under the text so the text can
  // still be selected. The list is kept twice: in a ref for the viewer's own events, and in state for showing.
  const marks = useRef<Highlight[]>([])
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const pageOf = (place: string) => Number(place.match(/page=(\d+)/)?.[1]) || 1
  const paint = (pageDiv: HTMLElement) => {
    const wrapper = pageDiv.querySelector('.canvasWrapper')
    if (!wrapper) return
    wrapper.querySelectorAll('.pdf-mark').forEach(old => old.remove())
    for (const mark of marks.current) {
      if (mark.index !== Number(pageDiv.dataset.pageNumber)) continue
      for (const [x, y, w, h] of mark.rects ?? []) {
        const strip = document.createElement('div')
        strip.className = 'pdf-mark'
        strip.style.cssText = `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%;background:${mark.color ?? HIGHLIGHT_COLOURS.Yellow}`
        wrapper.append(strip)
      }
    }
  }
  const saveMarks = (next: Highlight[]) => {
    marks.current = next
    setHighlights(next)
    void saveHighlights(baseName(file.name), 'pdf', next)
    container.current?.querySelectorAll<HTMLElement>('.page').forEach(paint)
  }
  useEffect(() => {
    let cancelled = false
    void loadHighlights(baseName(file.name), 'pdf').then(saved => {
      if (cancelled) return
      marks.current = saved
      setHighlights(saved)
      container.current?.querySelectorAll<HTMLElement>('.page').forEach(paint)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  // The selected passage: its words, its page, and where on the page each line of it lies.
  const selectedPassage = () => {
    const selection = window.getSelection()
    const text = selection?.toString().trim()
    if (!selection || !text || !selection.rangeCount) return null
    const range = selection.getRangeAt(0)
    const pageDiv = range.startContainer.parentElement?.closest<HTMLElement>('.page')
    const box = pageDiv?.querySelector('.canvasWrapper')?.getBoundingClientRect()
    if (!pageDiv || !box || !container.current?.contains(pageDiv)) return null
    const rects: number[][] = []
    for (const r of range.getClientRects()) {
      if (r.width < 2 || r.height < 2 || r.bottom < box.top || r.top > box.bottom) continue
      const next = [(r.left - box.left) / box.width, (r.top - box.top) / box.height, r.width / box.width, r.height / box.height]
      // The text layer reports some lines twice; one strip per stretch of text is enough.
      const repeat = rects.some(([x, y, w, h]) => Math.abs(y - next[1]) < h / 2 && next[0] >= x - 0.002 && next[0] + next[2] <= x + w + 0.002)
      if (!repeat) rects.push(next)
    }
    selection.removeAllRanges()
    const number = Number(pageDiv.dataset.pageNumber)
    return { text, page: number, rects, place: `page=${number}&id=${Date.now().toString(36)}` }
  }
  const highlight = (color?: string) => {
    const passage = selectedPassage()
    if (passage?.rects.length) saveMarks([...marks.current, { cfi: passage.place, index: passage.page, text: passage.text, rects: passage.rects, color }])
    return passage
  }
  const changeHighlight = (place: string, change: Partial<Highlight>) => saveMarks(marks.current.map(mark => (mark.cfi === place ? { ...mark, ...change } : mark)))
  const removeHighlight = (place: string) => saveMarks(marks.current.filter(mark => mark.cfi !== place))

  // Clip: drag a box over part of a page and it goes to the notes as a picture, linked back to its page.
  const [clipping, setClipping] = useState(false)
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const clip = (area: { x0: number; y0: number; x1: number; y1: number }) => {
    const [left, right, top, bottom] = [Math.min(area.x0, area.x1), Math.max(area.x0, area.x1), Math.min(area.y0, area.y1), Math.max(area.y0, area.y1)]
    if (right - left < 12 || bottom - top < 12) return
    // The page the box mostly lies on.
    let best: { canvas: HTMLCanvasElement; page: number; overlap: number } | null = null
    for (const pageDiv of container.current?.querySelectorAll<HTMLElement>('.page') ?? []) {
      const canvas = pageDiv.querySelector<HTMLCanvasElement>('.canvasWrapper canvas:not(.picture-keep)')
      if (!canvas) continue
      const r = canvas.getBoundingClientRect()
      const overlap = Math.max(0, Math.min(right, r.right) - Math.max(left, r.left)) * Math.max(0, Math.min(bottom, r.bottom) - Math.max(top, r.top))
      if (overlap > (best?.overlap ?? 0)) best = { canvas, page: Number(pageDiv.dataset.pageNumber), overlap }
    }
    if (!best) return
    const r = best.canvas.getBoundingClientRect()
    const scale = best.canvas.width / r.width
    const [sx, sy] = [Math.max(0, left - r.left) * scale, Math.max(0, top - r.top) * scale]
    const [sw, sh] = [(Math.min(right, r.right) - Math.max(left, r.left)) * scale, (Math.min(bottom, r.bottom) - Math.max(top, r.top)) * scale]
    // Kept to a sensible size: it is stored inside the note.
    const shrink = Math.min(1, 1100 / sw)
    const cut = document.createElement('canvas')
    cut.width = Math.round(sw * shrink)
    cut.height = Math.round(sh * shrink)
    cut.getContext('2d')!.drawImage(best.canvas, sx, sy, sw, sh, 0, 0, cut.width, cut.height)
    sendClip({ image: cut.toDataURL('image/jpeg', 0.88), source: `${baseName(file.name)}, p. ${best.page}`, book: file.name, place: `page=${best.page}` })
  }
  // Read aloud: the page that is open, then the next, and so on to the end.
  const voice = useReadAloud()
  const readAloud = () => {
    if (voice.speaking || !doc) return voice.stop()
    let number = page
    let first = true
    void voice.start(async () => {
      if (!first) {
        if (number >= doc.numPages) return null
        number++
        if (viewerRef.current) viewerRef.current.currentPageNumber = number
      }
      first = false
      const content = await (await doc.getPage(number)).getTextContent()
      return content.items.map(item => ('str' in item ? item.str : '')).join(' ')
    })
  }
  const links = useRef<PDFLinkService | null>(null)
  const [contents, setContents] = useState<{ label: string; depth: number; go(): void }[]>([])
  // Zoom: the page fills the panel's width until the reader zooms; after that their zoom is kept.
  const fitted = useRef(true)
  const [zoom, setZoom] = useState(100)
  const zoomBy = (factor: number) => {
    const viewer = viewerRef.current
    if (!viewer?.pdfDocument) return
    fitted.current = false
    viewer.currentScale = Math.max(0.3, Math.min(5, viewer.currentScale * factor))
  }
  const fitWidth = () => {
    fitted.current = true
    if (viewerRef.current?.pdfDocument) viewerRef.current.currentScaleValue = 'page-width'
  }

  useEffect(() => {
    let cancelled = false
    const eventBus = new EventBus()
    const linkService = new PDFLinkService({ eventBus })
    const findController = new PDFFindController({ eventBus, linkService })
    const viewer = new PDFViewer({
      container: container.current!,
      eventBus,
      linkService,
      findController,
      // PDF.js's own annotation editor: highlights and pen strokes drawn on the page.
      annotationEditorMode: pdfjs.AnnotationEditorType.NONE,
      annotationEditorHighlightColors: 'yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F',
    })
    linkService.setViewer(viewer)
    links.current = linkService
    bus.current = eventBus
    eventBus.on('scalechanging', (e: { scale: number }) => setZoom(Math.round(e.scale * 100)))
    eventBus.on('updatefindmatchescount', (e: { matchesCount: { current: number; total: number } }) => {
      setMatches(e.matchesCount.total ? `${e.matchesCount.current} / ${e.matchesCount.total}` : 'No matches')
    })
    eventBus.on('updatefindcontrolstate', (e: { state: number; matchesCount: { total: number } }) => {
      if (e.state === 1) setMatches('No matches')
    })
    viewerRef.current = viewer
    const placeKey = `sidepage:place:${file.name}`
    // Keep each page's pictures aside, so a dark theme can show them in their real colours (see index.css).
    type RenderedPage = { div: HTMLElement; canvas?: HTMLCanvasElement; pdfPage?: pdfjs.PDFPageProxy; viewport: pdfjs.PageViewport }
    eventBus.on('pagerendered', async (e: { source: RenderedPage }) => {
      const { div, canvas, pdfPage, viewport } = e.source
      const wrapper = div.querySelector('.canvasWrapper')
      if (!wrapper || !canvas || !pdfPage) return
      // Drawn at the page canvas's own pixel size, which is finer than the page's size on screen.
      const exact = pdfPage.getViewport({ scale: viewport.scale * (canvas.width / viewport.width), rotation: viewport.rotation })
      paint(div)
      const pictures = await picturesOf(pdfPage, exact, canvas).catch(() => null)
      wrapper.querySelectorAll('.picture-keep').forEach(old => old.remove())
      if (!pictures || !canvas.isConnected) return
      pictures.className = 'picture-keep'
      wrapper.append(pictures)
    })
    eventBus.on('pagesinit', () => {
      viewer.currentScaleValue = 'page-width'
      // Reopen where the reader left off.
      const saved = Number(localStorage.getItem(placeKey))
      if (saved > 1 && saved <= viewer.pagesCount) viewer.currentPageNumber = saved
    })
    eventBus.on('pagechanging', (e: { pageNumber: number }) => {
      setPage(e.pageNumber)
      localStorage.setItem(placeKey, String(e.pageNumber))
      setProgress(file.name, viewer.pagesCount > 1 ? (e.pageNumber - 1) / (viewer.pagesCount - 1) : 1)
    })

    const resize = new ResizeObserver(() => {
      if (viewer.pdfDocument && container.current?.clientWidth && fitted.current) viewer.currentScaleValue = 'page-width'
    })
    resize.observe(container.current!)

    // Two fingers spread or pinched on the page zoom it.
    const surface = container.current!
    let pinch: { distance: number; scale: number } | null = null
    const spread = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
    const onTouchStart = (e: TouchEvent) => { if (e.touches.length === 2) pinch = { distance: spread(e), scale: viewer.currentScale } }
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return
      e.preventDefault()
      fitted.current = false
      const scale = Math.max(0.3, Math.min(5, pinch.scale * (spread(e) / pinch.distance)))
      if (Math.abs(scale - viewer.currentScale) / viewer.currentScale > 0.04) viewer.currentScale = scale
    }
    const onTouchEnd = () => { pinch = null }
    surface.addEventListener('touchstart', onTouchStart, { passive: true })
    surface.addEventListener('touchmove', onTouchMove, { passive: false })
    surface.addEventListener('touchend', onTouchEnd)

    let task: pdfjs.PDFDocumentLoadingTask | undefined
    // Drawings made on the pages are kept as a copy of the PDF with them in it (drawings.pdf, beside the
    // notes), and that copy is what opens next time. It is only trusted for the very file it was made from.
    const notebook = baseName(file.name)
    const madeFrom = `sidepage:drawings:${file.name}`
    const withDrawings = Number(localStorage.getItem(madeFrom)) === file.size ? loadNoteFile(notebook, 'drawings.pdf') : Promise.resolve(null)
    withDrawings.then(kept => (kept ?? file).arrayBuffer()).then(data => {
      if (cancelled) return
      task = pdfjs.getDocument({ data })
      return task.promise.then(pdf => {
        if (cancelled) return
        const keep = debounce(async () => {
          try {
            const copy = await pdf.saveDocument()
            pdf.annotationStorage.resetModified()
            await saveNoteFile(notebook, 'drawings.pdf', new Blob([copy as BlobPart], { type: 'application/pdf' }))
            localStorage.setItem(madeFrom, String(file.size))
          } catch {
            // The drawing stays on screen; it will be kept at the next change.
          }
        }, 2000)
        ;(pdf.annotationStorage as unknown as { onSetModified: (() => void) | null }).onSetModified = keep
        keepDrawings.current = keep
        viewer.setDocument(pdf)
        linkService.setDocument(pdf)
        setDoc(pdf)
        // The PDF's own table of contents, where it has one.
        type Entry = { title: string; dest: string | unknown[] | null; items: Entry[] }
        const flat = (items: Entry[], depth = 0): { label: string; depth: number; go(): void }[] => items.flatMap(item => [
          { label: item.title, depth, go: () => { if (item.dest) void linkService.goToDestination(item.dest as string) } },
          ...flat(item.items ?? [], depth + 1),
        ])
        void pdf.getOutline().then(outline => { if (!cancelled) setContents(flat((outline ?? []) as Entry[])) }).catch(() => {})
        // The book's words, page by page, so it can be found by them later. Done once, a little at a time.
        void hasWords(file.name).then(async known => {
          if (known) return
          const pages: Stretch[] = []
          for (let number = 1; number <= Math.min(pdf.numPages, 2000) && !cancelled; number++) {
            const content = await (await pdf.getPage(number)).getTextContent()
            pages.push({ place: `page=${number}`, text: content.items.map(item => ('str' in item ? item.str : '')).join(' ') })
            if (number % 10 === 0) await new Promise(resolve => setTimeout(resolve, 30))
          }
          if (!cancelled) await keepWords(file.name, pages)
        }).catch(() => {})
        // The first page, small, as the book's cover on the home screen.
        void pdf.getPage(1).then(async first => {
          const viewport = first.getViewport({ scale: 320 / first.getViewport({ scale: 1 }).width })
          const cover = document.createElement('canvas')
          cover.width = viewport.width
          cover.height = viewport.height
          await first.render({ canvas: cover, canvasContext: cover.getContext('2d')!, viewport }).promise
          await saveCover(file.name, cover)
        }).catch(() => {})
      })
    }).catch(e => setError(String(e?.message ?? e)))

    return () => {
      cancelled = true
      resize.disconnect()
      surface.removeEventListener('touchstart', onTouchStart)
      surface.removeEventListener('touchmove', onTouchMove)
      surface.removeEventListener('touchend', onTouchEnd)
      task?.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  // Flip mode shows rendered page images, a chunk at a time so long books stay light.
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
        const viewport = pdfPage.getViewport({ scale: 1.6 })
        if (n === first) ratio = viewport.height / viewport.width
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        await pdfPage.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
        // Shade the page for the theme, then put its pictures back as they were.
        const shaded = document.createElement('canvas')
        shaded.width = canvas.width
        shaded.height = canvas.height
        const ink = shaded.getContext('2d')!
        ink.filter = pageFilter(theme)
        ink.drawImage(canvas, 0, 0)
        ink.filter = 'none'
        if (theme === 'dark') {
          const pictures = await picturesOf(pdfPage, viewport, canvas).catch(() => null)
          if (pictures) ink.drawImage(pictures, 0, 0)
        }
        const blob = await new Promise<Blob | null>(resolve => shaded.toBlob(resolve, 'image/jpeg', 0.85))
        if (blob) urls.push(URL.createObjectURL(blob))
      }
      if (!cancelled) setFlip({ pages: urls, ratio, first })
    })()
    return () => {
      cancelled = true
      setFlip(null)
      urls.forEach(url => URL.revokeObjectURL(url))
    }
    // The chunk is chosen when flip mode is entered; flipping inside it must not re-render it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, doc, theme])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!doc || !viewer) return
    const { HIGHLIGHT, INK, NONE } = pdfjs.AnnotationEditorType
    // PDF.js sets its editor up a moment after the document loads, and not at all for some files.
    // So it is only touched once the reader picks a tool.
    if (tool === 'none' && !toolUsed.current) return
    try {
      viewer.annotationEditorMode = { mode: tool === 'highlight' ? HIGHLIGHT : tool === 'draw' ? INK : NONE }
      // Putting the pen down is a good moment to keep what was drawn.
      if (tool === 'none') keepDrawings.current()
      toolUsed.current = true
    } catch {
      setTool('none')
    }
  }, [tool, doc])

  // Highlights and drawings are written into a copy of the PDF itself.
  const saveCopy = async () => {
    if (doc) await saveFileAs(`${baseName(file.name)} (annotated).pdf`, await doc.saveDocument())
  }

  // A link in a note brings the reader to its page.
  useEffect(() => onGoToPlace(({ book, place }) => {
    if (book !== file.name || !viewerRef.current) return
    setMode('scroll')
    viewerRef.current.currentPageNumber = Number(place.match(/page=(\d+)/)?.[1]) || 1
  }), [file])

  // Find in the PDF with PDF.js's own find controller: every match is highlighted, Enter steps through them.
  const find = (query: string, again: boolean) => {
    bus.current?.dispatch('find', {
      source: null, type: again ? 'again' : '', query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: false,
    })
  }
  const clearFind = () => {
    setMatches('')
    bus.current?.dispatch('findbarclose', { source: null })
  }

  const leaveFlip = () => {
    rememberFlip(false)
    setMode('scroll')
    requestAnimationFrame(() => { if (viewerRef.current) viewerRef.current.currentPageNumber = page })
  }

  // Quote: highlight the passage and send it to the notes with a link back to its page.
  const quote = () => {
    const passage = highlight()
    if (passage) sendQuote({ text: passage.text, source: `${baseName(file.name)}, p. ${passage.page}`, book: file.name, place: `page=${passage.page}` })
  }

  // Hands-free reading: the page drifts upward by itself, slowly or faster, until it is touched off.
  const [drift, setDrift] = useState(0)
  useEffect(() => {
    if (!drift || mode !== 'scroll') return
    // Timed rather than tied to the screen's refresh, so the pace is the same on every device.
    let carried = 0
    const timer = setInterval(() => {
      const pages = container.current
      if (!pages) return
      carried += drift * 0.32
      const whole = Math.floor(carried)
      if (whole) { pages.scrollTop += whole; carried -= whole }
      if (pages.scrollTop + pages.clientHeight >= pages.scrollHeight - 2) setDrift(0)
    }, 16)
    return () => clearInterval(timer)
  }, [drift, mode])

  // Two pages side by side like an open book, and pages turned on their side.
  const [spread, setSpread] = useState(false)
  const toggleSpread = () => {
    const viewer = viewerRef.current
    if (!viewer?.pdfDocument) return
    viewer.spreadMode = spread ? 0 : 1
    setSpread(!spread)
    viewer.currentScaleValue = 'page-fit'
  }
  const rotate = () => { const viewer = viewerRef.current; if (viewer?.pdfDocument) viewer.pagesRotation = (viewer.pagesRotation + 90) % 360 }
  const fitPage = () => { fitted.current = false; if (viewerRef.current?.pdfDocument) viewerRef.current.currentScaleValue = 'page-fit' }
  // Typing a page number into the counter goes there.
  const [jumping, setJumping] = useState(false)

  const go = (delta: number) => {
    const viewer = viewerRef.current
    if (viewer) viewer.currentPageNumber = Math.min(Math.max(1, page + delta), doc?.numPages ?? 1)
  }

  if (error) return <div className="viewer-message">Could not open this PDF: {error}</div>

  return (
    <div className="viewer">
      <div className="viewer-bar">
        {mode === 'scroll' && <>
          <Tool quiet icon={ChevronLeft} label="Previous page" onClick={() => go(-1)} />
          <Tool quiet icon={ChevronRight} label="Next page" onClick={() => go(1)} />
        </>}
        {mode === 'scroll' && <ContentsMenu items={contents} onGo={() => {}} />}
        {mode === 'scroll' && <Tool quiet icon={LayoutGrid} label="All pages" hint="See every page at a glance" on={overview} onClick={() => setOverview(!overview)} />}
        {jumping
          ? <input
              className="page-jump" type="number" autoFocus min={1} max={doc?.numPages} defaultValue={page} aria-label="Go to page"
              onBlur={() => setJumping(false)}
              onKeyDown={e => {
                if (e.key === 'Escape') setJumping(false)
                if (e.key !== 'Enter') return
                go(Number(e.currentTarget.value) - page)
                setJumping(false)
              }}
            />
          : <button className="viewer-pos" title="Go to a page" onClick={() => mode === 'scroll' && setJumping(true)}>{page} / {doc?.numPages ?? '…'}</button>}
        <span className="spacer" />
        {mode === 'scroll' && <>
          <Tool quiet icon={ZoomOut} label="Zoom out" onClick={() => zoomBy(1 / 1.2)} />
          <button className="zoom-level" title="Fit the page to the panel's width" onClick={fitWidth}>{zoom}%</button>
          <Tool quiet icon={ZoomIn} label="Zoom in" onClick={() => zoomBy(1.2)} />
          <Menu quiet icon={Eye} label="View" hint="How the pages are laid out" on={spread || drift > 0}>
            <Tool icon={MoveHorizontal} label="Fit the width" onClick={fitWidth} />
            <Tool icon={Maximize} label="Fit the whole page" onClick={fitPage} />
            <Tool icon={BookCopy} label={spread ? 'One page at a time' : 'Two pages side by side'} on={spread} onClick={toggleSpread} />
            <Tool icon={RotateCw} label="Turn the pages a quarter" onClick={rotate} />
            <p className="menu-head">Scroll by itself</p>
            <div className="menu-line">
              {[['Off', 0], ['Slow', 1], ['Steady', 2], ['Fast', 4]].map(([name, speed]) => (
                <button key={name} className={drift === speed ? 'menu-item on' : 'menu-item'} onClick={() => setDrift(speed as number)}>{name}</button>
              ))}
            </div>
          </Menu>
          {drift > 0 && <Tool quiet icon={ChevronsDown} label="Stop scrolling" on onClick={() => setDrift(0)} />}
          <BookmarksMenu marks={bookmarks} here={{ place: `page=${page}`, label: `Page ${page}` }} onGo={place => go(Number(place.replace('page=', '')) - page)} />
          <SearchBox onSearch={find} onClear={clearFind} status={matches} />
          <HighlightsMenu marks={highlights} onHighlight={color => void highlight(color)} onGo={place => go(pageOf(place) - page)} onChange={changeHighlight} onRemove={removeHighlight} />
          <Tool icon={Crop} label="Clip" hint="Drag a box over part of a page to put it in your notes as a picture" on={clipping} onClick={() => setClipping(!clipping)} />
          <Tool icon={Pencil} label="Draw" hint="Draw on the page" on={tool === 'draw'} onClick={() => setTool(t => (t === 'draw' ? 'none' : 'draw'))} />
          <Tool icon={Download} label="Save copy" hint="Save a copy of the PDF with your highlights and drawings" onClick={() => void saveCopy()} />
          <Tool icon={TextQuote} label="Quote" hint="Copy the selected text into your notes" onClick={quote} />
          <Tool icon={BookA} label="Look up" hint="What the selected word means" onClick={() => lookUp(window.getSelection()?.toString())} />
          {canSpeak && <Tool icon={voice.speaking ? Square : Volume2} label={voice.speaking ? 'Stop reading' : 'Read aloud'} on={voice.speaking} onClick={readAloud} />}
        </>}
        <Tool icon={BookOpen} label="Flip" hint="Turn pages like paper" on={mode === 'flip'} onClick={() => (mode === 'flip' ? leaveFlip() : (rememberFlip(true), setMode('flip')))} />
      </div>
      <div className="viewer-body">
        <div
          ref={container}
          className="pdf-container"
          style={{ visibility: mode === 'scroll' ? undefined : 'hidden' }}
          // A stylus touching the page means writing on it: switch to Draw without being asked.
          onPointerDownCapture={e => { if (e.pointerType === 'pen' && tool === 'none') setTool('draw') }}
        >
          <div className="pdfViewer" />
        </div>
        {overview && mode === 'scroll' && doc && <PageGrid doc={doc} current={page} onPick={number => { setOverview(false); go(number - page) }} />}
        {clipping && mode === 'scroll' && (
          <div
            className="clip-layer"
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setBox({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY }) }}
            onPointerMove={e => { if (box) setBox({ ...box, x1: e.clientX, y1: e.clientY }) }}
            onPointerUp={() => {
              if (box) clip(box)
              setBox(null)
              setClipping(false)
            }}
          >
            {box && <div className="clip-box" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />}
          </div>
        )}
        {mode === 'flip' && (flip
          ? <FlipBook pages={flip.pages} ratio={flip.ratio} startPage={page - flip.first} onFlip={i => {
              setPage(flip.first + i)
              localStorage.setItem(`sidepage:place:${file.name}`, String(flip.first + i))
            }} />
          : <div className="viewer-message">Preparing pages…</div>)}
      </div>
    </div>
  )
}
