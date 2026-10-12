import { useEffect, useMemo, useRef, useState } from 'react'
import { convertToExcalidrawElements, Excalidraw, exportToCanvas, serializeAsJSON } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import FlipBook from '../viewers/FlipBook'
import { BookOpen, ChevronLeft, ChevronRight, ImageDown, Plus } from 'lucide-react'
import { Tool } from '../ui'
import { baseName, debounce, isShown, loadNote, onClip, saveFileAs, saveNote } from '../lib/platform'
import { useTheme } from '../lib/theme'

type Initial = NonNullable<Parameters<typeof Excalidraw>[0]['initialData']>

const fileOf = (page: number) => (page === 1 ? 'canvas.excalidraw' : `canvas-${page}.excalidraw`)
const SHEET = { width: 800, height: 1120, rule: 32 }

// One page of the notebook: an Excalidraw drawing on ruled, squared, dotted or blank paper.
function CanvasPage({ notebook, file, latest }: { notebook: string; file: string; latest: { current: string | null } }) {
  const host = useRef<HTMLDivElement>(null)
  const [initial, setInitial] = useState<Initial | null>(null)
  const theme = useTheme()
  const drawing = useRef<ExcalidrawImperativeAPI | null>(null)

  // A clip from a page lands here, as a picture in the middle of what is in view, when this page of the
  // Canvas is the note in front.
  useEffect(() => onClip(async ({ image, book }) => {
    const board = drawing.current
    if (baseName(book) !== notebook || !board || !isShown(host.current)) return
    const picture = new Image()
    picture.src = image
    await picture.decode()
    const id = `clip-${Date.now().toString(36)}` as Parameters<typeof board.addFiles>[0][number]['id']
    board.addFiles([{ id, dataURL: image as Parameters<typeof board.addFiles>[0][number]['dataURL'], mimeType: 'image/jpeg', created: Date.now() }])
    const view = board.getAppState()
    const width = Math.min(picture.naturalWidth, (view.width / view.zoom.value) * 0.7)
    const height = width * (picture.naturalHeight / picture.naturalWidth)
    const [placed] = convertToExcalidrawElements([{
      type: 'image',
      fileId: id,
      x: -view.scrollX + (view.width / view.zoom.value - width) / 2,
      y: -view.scrollY + (view.height / view.zoom.value - height) / 2,
      width,
      height,
    }])
    board.updateScene({ elements: [...board.getSceneElements(), placed] })
  }), [notebook])
  const save = useMemo(() => debounce((json: string) => { void saveNote(notebook, file, json) }, 800), [notebook, file])

  useEffect(() => {
    let cancelled = false
    latest.current = null
    loadNote(notebook, file).then(saved => {
      if (cancelled) return
      const data = saved ? JSON.parse(saved) : {}
      setInitial({ ...data, appState: { ...data.appState, viewBackgroundColor: 'transparent' } })
    })
    return () => { cancelled = true }
  }, [notebook, file, latest])

  if (!initial) return <div className="canvas-page paper" />

  return (
    <div
      ref={host}
      className="canvas-page paper"
      // A stylus (Apple Pencil, S Pen, Surface Pen) means writing: pick up the pen tool without being asked.
      onPointerDownCapture={e => {
        if (e.pointerType === 'pen' && drawing.current?.getAppState().activeTool.type === 'selection') drawing.current.setActiveTool({ type: 'freedraw' })
      }}
    >
      <Excalidraw
        initialData={initial}
        excalidrawAPI={api => { drawing.current = api }}
        theme={theme === 'dark' ? 'dark' : 'light'}
        onChange={(elements, appState, files) => {
          // The paper sits behind the drawing and follows its pan and zoom.
          const style = host.current?.style
          const zoom = appState.zoom.value
          style?.setProperty('--paper-zoom', String(zoom))
          style?.setProperty('--paper-x', `${appState.scrollX * zoom}px`)
          style?.setProperty('--paper-y', `${appState.scrollY * zoom}px`)
          latest.current = serializeAsJSON(elements, appState, files, 'local')
          save(latest.current)
        }}
      />
    </div>
  )
}

// A sheet of the chosen paper with one page's drawing on it, for leafing through.
async function renderSheet(saved: string | null) {
  const sheet = document.createElement('canvas')
  sheet.width = SHEET.width
  sheet.height = SHEET.height
  const ctx = sheet.getContext('2d')!
  const css = getComputedStyle(document.documentElement)
  ctx.fillStyle = css.getPropertyValue('--paper-bg') || '#fffef9'
  ctx.fillRect(0, 0, SHEET.width, SHEET.height)
  ctx.fillStyle = css.getPropertyValue('--paper-line') || '#c5d2e3'
  const paper = document.documentElement.dataset.paper
  for (let y = SHEET.rule; y < SHEET.height; y += SHEET.rule) {
    if (paper === 'lined' || paper === 'grid') ctx.fillRect(0, y, SHEET.width, 1)
    if (paper === 'dots') for (let x = SHEET.rule; x < SHEET.width; x += SHEET.rule) ctx.fillRect(x - 1, y - 1, 2, 2)
  }
  if (paper === 'grid') for (let x = SHEET.rule; x < SHEET.width; x += SHEET.rule) ctx.fillRect(x, 0, 1, SHEET.height)

  const data = saved ? JSON.parse(saved) : null
  if (data?.elements?.some((element: { isDeleted?: boolean }) => !element.isDeleted)) {
    const drawing = await exportToCanvas({
      elements: data.elements,
      appState: { ...data.appState, exportBackground: false, exportWithDarkMode: document.documentElement.dataset.theme === 'dark' },
      files: data.files ?? null,
      exportPadding: 0,
    })
    const margin = 40
    const scale = Math.min(1, (SHEET.width - margin * 2) / drawing.width, (SHEET.height - margin * 2) / drawing.height)
    ctx.drawImage(drawing, margin, margin, drawing.width * scale, drawing.height * scale)
  }
  const blob = await new Promise<Blob | null>(resolve => sheet.toBlob(resolve, 'image/png'))
  return URL.createObjectURL(blob!)
}

// Free pages for handwriting, sketches and diagrams (Excalidraw), saved as canvas.excalidraw, canvas-2.excalidraw, …
export default function CanvasNote({ notebook }: { notebook: string }) {
  const [count, setCount] = useState(1)
  const [page, setPage] = useState(1)
  const [sheets, setSheets] = useState<string[] | null>(null)
  const latest = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setPage(1)
    ;(async () => {
      let pages = 1
      while ((await loadNote(notebook, fileOf(pages + 1))) !== null) pages++
      if (!cancelled) setCount(pages)
    })()
    return () => { cancelled = true }
  }, [notebook])

  const flush = async () => {
    if (latest.current) await saveNote(notebook, fileOf(page), latest.current)
  }

  const turnTo = async (next: number) => {
    await flush()
    if (next > count) {
      await saveNote(notebook, fileOf(next), '{}')
      setCount(next)
    }
    setPage(next)
  }

  const toggleFlip = async () => {
    if (sheets) {
      sheets.forEach(url => URL.revokeObjectURL(url))
      return setSheets(null)
    }
    await flush()
    const urls: string[] = []
    for (let n = 1; n <= count; n++) urls.push(await renderSheet(await loadNote(notebook, fileOf(n))))
    setSheets(urls)
  }

  // The drawing on this page, on white, as a PNG.
  const savePicture = async () => {
    const data = JSON.parse((await loadNote(notebook, fileOf(page))) ?? 'null')
    if (!data?.elements?.some((element: { isDeleted?: boolean }) => !element.isDeleted)) return
    const drawn = await exportToCanvas({ elements: data.elements, appState: { ...data.appState, exportBackground: true, viewBackgroundColor: '#ffffff' }, files: data.files ?? null, exportPadding: 24 })
    const blob = await new Promise<Blob | null>(resolve => drawn.toBlob(resolve, 'image/png'))
    if (blob) await saveFileAs(`${notebook} canvas ${page}.png`, new Uint8Array(await blob.arrayBuffer()))
  }

  return (
    <div className="note canvas-note">
      {sheets
        ? <FlipBook pages={sheets} ratio={SHEET.height / SHEET.width} startPage={page - 1} onFlip={i => setPage(i + 1)} />
        : <CanvasPage key={`${notebook}/${page}`} notebook={notebook} file={fileOf(page)} latest={latest} />}
      <div className="page-bar">
        {!sheets && <Tool quiet icon={ChevronLeft} label="Previous page" disabled={page === 1} onClick={() => void turnTo(page - 1)} />}
        <span className="viewer-pos">Page {page} / {count}</span>
        {!sheets && <>
          <Tool quiet icon={ChevronRight} label="Next page" disabled={page === count} onClick={() => void turnTo(page + 1)} />
          <Tool icon={Plus} label="Page" hint="Add a page at the end" onClick={() => void turnTo(count + 1)} />
        </>}
        {!sheets && <Tool icon={ImageDown} label="Save as a picture" hint="Save this page of drawing as a PNG picture" onClick={() => void savePicture()} />}
        <Tool icon={BookOpen} label="Flip" hint="Leaf through the notebook" on={!!sheets} onClick={() => void toggleFlip()} />
      </div>
    </div>
  )
}
