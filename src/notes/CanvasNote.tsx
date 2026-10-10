import { useEffect, useMemo, useRef, useState } from 'react'
import { Excalidraw, exportToCanvas, serializeAsJSON } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import FlipBook from '../viewers/FlipBook'
import { debounce, loadNote, saveNote } from '../lib/platform'
import { useTheme } from '../lib/theme'

type Initial = NonNullable<Parameters<typeof Excalidraw>[0]['initialData']>

const fileOf = (page: number) => (page === 1 ? 'canvas.excalidraw' : `canvas-${page}.excalidraw`)
const SHEET = { width: 800, height: 1120, rule: 32 }

// One page of the notebook: an Excalidraw drawing on ruled, squared, dotted or blank paper.
function CanvasPage({ notebook, file, latest }: { notebook: string; file: string; latest: { current: string | null } }) {
  const host = useRef<HTMLDivElement>(null)
  const [initial, setInitial] = useState<Initial | null>(null)
  const theme = useTheme()
  const drawing = useRef<{ getAppState(): { activeTool: { type: string } }; setActiveTool(tool: { type: 'freedraw' }): void } | null>(null)
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

  return (
    <div className="note canvas-note">
      {sheets
        ? <FlipBook pages={sheets} ratio={SHEET.height / SHEET.width} startPage={page - 1} onFlip={i => setPage(i + 1)} />
        : <CanvasPage key={`${notebook}/${page}`} notebook={notebook} file={fileOf(page)} latest={latest} />}
      <div className="page-bar">
        {!sheets && <button onClick={() => void turnTo(page - 1)} disabled={page === 1} title="Previous page">‹</button>}
        <span className="viewer-pos">Page {page} / {count}</span>
        {!sheets && <>
          <button onClick={() => void turnTo(page + 1)} disabled={page === count} title="Next page">›</button>
          <button onClick={() => void turnTo(count + 1)} title="Add a page at the end">+ Page</button>
        </>}
        <button onClick={() => void toggleFlip()} className={sheets ? 'on' : ''} title="Leaf through the notebook">Flip</button>
      </div>
    </div>
  )
}
