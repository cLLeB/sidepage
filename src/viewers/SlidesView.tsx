import { useEffect, useRef, useState } from 'react'
import { PageFlip } from 'page-flip'
import type { PptxViewerController } from '@extend-ai/react-pptx'

// How many slides either side of the open one are kept drawn. The rest are bare sheets until they come near.
const NEARBY = 3

// A PowerPoint deck as a book to leaf through. Each page is a real slide (text, shapes and pictures drawn by
// react-pptx, the same as in the normal view), turned by StPageFlip. Because the pages are real slides and not
// photographs of them, the dark theme can recolour them and leave their pictures alone.
export default function SlidesView({ controller, count, start, onSlide }: {
  controller: PptxViewerController
  count: number
  start: number
  onSlide(index: number): void
}) {
  const host = useRef<HTMLDivElement>(null)
  const flipRef = useRef<{ flipNext(): void; flipPrev(): void } | null>(null)
  const [room, setRoom] = useState<{ width: number; height: number } | null>(null)
  const at = useRef(start)
  const report = useRef(onSlide)
  report.current = onSlide

  useEffect(() => {
    const el = host.current!
    let timer: ReturnType<typeof setTimeout>
    const measure = () => {
      const box = getComputedStyle(el)
      const width = Math.floor(el.clientWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight))
      const height = Math.floor(el.clientHeight - parseFloat(box.paddingTop) - parseFloat(box.paddingBottom))
      setRoom(current => (current?.width === width && current.height === height ? current : { width, height }))
    }
    const observer = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(measure, 200) })
    observer.observe(el)
    measure()
    return () => { observer.disconnect(); clearTimeout(timer) }
  }, [])

  useEffect(() => {
    if (!room || !host.current || !count) return
    const el = host.current
    let cancelled = false
    let flip: InstanceType<typeof PageFlip> | undefined
    const drawn = new Map<number, () => void>()

    ;(async () => {
      // One slide drawn unseen gives the deck's shape (4:3, 16:9, …).
      const probe = document.createElement('div')
      probe.style.cssText = 'position:absolute;visibility:hidden;left:-99999px;top:0;width:400px'
      el.append(probe)
      const forget = await controller.renderThumbnail(0, probe, { width: 400 })
      const ratio = (probe.firstElementChild?.getBoundingClientRect().height || 225) / 400
      forget()
      probe.remove()
      if (cancelled) return

      const width = Math.max(200, Math.floor(Math.min(room.width, room.height / ratio)))
      const height = Math.round(width * ratio)
      const leaves = Array.from({ length: count }, () => {
        const leaf = document.createElement('div')
        leaf.className = 'slide-leaf'
        leaf.append(Object.assign(document.createElement('div'), { className: 'slide-skin' }))
        return leaf
      })
      const tend = () => leaves.forEach((leaf, i) => {
        const near = Math.abs(i - at.current) <= NEARBY
        if (near && !drawn.has(i)) {
          drawn.set(i, () => {})
          void controller.renderThumbnail(i, leaf.firstElementChild as HTMLElement, { width }).then(forgetSlide => {
            if (cancelled || !drawn.has(i)) forgetSlide()
            else drawn.set(i, forgetSlide)
          })
        } else if (!near && drawn.has(i)) {
          drawn.get(i)!()
          drawn.delete(i)
          leaf.firstElementChild!.replaceChildren()
        }
      })
      tend()

      const root = document.createElement('div')
      el.append(root)
      flip = new PageFlip(root, {
        width,
        height,
        size: 'fixed',
        startPage: Math.min(at.current, count - 1),
        maxShadowOpacity: 0.35,
        flippingTime: 700,
        mobileScrollSupport: false,
      })
      flip.loadFromHTML(leaves)
      flipRef.current = flip
      flip.on('flip', (e: { data: number }) => {
        at.current = e.data
        report.current(e.data)
        tend()
      })
    })()

    return () => {
      cancelled = true
      flipRef.current = null
      drawn.forEach(forgetSlide => forgetSlide())
      flip?.destroy()
      el.replaceChildren()
    }
  }, [controller, count, room])

  return (
    <div
      ref={host}
      className="flipbook slide-book"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') flipRef.current?.flipNext()
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') flipRef.current?.flipPrev()
      }}
    />
  )
}
