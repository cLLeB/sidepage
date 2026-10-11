import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import 'pdfjs-dist/web/pdf_viewer.css'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import FlipBook from './FlipBook'
import SearchBox from './SearchBox'
import { BookOpen, ChevronLeft, ChevronRight, Download, Highlighter, Pencil, TextQuote } from 'lucide-react'
import { Tool } from '../ui'
import { pageFilter, useTheme } from '../lib/theme'
import { baseName, onGoToPlace, prefersFlip, rememberFlip, saveFileAs, sendQuote } from '../lib/platform'

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
  const bus = useRef<EventBus | null>(null)
  const [matches, setMatches] = useState('')
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(() => Number(localStorage.getItem(`sidepage:place:${file.name}`)) || 1)
  const [mode, setMode] = useState<'scroll' | 'flip'>(() => (prefersFlip() ? 'flip' : 'scroll'))
  const [flip, setFlip] = useState<{ pages: string[]; ratio: number; first: number } | null>(null)
  const [error, setError] = useState('')
  const [tool, setTool] = useState<'none' | 'highlight' | 'draw'>('none')

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
    bus.current = eventBus
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
    })

    const resize = new ResizeObserver(() => {
      if (viewer.pdfDocument && container.current?.clientWidth) viewer.currentScaleValue = 'page-width'
    })
    resize.observe(container.current!)

    let task: pdfjs.PDFDocumentLoadingTask | undefined
    file.arrayBuffer().then(data => {
      if (cancelled) return
      task = pdfjs.getDocument({ data })
      return task.promise.then(pdf => {
        if (cancelled) return
        viewer.setDocument(pdf)
        linkService.setDocument(pdf)
        setDoc(pdf)
      })
    }).catch(e => setError(String(e?.message ?? e)))

    return () => {
      cancelled = true
      resize.disconnect()
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
    viewerRef.current.currentPageNumber = Number(place.replace('page=', '')) || 1
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

  const quote = () => {
    const text = window.getSelection()?.toString().trim()
    if (text) sendQuote({ text, source: `${baseName(file.name)}, p. ${page}`, book: file.name, place: `page=${page}` })
  }

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
        <span className="viewer-pos">{page} / {doc?.numPages ?? '…'}</span>
        <span className="spacer" />
        {mode === 'scroll' && <>
          <SearchBox onSearch={find} onClear={clearFind} status={matches} />
          <Tool icon={Highlighter} label="Highlight" hint="Select text to highlight it" on={tool === 'highlight'} onClick={() => setTool(t => (t === 'highlight' ? 'none' : 'highlight'))} />
          <Tool icon={Pencil} label="Draw" hint="Draw on the page" on={tool === 'draw'} onClick={() => setTool(t => (t === 'draw' ? 'none' : 'draw'))} />
          <Tool icon={Download} label="Save copy" hint="Save a copy of the PDF with your highlights and drawings" onClick={() => void saveCopy()} />
          <Tool icon={TextQuote} label="Quote" hint="Copy the selected text into your notes" onClick={quote} />
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
