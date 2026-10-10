import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { PageFlip } from 'page-flip'

// What foliate-js exposes for each chapter of a book.
type Section = { load(): Promise<string>; unload?(): void; linear?: string }
export type CurlPlace = { index: number; fraction: number }
export type CurlHandle = { next(): void; previous(): void; selectedText(): string }

const PAD_X = 34
const PAD_Y = 40

// One chapter's markup and stylesheets, taken from the document foliate-js prepares for it.
async function readChapter(section: Section) {
  const response = await fetch(await section.load())
  const type = response.headers.get('content-type')?.includes('xhtml') ? 'application/xhtml+xml' : 'text/html'
  const doc = new DOMParser().parseFromString(await response.text(), type)
  const flow = document.createElement('div')
  flow.className = 'flow'
  flow.append(...[...doc.body.childNodes].map(node => document.importNode(node, true)))
  flow.querySelectorAll('script').forEach(script => script.remove())
  const styles = [...doc.querySelectorAll('link[rel~="stylesheet"], style')].map(node => document.importNode(node, true))
  return { flow, styles }
}

const layoutCss = (width: number, height: number) => `
  :host { display: block; position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: var(--paper-bg, #fffef9); color: #1c1d21; }
  .clip { position: absolute; inset: ${PAD_Y}px ${PAD_X}px; overflow: hidden; }
  .flow {
    height: 100%;
    column-width: ${width - PAD_X * 2}px;
    column-gap: ${PAD_X * 2}px;
    column-fill: auto;
    font: 17px/1.6 Georgia, 'Times New Roman', serif;
    overflow-wrap: break-word;
  }
  .flow img, .flow svg, .flow video { max-width: 100%; max-height: ${height - PAD_Y * 2}px; break-inside: avoid; }
  .flow p, .flow li { orphans: 2; widows: 2; }
  .turn { position: absolute; inset: 0; display: grid; place-items: center; color: #8a8d96; font: 14px system-ui, sans-serif; }
`

// A page of the chapter: the whole chapter laid out in page-wide columns, shifted so one column shows.
function makePage(chapter: Awaited<ReturnType<typeof readChapter>>, width: number, height: number, column: number | null, label = '') {
  const page = document.createElement('div')
  page.className = 'curl-page'
  const root = page.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = layoutCss(width, height)
  if (column === null) {
    const turn = document.createElement('div')
    turn.className = 'turn'
    turn.textContent = label
    root.append(style, turn)
    return page
  }
  const clip = document.createElement('div')
  clip.className = 'clip'
  const flow = chapter.flow.cloneNode(true) as HTMLElement
  flow.style.transform = `translateX(${-column * width}px)`
  clip.append(flow)
  root.append(...chapter.styles.map(node => node.cloneNode(true)), style, clip)
  return page
}

// Books with flowing text (EPUB, MOBI, FB2) as paper pages that curl when turned: StPageFlip turns them,
// the browser's own column layout decides what fits on each page.
export default function CurlBook({ sections, start, onPlace, ref }: {
  sections: Section[]
  start: CurlPlace
  onPlace(place: CurlPlace): void
  ref?: Ref<CurlHandle>
}) {
  const host = useRef<HTMLDivElement>(null)
  const flipRef = useRef<{ flipNext(): void; flipPrev(): void } | null>(null)
  const [place, setPlace] = useState(start)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const latest = useRef(place)
  const report = useRef(onPlace)
  report.current = onPlace

  useImperativeHandle(ref, () => ({
    next: () => flipRef.current?.flipNext(),
    previous: () => flipRef.current?.flipPrev(),
    selectedText: () => {
      for (const page of host.current?.querySelectorAll('.curl-page') ?? []) {
        const root = page.shadowRoot as (ShadowRoot & { getSelection?(): Selection | null }) | null
        const text = (root?.getSelection?.() ?? document.getSelection())?.toString().trim()
        if (text) return text
      }
      return ''
    },
  }))

  // Two facing pages when there is room, one page in a narrow panel.
  useEffect(() => {
    const el = host.current!
    let timer: ReturnType<typeof setTimeout>
    const measure = () => {
      const spread = el.clientWidth >= 720
      const height = Math.max(240, el.clientHeight - 24)
      const width = Math.floor(Math.max(200, Math.min(spread ? (el.clientWidth - 24) / 2 : el.clientWidth - 24, height * 0.78)))
      setSize(current => (current?.width === width && current.height === height ? current : { width, height }))
    }
    const observer = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(measure, 200) })
    observer.observe(el)
    measure()
    return () => { observer.disconnect(); clearTimeout(timer) }
  }, [])

  // Build the chapter's pages. Runs again when the chapter or the page size changes, not on every page turn.
  const chapterIndex = place.index
  useEffect(() => {
    if (!size || !host.current) return
    let cancelled = false
    let flip: InstanceType<typeof PageFlip> | undefined
    const el = host.current
    const section = sections[chapterIndex]
    ;(async () => {
      const chapter = await readChapter(section)
      if (cancelled) return

      // Lay the chapter out once, unseen, to count its pages.
      const probe = makePage(chapter, size.width, size.height, 0)
      probe.style.cssText = 'position:absolute;visibility:hidden;left:-99999px;top:0'
      el.append(probe)
      const sheets = [...probe.shadowRoot!.querySelectorAll<HTMLLinkElement>('link')]
      await Promise.all(sheets.map(link => link.sheet ? null : new Promise(resolve => { link.onload = link.onerror = resolve })))
      await Promise.all([...probe.shadowRoot!.querySelectorAll('img')].map(img => img.complete ? null : new Promise(resolve => { img.onload = img.onerror = resolve })))
      await new Promise(resolve => requestAnimationFrame(resolve))
      const flowWidth = probe.shadowRoot!.querySelector('.flow')!.scrollWidth
      probe.remove()
      if (cancelled) return
      const count = Math.max(1, Math.ceil((flowWidth + PAD_X * 2) / size.width))

      // A leaf before and after the chapter leads to its neighbours, so turning never stops at a chapter's edge.
      const before = chapterIndex > 0
      const after = chapterIndex < sections.length - 1
      const pages = [
        ...(before ? [makePage(chapter, size.width, size.height, null, '‹ previous chapter')] : []),
        ...Array.from({ length: count }, (_, column) => makePage(chapter, size.width, size.height, column)),
        ...(after ? [makePage(chapter, size.width, size.height, null, 'next chapter ›')] : []),
      ]
      const root = document.createElement('div')
      el.append(root)
      const first = (before ? 1 : 0) + Math.min(count - 1, Math.round(latest.current.fraction * (count - 1)))
      flip = new PageFlip(root, {
        width: size.width,
        height: size.height,
        size: 'fixed',
        startPage: first,
        maxShadowOpacity: 0.35,
        flippingTime: 700,
        mobileScrollSupport: false,
        // Turn from the page corners or by swiping, so text in the middle can still be selected.
        disableFlipByClick: true,
      })
      flip.loadFromHTML(pages)
      flipRef.current = flip
      flip.on('flip', (e: { data: number }) => {
        const column = e.data - (before ? 1 : 0)
        if (column < 0) return setPlace(latest.current = { index: chapterIndex - 1, fraction: 1 })
        if (column >= count) return setPlace(latest.current = { index: chapterIndex + 1, fraction: 0 })
        latest.current = { index: chapterIndex, fraction: count > 1 ? column / (count - 1) : 0 }
        report.current(latest.current)
      })
      report.current(latest.current)
    })()
    return () => {
      cancelled = true
      flipRef.current = null
      flip?.destroy()
      el.replaceChildren()
      section.unload?.()
    }
  }, [sections, chapterIndex, size])

  return (
    <div
      ref={host}
      className="flipbook curl-book"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') flipRef.current?.flipNext()
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') flipRef.current?.flipPrev()
      }}
    />
  )
}
