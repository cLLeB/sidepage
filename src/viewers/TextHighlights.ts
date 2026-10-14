import { useCallback, useEffect, useState, type RefObject } from 'react'
import { baseName } from '../lib/platform'
import { loadHighlights, saveHighlights, type Highlight } from '../lib/reading'
import { HIGHLIGHT_COLOURS } from './ReaderMenus'

// Highlights in documents drawn as plain page text (Word, RTF, ODT, .doc, text, Markdown). Such a page has no
// lasting address for a spot in it, so a highlight remembers its words and a little of what comes before and
// after them, and is found again by those when the document is opened. It is painted with the browser's own
// highlighting (CSS Custom Highlights), which leaves the document's page untouched.
type Spot = { node: Text; at: number }
const CONTEXT = 32
const names = Object.values(HIGHLIGHT_COLOURS).map((_, i) => `sidepage-mark-${i}`)
const nameOf = (colour: string) => names[Math.max(0, Object.values(HIGHLIGHT_COLOURS).indexOf(colour as never))]

// Every letter of the page in order, each knowing the text node it is in.
function textOf(root: HTMLElement) {
  // Only the words on the page: a document may carry its own style sheet inside it.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => (node.parentElement?.closest('style, script') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  let text = ''
  const spots: Spot[] = []
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    for (let i = 0; i < node.data.length; i++) spots.push({ node, at: i })
    text += node.data
  }
  return { text, spots }
}
const squash = (text: string) => text.replace(/\s+/g, ' ')

// The place on the page that fits a highlight best: its words, with as much of its before and after as agrees.
function find(root: HTMLElement, mark: Highlight): Range | null {
  const { text, spots } = textOf(root)
  if (!mark.text) return null
  let best = -1, bestScore = -1
  for (let at = text.indexOf(mark.text); at >= 0; at = text.indexOf(mark.text, at + 1)) {
    const before = squash(text.slice(Math.max(0, at - CONTEXT * 2), at)), after = squash(text.slice(at + mark.text.length, at + mark.text.length + CONTEXT * 2))
    let score = 0
    const prefix = squash(mark.prefix ?? ''), suffix = squash(mark.suffix ?? '')
    while (score < prefix.length && before[before.length - 1 - score] === prefix[prefix.length - 1 - score]) score++
    let ahead = 0
    while (ahead < suffix.length && after[ahead] === suffix[ahead]) ahead++
    if (score + ahead > bestScore) { best = at; bestScore = score + ahead }
  }
  if (best < 0) return null
  const range = document.createRange()
  const start = spots[best], end = spots[best + mark.text.length - 1]
  range.setStart(start.node, start.at)
  range.setEnd(end.node, end.at + 1)
  return range
}

export function useTextHighlights(host: RefObject<HTMLElement | null>, file: File, ready: boolean) {
  const [marks, setMarks] = useState<Highlight[]>([])
  const notebook = baseName(file.name)
  useEffect(() => { void loadHighlights(notebook, 'text').then(setMarks) }, [notebook])

  // Paint them, one highlight layer per colour.
  const paint = useCallback(() => {
    const root = host.current
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    const Painted = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
    if (!root || !registry || !Painted) return
    if (!document.getElementById('sidepage-mark-style')) {
      const style = document.createElement('style')
      style.id = 'sidepage-mark-style'
      style.textContent = Object.values(HIGHLIGHT_COLOURS).map((colour, i) => `::highlight(${names[i]}) { background-color: ${colour}99; }`).join('\n')
      document.head.append(style)
    }
    for (const name of names) registry.delete(name)
    const byName = new Map<string, Range[]>()
    for (const mark of marks) {
      const range = find(root, mark)
      if (range) byName.set(nameOf(mark.color ?? HIGHLIGHT_COLOURS.Yellow), [...(byName.get(nameOf(mark.color ?? HIGHLIGHT_COLOURS.Yellow)) ?? []), range])
    }
    for (const [name, ranges] of byName) registry.set(name, new Painted(...ranges))
  }, [host, marks])
  useEffect(() => { if (ready) paint() }, [ready, paint])

  const keep = (next: Highlight[]) => {
    setMarks(next)
    void saveHighlights(notebook, 'text', next)
  }
  // The selected words, highlighted (or, if already highlighted, given the new colour).
  const highlight = (colour: string) => {
    const root = host.current
    const selection = window.getSelection()
    if (!root || !selection?.rangeCount || selection.isCollapsed) return null
    const range = selection.getRangeAt(0)
    if (!root.contains(range.commonAncestorContainer)) return null
    const { text, spots } = textOf(root)
    const index = (node: Node, offset: number) => spots.findIndex(spot => spot.node === node && spot.at === offset)
    const from = index(range.startContainer, range.startOffset)
    const words = range.toString()
    if (from < 0 || !words.trim()) return null
    const known = marks.find(mark => mark.text === words && mark.prefix === text.slice(Math.max(0, from - CONTEXT), from))
    const mark: Highlight = known ? { ...known, color: colour } : {
      cfi: `quote=${Date.now().toString(36)}`, index: 0, text: words, color: colour,
      prefix: text.slice(Math.max(0, from - CONTEXT), from), suffix: text.slice(from + words.length, from + words.length + CONTEXT),
    }
    keep(known ? marks.map(other => (other.cfi === known.cfi ? mark : other)) : [...marks, mark])
    selection.removeAllRanges()
    return mark
  }
  const change = (cfi: string, part: Partial<Highlight>) => keep(marks.map(mark => (mark.cfi === cfi ? { ...mark, ...part } : mark)))
  const remove = (cfi: string) => keep(marks.filter(mark => mark.cfi !== cfi))
  const go = (cfi: string) => {
    const mark = marks.find(found => found.cfi === cfi)
    const range = mark && host.current ? find(host.current, mark) : null
    range?.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  return { marks, highlight, change, remove, go }
}
