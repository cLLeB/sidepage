import { useEffect, useRef } from 'react'
import { PageFlip } from 'page-flip'

// Page-turn view (StPageFlip). `pages` are image URLs, `ratio` is page height / width.
// `tinted` marks pages that are plain pictures (scans, slides), which the theme can only shade as a whole.
export default function FlipBook({ pages, ratio, startPage = 0, onFlip, tinted = false }: {
  pages: string[]
  ratio: number
  startPage?: number
  onFlip?: (page: number) => void
  tinted?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!host.current || !pages.length) return
    // PageFlip removes its root element on destroy, so it gets a throwaway child.
    const root = document.createElement('div')
    host.current.append(root)
    const flip = new PageFlip(root, {
      width: 600,
      height: Math.round(600 * ratio),
      size: 'stretch',
      minWidth: 240,
      maxWidth: 1600,
      minHeight: 240,
      maxHeight: 2400,
      startPage,
      maxShadowOpacity: 0.4,
      mobileScrollSupport: false,
    })
    // Each page is a real picture in the page, so the browser draws it at the screen's full sharpness.
    const leaves = pages.map(url => {
      const leaf = document.createElement('div')
      leaf.className = 'flip-leaf'
      const picture = document.createElement('img')
      picture.src = url
      picture.alt = ''
      picture.draggable = false
      leaf.append(picture)
      return leaf
    })
    root.append(...leaves)
    flip.loadFromHTML(leaves)
    flip.on('flip', (e: { data: number }) => onFlip?.(e.data))
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') flip.flipNext()
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') flip.flipPrev()
    }
    host.current.addEventListener('keydown', onKey)
    const el = host.current
    return () => {
      el.removeEventListener('keydown', onKey)
      flip.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, ratio])

  return <div ref={host} className={tinted ? 'flipbook tinted' : 'flipbook'} tabIndex={0} />
}
