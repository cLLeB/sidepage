import * as pdfjs from 'pdfjs-dist'

// Where the words and the pictures of a PDF page stand, in page points from its top-left corner, y down (the
// way EmbedPDF measures a page). Read with PDF.js from the file itself, so the pacer, read-aloud's lit sentence,
// Peek and dark pages can be laid exactly over EmbedPDF's own drawing of the page.
export type Box = { x: number; y: number; w: number; h: number }
export type Word = Box & { text: string; line: number }

const wordCache = new WeakMap<pdfjs.PDFDocumentProxy, Map<number, Promise<Word[]>>>()
const pictureCache = new WeakMap<pdfjs.PDFDocumentProxy, Map<number, Promise<Box[]>>>()

function cached<T>(store: WeakMap<pdfjs.PDFDocumentProxy, Map<number, Promise<T>>>, doc: pdfjs.PDFDocumentProxy, page: number, make: () => Promise<T>) {
  let pages = store.get(doc)
  if (!pages) store.set(doc, (pages = new Map()))
  if (!pages.has(page)) pages.set(page, make())
  return pages.get(page)!
}

// The words of page `number` (1-based), each with its box; `line` numbers the lines in reading order.
export function wordsOf(doc: pdfjs.PDFDocumentProxy, number: number): Promise<Word[]> {
  return cached(wordCache, doc, number, async () => {
    const page = await doc.getPage(number)
    const [x0, , , y1] = page.view
    const content = await page.getTextContent()
    const words: Word[] = []
    let line = 0, lastY = NaN
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const [a, b, , d, e, f] = item.transform
      const size = Math.hypot(a, b) || Math.abs(d) || 10
      const width = item.width || size * item.str.length * 0.5
      const top = y1 - f - size * 0.82
      if (Math.abs(top - lastY) > size * 0.5) line++
      lastY = top
      // The item's width is shared among its letters, so each word gets its own share.
      const per = width / item.str.length
      for (const found of item.str.matchAll(/\S+/g)) {
        words.push({ text: found[0], line, x: e - x0 + found.index * per, y: top, w: found[0].length * per, h: size * 1.05 })
      }
    }
    return words
  })
}

// The boxes of the pictures on page `number`: each image drawn, through the transforms in force when it was.
export function picturesOf(doc: pdfjs.PDFDocumentProxy, number: number): Promise<Box[]> {
  return cached(pictureCache, doc, number, async () => {
    const page = await doc.getPage(number)
    const [x0, , , y1] = page.view
    const { OPS } = pdfjs
    const list = await page.getOperatorList()
    const boxes: Box[] = []
    type M = [number, number, number, number, number, number]
    let m: M = [1, 0, 0, 1, 0, 0]
    const stack: M[] = []
    const times = (p: M, q: M): M => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]]
    list.fnArray.forEach((fn, i) => {
      if (fn === OPS.save) stack.push(m)
      else if (fn === OPS.restore) m = stack.pop() ?? m
      else if (fn === OPS.transform) m = times(m, list.argsArray[i] as M)
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat) {
        const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]])
        const xs = corners.map(p => p[0]), ys = corners.map(p => p[1])
        const box = { x: Math.min(...xs) - x0, y: y1 - Math.max(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
        if (box.w > 8 && box.h > 8) boxes.push(box)
      }
    })
    return boxes
  })
}

// The words of a sentence on the page: the run of words whose letters match it (or its first forty letters).
export function wordsOfSentence(words: Word[], sentence: string): Word[] {
  const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  const wanted = squash(sentence)
  if (wanted.length < 4) return []
  let joined = ''
  const starts = words.map(word => { const at = joined.length; joined += squash(word.text); return at })
  let from = joined.indexOf(wanted), length = wanted.length
  if (from < 0) { from = joined.indexOf(wanted.slice(0, 40)); length = Math.min(wanted.length, joined.length - from) }
  if (from < 0) return []
  return words.filter((word, i) => starts[i] < from + length && starts[i] + squash(word.text).length > from)
}

// Merges the boxes of words on one line into one strip each, for lighting a passage.
export function stripsOf(words: Word[]): Box[] {
  const lines = new Map<number, Box>()
  for (const word of words) {
    const had = lines.get(word.line)
    if (!had) { lines.set(word.line, { ...word }); continue }
    const right = Math.max(had.x + had.w, word.x + word.w), bottom = Math.max(had.y + had.h, word.y + word.h)
    had.x = Math.min(had.x, word.x); had.y = Math.min(had.y, word.y); had.w = right - had.x; had.h = bottom - had.y
  }
  return [...lines.values()]
}
