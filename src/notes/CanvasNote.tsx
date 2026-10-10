import { useEffect, useRef, useState } from 'react'
import { Excalidraw, serializeAsJSON } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { debounce, loadNote, saveNote } from '../lib/platform'

type Initial = NonNullable<Parameters<typeof Excalidraw>[0]['initialData']>

// Free page for handwriting, sketches and diagrams (Excalidraw), saved as canvas.excalidraw.
export default function CanvasNote({ notebook }: { notebook: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [initial, setInitial] = useState<Initial | null>(null)

  useEffect(() => {
    let cancelled = false
    setInitial(null)
    loadNote(notebook, 'canvas.excalidraw').then(saved => {
      if (cancelled) return
      const data = saved ? JSON.parse(saved) : {}
      setInitial({ ...data, appState: { ...data.appState, viewBackgroundColor: 'transparent' } })
    })
    return () => { cancelled = true }
  }, [notebook])

  const save = useRef(debounce((json: string) => { void saveNote(notebook, 'canvas.excalidraw', json) }, 800))
  useEffect(() => {
    save.current = debounce((json: string) => { void saveNote(notebook, 'canvas.excalidraw', json) }, 800)
  }, [notebook])

  if (!initial) return <div className="note paper" />

  return (
    <div ref={host} className="note canvas-note paper">
      <Excalidraw
        initialData={initial}
        onChange={(elements, appState, files) => {
          // The ruled or squared paper sits behind the drawing and follows its pan and zoom.
          const style = host.current?.style
          const zoom = appState.zoom.value
          style?.setProperty('--paper-zoom', String(zoom))
          style?.setProperty('--paper-x', `${appState.scrollX * zoom}px`)
          style?.setProperty('--paper-y', `${appState.scrollY * zoom}px`)
          save.current(serializeAsJSON(elements, appState, files, 'local'))
        }}
      />
    </div>
  )
}
