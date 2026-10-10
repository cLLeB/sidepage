import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import 'pdfjs-dist/web/pdf_viewer.css'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import FlipBook from './FlipBook'
import { baseName, saveFileAs, sendQuote } from '../lib/platform'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const FLIP_CHUNK = 80

export default function PdfView({ file }: { file: File }) {
  const container = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PDFViewer | null>(null)
  const toolUsed = useRef(false)
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [mode, setMode] = useState<'scroll' | 'flip'>('scroll')
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
    viewerRef.current = viewer
    const placeKey = `sidepage:place:${file.name}`
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
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
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
  }, [mode, doc])

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

  const leaveFlip = () => {
    setMode('scroll')
    requestAnimationFrame(() => { if (viewerRef.current) viewerRef.current.currentPageNumber = page })
  }

  const quote = () => {
    const text = window.getSelection()?.toString().trim()
    if (text) sendQuote({ text, source: `${baseName(file.name)}, p. ${page}` })
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
          <button onClick={() => setTool(t => (t === 'highlight' ? 'none' : 'highlight'))} className={tool === 'highlight' ? 'on' : ''} title="Select text to highlight it">Highlight</button>
          <button onClick={() => setTool(t => (t === 'draw' ? 'none' : 'draw'))} className={tool === 'draw' ? 'on' : ''} title="Draw on the page">Draw</button>
          <button onClick={() => void saveCopy()} title="Save a copy of the PDF with your highlights and drawings">Save copy</button>
          <button onClick={quote} title="Copy the selected text into your notes">Quote</button>
        </>}
        <button onClick={() => (mode === 'flip' ? leaveFlip() : setMode('flip'))} className={mode === 'flip' ? 'on' : ''}>
          Flip
        </button>
      </div>
      <div className="viewer-body">
        <div ref={container} className="pdf-container" style={{ visibility: mode === 'scroll' ? 'visible' : 'hidden' }}>
          <div className="pdfViewer" />
        </div>
        {mode === 'flip' && (flip
          ? <FlipBook pages={flip.pages} ratio={flip.ratio} startPage={page - flip.first} onFlip={i => setPage(flip.first + i)} />
          : <div className="viewer-message">Preparing pages…</div>)}
      </div>
    </div>
  )
}
