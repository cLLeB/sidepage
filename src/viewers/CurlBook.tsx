import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { PageFlip } from 'page-flip'

// What foliate-js exposes for each chapter of a book.
// (Chapters are never unloaded here: the reader underneath shares them and looks after their lifetime.)
type Section = { load(): Promise<string> }
export type CurlPlace = { index: number; fraction: number }
// A selection described by where it sits in its chapter, so the reader can turn it into a link back.
type Spot = { path: number[]; offset: number }
export type CurlSelection = { text: string; index: number; start: Spot; end: Spot }
export type CurlHandle = { next(): void; previous(): void; selection(): CurlSelection | null }

type Chapter = { index: number; flow: HTMLElement; style: HTMLStyleElement; leaves: Leaf[]; count: number }
type Leaf = { chapter: Chapter; column: number | null; el: HTMLElement }

// How many pages either side of the open one keep their text. The rest are bare sheets until they come near.
const NEARBY = 3

// One chapter's markup and stylesheets, taken from the document foliate-js prepares for it.
async function readChapter(section: Section, index: number) {
  const response = await fetch(await section.load())
  const type = response.headers.get('content-type')?.includes('xhtml') ? 'application/xhtml+xml' : 'text/html'
  const doc = new DOMParser().parseFromString(await response.text(), type)
  const flow = document.createElement('div')
  flow.className = 'flow'
  flow.append(...[...doc.body.childNodes].map(node => document.importNode(node, true)))
  // Scripts are swapped for empty placeholders, never run; swapping keeps every node's position unchanged.
  flow.querySelectorAll('script').forEach(script => script.replaceWith(Object.assign(document.createElement('span'), { hidden: true })))

  // The book's own CSS, fenced in so it styles the pages of this chapter and nothing else in the app.
  const sheets = await Promise.all([...doc.querySelectorAll<HTMLElement>('link[rel~="stylesheet"], style')].map(node =>
    node instanceof HTMLLinkElement || node.localName === 'link'
      ? fetch(node.getAttribute('href')!).then(r => r.text()).catch(() => '')
      : node.textContent ?? ''))
  const css = sheets.join('\n').replace(/@(charset|import|namespace)[^;]*;/g, '')
  const fonts = css.match(/@font-face\s*\{[^}]*\}/g) ?? []
  const style = document.createElement('style')
  style.textContent = `${fonts.join('\n')}\n@scope (.curl-page[data-chapter="${index}"]) {\n${css.replace(/@font-face\s*\{[^}]*\}/g, '')}\n}`
  return { flow, style }
}

const sheet = (chapter: number) => {
  const el = document.createElement('div')
  el.className = 'curl-page'
  el.dataset.chapter = String(chapter)
  return el
}

// Put the chapter's text on a page: the whole chapter in page-wide columns, shifted so one column shows.
function fill(leaf: Leaf, pageWidth: number) {
  if (leaf.column === null || leaf.el.firstChild) return
  const clip = document.createElement('div')
  clip.className = 'clip'
  const flow = leaf.chapter.flow.cloneNode(true) as HTMLElement
  flow.style.transform = `translateX(${-leaf.column * pageWidth}px)`
  clip.append(flow)
  leaf.el.append(clip)
}

const pathTo = (node: Node, root: Node) => {
  const path: number[] = []
  for (let at = node; at !== root; at = at.parentNode!) path.unshift([...at.parentNode!.childNodes].indexOf(at as ChildNode))
  return path
}

// Books with flowing text (EPUB, MOBI, FB2) as paper pages that curl when turned. StPageFlip turns them and the
// browser's column layout decides what fits on each. Chapters on either side of the open one are kept ready,
// so the pages turn straight through from one chapter into the next.
export default function CurlBook({ sections, start, onPlace, ref }: {
  sections: Section[]
  start: CurlPlace
  onPlace(place: CurlPlace): void
  ref?: Ref<CurlHandle>
}) {
  const host = useRef<HTMLDivElement>(null)
  const flipRef = useRef<{ flipNext(): void; flipPrev(): void } | null>(null)
  const [size, setSize] = useState<{ width: number; height: number; spread: boolean } | null>(null)
  const latest = useRef(start)
  const report = useRef(onPlace)
  report.current = onPlace

  useImperativeHandle(ref, () => ({
    next: () => flipRef.current?.flipNext(),
    previous: () => flipRef.current?.flipPrev(),
    selection: () => {
      const picked = document.getSelection()
      const text = picked?.toString().trim()
      if (!picked || !text || !picked.rangeCount) return null
      const range = picked.getRangeAt(0)
      const flow = (range.startContainer.parentElement ?? host.current)?.closest('.curl-page .flow')
      const page = flow?.closest<HTMLElement>('.curl-page')
      if (!flow || !page || !host.current?.contains(page) || !flow.contains(range.endContainer)) return null
      return {
        text,
        index: Number(page.dataset.chapter),
        start: { path: pathTo(range.startContainer, flow), offset: range.startOffset },
        end: { path: pathTo(range.endContainer, flow), offset: range.endOffset },
      }
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
      setSize(current => (current?.width === width && current.height === height ? current : { width, height, spread }))
    }
    const observer = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(measure, 200) })
    observer.observe(el)
    measure()
    return () => { observer.disconnect(); clearTimeout(timer) }
  }, [])

  useEffect(() => {
    if (!size || !host.current) return
    const el = host.current
    let cancelled = false
    let flip: InstanceType<typeof PageFlip> | undefined
    let idle = true
    let stale = false
    let quiet = false
    const chapters = new Map<number, Chapter>()
    const loading = new Set<number>()
    let pages: Leaf[] = []
    let open: Leaf | undefined

    el.style.setProperty('--curl-w', `${size.width}px`)
    el.style.setProperty('--curl-h', `${size.height}px`)
    const styles = document.createElement('div')
    const root = document.createElement('div')
    el.append(styles, root)

    const load = async (index: number) => {
      if (index < 0 || index >= sections.length || chapters.has(index) || loading.has(index)) return
      loading.add(index)
      try {
        const { flow, style } = await readChapter(sections[index], index)
        if (cancelled) return
        styles.append(style)
        // Lay the chapter out once, unseen, to count its pages.
        const probe = sheet(index)
        probe.style.cssText = `position:absolute;visibility:hidden;left:-99999px;top:0;width:${size.width}px;height:${size.height}px`
        const chapter: Chapter = { index, flow, style, leaves: [], count: 1 }
        el.append(probe)
        fill({ chapter, column: 0, el: probe }, size.width)
        await Promise.all([...probe.querySelectorAll('img')].map(img => img.complete ? null : new Promise(done => { img.onload = img.onerror = done })))
        // (Reading scrollWidth lays the chapter out there and then; no need to wait for a frame.)
        chapter.count = Math.max(1, Math.ceil((probe.querySelector('.flow')!.scrollWidth + 68) / size.width))
        probe.remove()
        if (cancelled) return
        chapter.leaves = Array.from({ length: chapter.count }, (_, column) => ({ chapter, column, el: sheet(index) }))
        // With two pages showing, every chapter fills whole sheets, so chapters always start on the same side.
        if (size.spread && chapter.count % 2) chapter.leaves.push({ chapter, column: null, el: sheet(index) })
        chapters.set(index, chapter)
        stale = true
      } finally {
        loading.delete(index)
      }
    }

    const tend = () => {
      const at = pages.indexOf(open!)
      pages.forEach((leaf, i) => (Math.abs(i - at) <= NEARBY ? fill(leaf, size.width) : leaf.el.replaceChildren()))
    }

    // Keep the open chapter and its two neighbours; rebuild the book around the open page when that set changes.
    const settle = () => {
      if (cancelled || !flip || !open || !idle || !stale) return
      stale = false
      const here = open.chapter.index
      for (const [index, chapter] of chapters) {
        if (Math.abs(index - here) <= 1) continue
        chapter.style.remove()
        chapters.delete(index)
      }
      pages = [...chapters.keys()].sort((a, b) => a - b).flatMap(index => chapters.get(index)!.leaves)
      tend()
      // Putting the book back on the open page is not a page turn, so it is not reported as one.
      quiet = true
      flip.updateFromHtml(pages.map(leaf => leaf.el))
      flip.turnToPage(pages.indexOf(open))
      quiet = false
    }

    const neighbours = () => {
      if (!open) return
      void Promise.all([load(open.chapter.index - 1), load(open.chapter.index + 1)]).then(settle)
    }

    ;(async () => {
      await load(latest.current.index)
      const first = chapters.get(latest.current.index)
      if (cancelled || !first) return
      open = first.leaves[Math.min(first.count - 1, Math.round(latest.current.fraction * (first.count - 1)))]
      pages = first.leaves
      stale = false
      tend()
      flip = new PageFlip(root, {
        width: size.width,
        height: size.height,
        size: 'fixed',
        startPage: pages.indexOf(open),
        maxShadowOpacity: 0.35,
        flippingTime: 700,
        mobileScrollSupport: false,
        // Turn from the page corners or by swiping, so text in the middle can still be selected.
        disableFlipByClick: true,
      })
      flip.loadFromHTML(pages.map(leaf => leaf.el))
      flipRef.current = flip
      flip.on('flip', (e: { data: number }) => {
        const leaf = pages[e.data]
        if (!leaf || quiet) return
        // A blank sheet at a chapter's end counts as that chapter's last page.
        open = leaf.column === null ? leaf.chapter.leaves[leaf.chapter.count - 1] : leaf
        const { chapter, column } = open
        latest.current = { index: chapter.index, fraction: chapter.count > 1 ? column! / (chapter.count - 1) : 0 }
        report.current(latest.current)
        open = leaf
        // Entering another chapter means the set of chapters to keep has moved on.
        if ([...chapters.keys()].some(index => Math.abs(index - chapter.index) > 1)) stale = true
        tend()
        neighbours()
      })
      flip.on('changeState', (e: { data: string }) => {
        idle = e.data === 'read'
        settle()
      })
      // Nothing is reported until a page is turned: opening the book must not move the reader's saved place.
      neighbours()
    })()

    return () => {
      cancelled = true
      flipRef.current = null
      flip?.destroy()
      el.replaceChildren()
    }
  }, [sections, size])

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
