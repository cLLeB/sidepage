import { useEffect, useRef, useState } from 'react'
import FlipBook from './FlipBook'

type Size = { width: number; height: number }
type Task<T> = { run(): Promise<T> }
type DjvuWorker = {
  createDocument(buffer: ArrayBuffer): Promise<void>
  terminate(): void
  doc: {
    getPagesSizes(): Task<Size[]>
    getPage(page: number): { getImageData(): Task<ImageData> }
  }
}

const FLIP_CHUNK = 60
const libraryUrl = () => new URL('djvu/djvu.js', document.baseURI).href

// DjVu.js is a classic script that defines a global; it is loaded once, on first use.
let library: Promise<{ Worker: new (path: string) => DjvuWorker }> | undefined
const loadLibrary = () => (library ??= new Promise((resolve, reject) => {
  const script = document.createElement('script')
  script.src = libraryUrl()
  script.onload = () => resolve((window as unknown as { DjVu: { Worker: new (path: string) => DjvuWorker } }).DjVu)
  script.onerror = () => reject(new Error('DjVu.js did not load'))
  document.head.append(script)
}))

const toCanvas = (image: ImageData) => {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  canvas.getContext('2d')!.putImageData(image, 0, 0)
  return canvas
}

// DjVu books, decoded page by page with DjVu.js.
export default function DjvuView({ file }: { file: File }) {
  const list = useRef<HTMLDivElement>(null)
  const worker = useRef<DjvuWorker | null>(null)
  const [sizes, setSizes] = useState<Size[] | null>(null)
  const [page, setPage] = useState(1)
  const [flip, setFlip] = useState<{ pages: string[]; ratio: number; first: number } | null>(null)
  const [flipping, setFlipping] = useState(false)
  const [error, setError] = useState('')
  const placeKey = `sidepage:place:${file.name}`

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const DjVu = await loadLibrary()
      const instance = new DjVu.Worker(libraryUrl())
      worker.current = instance
      await instance.createDocument(await file.arrayBuffer())
      const pages = await instance.doc.getPagesSizes().run()
      if (!cancelled) setSizes(pages)
    })().catch(e => setError(String(e?.message ?? e)))
    return () => {
      cancelled = true
      worker.current?.terminate()
      worker.current = null
    }
  }, [file])

  // Pages are decoded as they come into view, and the one on screen is remembered.
  useEffect(() => {
    if (!sizes || flipping || !list.current) return
    const slots = [...list.current.children] as HTMLElement[]
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const slot = entry.target as HTMLElement
        const number = Number(slot.dataset.page)
        if (!entry.isIntersecting) continue
        if (entry.intersectionRatio > 0.4 || entry.intersectionRect.height > (entry.rootBounds?.height ?? 0) * 0.4) {
          setPage(number)
          localStorage.setItem(placeKey, String(number))
        }
        if (slot.dataset.drawn) continue
        slot.dataset.drawn = '1'
        void worker.current?.doc.getPage(number).getImageData().run().then(image => slot.replaceChildren(toCanvas(image)))
      }
    }, { root: list.current.parentElement, rootMargin: '600px 0px', threshold: [0, 0.4] })
    slots.forEach(slot => observer.observe(slot))
    const saved = Number(localStorage.getItem(placeKey))
    if (saved > 1 && saved <= slots.length) slots[saved - 1].scrollIntoView()
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizes, flipping])

  useEffect(() => {
    if (!flipping || !sizes || !worker.current) return
    let cancelled = false
    const urls: string[] = []
    const first = Math.floor((page - 1) / FLIP_CHUNK) * FLIP_CHUNK + 1
    const last = Math.min(sizes.length, first + FLIP_CHUNK - 1)
    ;(async () => {
      for (let n = first; n <= last && !cancelled; n++) {
        const canvas = toCanvas(await worker.current!.doc.getPage(n).getImageData().run())
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
        if (blob) urls.push(URL.createObjectURL(blob))
      }
      if (!cancelled) setFlip({ pages: urls, ratio: sizes[first - 1].height / sizes[first - 1].width, first })
    })()
    return () => {
      cancelled = true
      setFlip(null)
      urls.forEach(url => URL.revokeObjectURL(url))
    }
    // The chunk is chosen when flip mode is entered; flipping inside it must not re-render it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipping, sizes])

  if (error) return <div className="viewer-message">Could not open this DjVu file: {error}</div>
  if (!sizes) return <div className="viewer-message">Opening…</div>

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <span className="viewer-pos">{page} / {sizes.length}</span>
        <span className="spacer" />
        <button onClick={() => setFlipping(f => !f)} className={flipping ? 'on' : ''}>Flip</button>
      </div>
      <div className="viewer-body">
        {flipping
          ? flip
            ? <FlipBook pages={flip.pages} ratio={flip.ratio} startPage={page - flip.first} onFlip={i => {
                setPage(flip.first + i)
                localStorage.setItem(placeKey, String(flip.first + i))
              }} />
            : <div className="viewer-message">Preparing pages…</div>
          : <div ref={list} className="slide-list djvu-list">
              {sizes.map((size, i) => (
                <div key={i} data-page={i + 1} className="djvu-page" style={{ aspectRatio: `${size.width} / ${size.height}` }} />
              ))}
            </div>}
      </div>
    </div>
  )
}
