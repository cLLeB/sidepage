import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import 'pdfjs-dist/web/pdf_viewer.css'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import FlipBook from './FlipBook'
import SearchBox from './SearchBox'
import { pageFilter, useTheme } from '../lib/theme'
import { baseName, onGoToPlace, prefersFlip, rememberFlip, saveFileAs, sendQuote } from '../lib/platform'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const FLIP_CHUNK = 80

type Box = [left: number, top: number, right: number, bottom: number]

// Where the pictures sit on a page, as fractions of its width and height. Read from the page's drawing
// instructions: each picture is a unit square placed by the transform in force when it is painted.
async function pictureBoxes(page: pdfjs.PDFPageProxy): Promise<Box[]> {
  const { OPS, Util } = pdfjs
  const viewport = page.getViewport({ scale: 1 })
  const { fnArray, argsArray } = await page.getOperatorList()
  const stack: number[][] = []
  let matrix = viewport.transform
  const boxes: Box[] = []
  fnArray.forEach((fn, i) => {
    const args = argsArray[i]
    if (fn === OPS.save || fn === OPS.beginGroup) stack.push(matrix)
    else if (fn === OPS.restore || fn === OPS.endGroup || fn === OPS.paintFormXObjectEnd) matrix = stack.pop() ?? matrix
    else if (fn === OPS.transform) matrix = Util.transform(matrix, args)
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(matrix)
      if (args?.[0]) matrix = Util.transform(matrix, args[0])
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat) {
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]])
      const xs = corners.map(c => c[0] / viewport.width)
      const ys = corners.map(c => c[1] / viewport.height)
      boxes.push([Math.max(0, Math.min(...xs)), Math.max(0, Math.min(...ys)), Math.min(1, Math.max(...xs)), Math.min(1, Math.max(...ys))])
    }
  })
  return boxes
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
    // Mark where each page's pictures are, so a dark theme can leave them in their real colours (see index.css).
    eventBus.on('pagerendered', async (e: { pageNumber: number; source: { div: HTMLElement; pdfPage?: pdfjs.PDFPageProxy } }) => {
      const wrapper = e.source.div.querySelector('.canvasWrapper')
      if (!wrapper || !e.source.pdfPage) return
      const boxes = await pictureBoxes(e.source.pdfPage).catch(() => [])
      wrapper.querySelectorAll('.picture-keep').forEach(old => old.remove())
      for (const [left, top, right, bottom] of boxes) {
        const keep = document.createElement('div')
        keep.className = 'picture-keep'
        keep.style.cssText = `left:${left * 100}%;top:${top * 100}%;width:${(right - left) * 100}%;height:${(bottom - top) * 100}%`
        wrapper.append(keep)
      }
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
          for (const [left, top, right, bottom] of await pictureBoxes(pdfPage).catch(() => [])) {
            const [x, y, w, h] = [left * canvas.width, top * canvas.height, (right - left) * canvas.width, (bottom - top) * canvas.height]
            if (w >= 1 && h >= 1) ink.drawImage(canvas, x, y, w, h, x, y, w, h)
          }
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
          <button onClick={() => go(-1)} title="Previous page">‹</button>
          <button onClick={() => go(1)} title="Next page">›</button>
        </>}
        <span className="viewer-pos">{page} / {doc?.numPages ?? '…'}</span>
        <span className="spacer" />
        {mode === 'scroll' && <>
          <SearchBox onSearch={find} onClear={clearFind} status={matches} />
          <button onClick={() => setTool(t => (t === 'highlight' ? 'none' : 'highlight'))} className={tool === 'highlight' ? 'on' : ''} title="Select text to highlight it">Highlight</button>
          <button onClick={() => setTool(t => (t === 'draw' ? 'none' : 'draw'))} className={tool === 'draw' ? 'on' : ''} title="Draw on the page">Draw</button>
          <button onClick={() => void saveCopy()} title="Save a copy of the PDF with your highlights and drawings">Save copy</button>
          <button onClick={quote} title="Copy the selected text into your notes">Quote</button>
        </>}
        <button onClick={() => (mode === 'flip' ? leaveFlip() : (rememberFlip(true), setMode('flip')))} className={mode === 'flip' ? 'on' : ''}>
          Flip
        </button>
      </div>
      <div className="viewer-body">
        <div
          ref={container}
          className="pdf-container"
          style={{ visibility: mode === 'scroll' ? 'visible' : 'hidden' }}
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
