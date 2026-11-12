import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Stretch } from './library'

// What the layout of a PDF says about it, worked out from the text PDF.js reads off each page: its lines, how
// big each is, and where on the page. From that come a table of contents for a PDF that has none, the list of
// references at the end of a paper, and the captions of its figures and tables, so that a mention of "[12]" or
// "Figure 3" can show what it points to without leaving the page.

export type Line = { text: string; size: number; page: number; top: number; bottom: number }
export type Layout = { lines: Line[]; body: number; pages: number; heights: number[] }

const layouts = new WeakMap<PDFDocumentProxy, Promise<Layout>>()
export const layoutOf = (pdf: PDFDocumentProxy) => {
  if (!layouts.has(pdf)) layouts.set(pdf, readLayout(pdf))
  return layouts.get(pdf)!
}

async function readLayout(pdf: PDFDocumentProxy): Promise<Layout> {
  const lines: Line[] = []
  const heights: number[] = []
  const last = Math.min(pdf.numPages, 1500)
  for (let number = 1; number <= last; number++) {
    const page = await pdf.getPage(number)
    const height = page.getViewport({ scale: 1 }).height
    heights.push(height)
    const content = await page.getTextContent()
    // Pieces of text on the same baseline, one after the other, make one line.
    let line: { parts: string[]; size: number; base: number; x: number } | null = null
    const close = () => {
      if (!line) return
      const text = line.parts.join('').normalize('NFKC').replace(/\s+/g, ' ').trim()
      if (text) lines.push({ text, size: Math.round(line.size * 2) / 2, page: number, top: (height - line.base - line.size) / height, bottom: (height - line.base + line.size * 0.25) / height })
      line = null
    }
    for (const item of content.items) {
      if (!('str' in item)) continue
      const size = Math.hypot(item.transform[2], item.transform[3]) || item.height
      const [x, base] = [item.transform[4], item.transform[5]]
      if (line && (Math.abs(base - line.base) > Math.max(2, line.size * 0.45) || x < line.x - 2)) close()
      if (!item.str.trim() && !line) continue
      if (!line) line = { parts: [], size, base, x }
      // A gap wider than a letter between two pieces is a space the PDF did not write.
      if (line.parts.length && x - line.x > size * 0.25 && !/\s$/.test(line.parts.at(-1)!)) line.parts.push(' ')
      line.parts.push(item.str)
      line.size = Math.max(line.size, item.str.trim() ? size : 0)
      line.x = x + (item.width ?? 0)
      if (item.hasEOL) close()
    }
    close()
    if (number % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0))
  }
  // The size most of the words are set in: the body text.
  const weight = new Map<number, number>()
  for (const line of lines) weight.set(line.size, (weight.get(line.size) ?? 0) + line.text.length)
  const body = [...weight].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10
  return { lines, body, pages: last, heights }
}

// ── A table of contents for a PDF without one ──
// Headings are the short lines set larger than the body text, or numbered like "2.3 Methods". The largest sizes
// are the top level. A line found on many pages is a running head, not a heading.
export type Heading = { label: string; depth: number; page: number; top: number }
export function headingsOf({ lines, body, pages }: Layout): Heading[] {
  const seen = new Map<string, number>()
  for (const line of lines) seen.set(line.text.toLowerCase(), (seen.get(line.text.toLowerCase()) ?? 0) + 1)
  const looksLikeHeading = (text: string) =>
    text.length >= 3 && text.length <= 90 && /\p{L}{2}/u.test(text) && !/[.,;:]$/.test(text) && !/^\d+$/.test(text)
    && !/^(fig(ure)?|table|source|note|https?:|www\.)/i.test(text) && (seen.get(text.toLowerCase()) ?? 0) <= Math.max(2, pages * 0.05)
  const numbered = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+\p{Lu}/u
  let found: (Line & { level?: number })[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!looksLikeHeading(line.text)) continue
    if (line.size >= body * 1.18) found.push(line)
    else if (Math.abs(line.size - body) < 0.6 && numbered.test(line.text) && line.text.length <= 70 && !/\d\s*$/.test(line.text)) {
      found.push({ ...line, level: (line.text.match(numbered)![1].match(/\./g) ?? []).length })
    }
  }
  // A heading broken over two lines: the second, just under it and the same size, joins it.
  const joined: typeof found = []
  for (const line of found) {
    const before = joined.at(-1)
    if (before && before.page === line.page && before.size === line.size && before.level === undefined && line.level === undefined && line.top - before.bottom < 0.03 && before.text.length + line.text.length < 110) {
      joined[joined.length - 1] = { ...before, text: `${before.text} ${line.text}`, bottom: line.bottom }
    } else joined.push(line)
  }
  found = joined
  // Too many to be headings at this size (a book set with large captions, say): keep only the larger sizes.
  const sizes = [...new Set(found.filter(line => line.level === undefined).map(line => line.size))].sort((a, b) => b - a)
  while (found.length > Math.max(40, pages * 2.5) && sizes.length > 1) {
    const smallest = sizes.pop()
    found = found.filter(line => line.level !== undefined || line.size !== smallest)
  }
  const top = sizes.slice(0, 3)
  return found.slice(0, 400).map(line => ({
    label: line.text,
    depth: line.level !== undefined ? Math.min(3, line.level + (top.length ? 1 : 0)) : Math.max(0, top.indexOf(line.size)),
    page: line.page,
    top: line.top,
  }))
}

// ── The references at the end of a paper ──
export type Reference = { number?: number; text: string; page: number }
export function referencesOf({ lines }: Layout): Reference[] {
  let start = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^(\d+\.?\s*)?(references|bibliography|works cited|literature cited|references and notes|cited literature)$/i.test(lines[i].text)) { start = i; break }
  }
  if (start < 0) return []
  const after = lines.slice(start + 1).filter(line => !/^(appendix|supplementary|acknowledg)/i.test(line.text))
  const end = after.findIndex(line => /^(appendix|supplementary material)/i.test(line.text))
  const list = end > 0 ? after.slice(0, end) : after
  const bracket = list.filter(line => /^\[\d+\]/.test(line.text)).length
  const dotted = list.filter(line => /^\d+\.\s/.test(line.text)).length
  const entries: Reference[] = []
  const starts = (text: string) => bracket >= 3 ? /^\[\d+\]/.test(text) : dotted >= 3 ? /^\d+\.\s/.test(text) : /^\p{Lu}[\p{L}'’-]+,\s?(\p{Lu}|van|de|von)/u.test(text)
  for (const line of list) {
    const before = entries.at(-1)
    // An author-year list: a new entry starts with "Surname, I." where the line before ended its entry.
    if (starts(line.text) && (bracket >= 3 || dotted >= 3 || !before || /[.)]$/.test(before.text))) {
      const number = Number(line.text.match(/^\[?(\d+)[\].]/)?.[1]) || undefined
      entries.push({ number, text: line.text.replace(/^\[\d+\]\s*|^\d+\.\s+/, ''), page: line.page })
    } else if (before) before.text = `${before.text.replace(/-$/, '')}${/-$/.test(before.text) ? '' : ' '}${line.text}`
  }
  return entries.filter(entry => entry.text.length > 20).slice(0, 800)
}

// The reference a citation in the text points to: "[12]" by its number, "(Smith et al., 2020)" by name and year.
export function findReference(references: Reference[], cited: string): Reference | undefined {
  const number = cited.match(/^\d+$/)?.[0]
  if (number) return references.find(entry => entry.number === Number(number)) ?? (references.every(entry => entry.number === undefined) ? references[Number(number) - 1] : undefined)
  const [, name, year] = cited.match(/^(.+?)\s+(\d{4}[a-z]?)$/) ?? []
  if (!name) return
  const surname = name.toLowerCase()
  return references.find(entry => entry.text.slice(0, 60).toLowerCase().includes(surname) && entry.text.includes(year.slice(0, 4)))
}

// Citations in a stretch of text: each with where it starts and ends, and what to look up.
export type Citation = { from: number; to: number; keys: string[] }
export function citationsIn(text: string): Citation[] {
  const found: Citation[] = []
  for (const match of text.matchAll(/\[(\d{1,3}(?:\s*[,–-]\s*\d{1,3})*)\]/g)) {
    const keys: string[] = []
    for (const part of match[1].split(/\s*,\s*/)) {
      const [a, b] = part.split(/\s*[–-]\s*/).map(Number)
      if (b && b > a && b - a < 30) for (let n = a; n <= b; n++) keys.push(String(n))
      else keys.push(String(a))
    }
    found.push({ from: match.index!, to: match.index! + match[0].length, keys })
  }
  const name = String.raw`(\p{Lu}[\p{L}'’-]+)(?:\s+(?:et al\.?|and|&)\s*(?:\p{Lu}[\p{L}'’-]+)?)?`
  for (const match of text.matchAll(new RegExp(String.raw`${name},?\s*\(?(\d{4}[a-z]?)\)?`, 'gu'))) {
    if (!/\(/.test(text.slice(Math.max(0, match.index! - 2), match.index! + match[0].length + 1)) && !/\(\d{4}/.test(match[0])) continue
    found.push({ from: match.index!, to: match.index! + match[0].length, keys: [`${match[1]} ${match[2]}`] })
  }
  return found
}

// ── Captions of figures and tables, so "see Figure 3" can show it ──
export type Caption = { kind: 'figure' | 'table'; label: string; page: number; top: number; bottom: number; text: string }
export function captionsOf({ lines }: Layout): Map<string, Caption> {
  const found = new Map<string, Caption>()
  for (const line of lines) {
    const match = line.text.match(/^(fig\.?|figure|table)\s*(\d+[a-z]?|[IVX]+)\s*[.:|—–-]/i)
    if (!match) continue
    const kind = /^t/i.test(match[1]) ? 'table' : 'figure'
    const key = `${kind} ${match[2].toLowerCase()}`
    // The first caption wins: later lines starting "Figure 3." are usually mentions at a sentence start.
    if (!found.has(key)) found.set(key, { kind, label: `${kind === 'table' ? 'Table' : 'Figure'} ${match[2]}`, page: line.page, top: line.top, bottom: line.bottom, text: line.text })
  }
  return found
}
export function figureMentionsIn(text: string): { from: number; to: number; key: string }[] {
  return [...text.matchAll(/\b(figs?\.?|figures?|tables?)\s*(\d+[a-z]?)/gi)].map(match => ({
    from: match.index!, to: match.index! + match[0].length, key: `${/^t/i.test(match[1]) ? 'table' : 'figure'} ${match[2].toLowerCase()}`,
  }))
}

// ── Acronyms and what they stand for ──
// The algorithm of Schwartz and Hearst ("A simple algorithm for identifying abbreviation definitions in
// biomedical text", PSB 2003): for "long form (SF)", walk the short form from its last letter back, matching each
// letter in the words before the brackets, the first letter of the short form at the start of a word.
function longFormFor(short: string, before: string): string | null {
  const words = before.trim().split(/\s+/)
  const most = Math.min(short.length + 5, short.length * 2)
  const candidate = words.slice(-most).join(' ')
  let s = short.length - 1, l = candidate.length - 1
  const lower = (c: string) => c.toLowerCase()
  while (s >= 0) {
    const c = lower(short[s])
    if (!/[\p{L}\p{N}]/u.test(c)) { s--; continue }
    while (l >= 0 && (lower(candidate[l]) !== c || (s === 0 && l > 0 && /[\p{L}\p{N}]/u.test(candidate[l - 1])))) l--
    if (l < 0) return null
    l--; s--
  }
  const start = candidate.lastIndexOf(' ', l) + 1
  const long = candidate.slice(start).trim()
  if (long.split(' ').length > most || long.length <= short.length || long.toLowerCase().includes(`(${short.toLowerCase()}`)) return null
  return long.replace(/^(the|a|an|of|and)\s+/i, '')
}
export type Acronym = { short: string; long: string; place: string }
export function acronymsIn(stretches: Stretch[]): Map<string, Acronym> {
  const found = new Map<string, Acronym>()
  for (const { place, text } of stretches) {
    for (const match of text.matchAll(/([^()]{4,160})\(\s*([\p{Lu}][\p{L}\p{N}&/-]{1,9})s?\s*\)/gu)) {
      const short = match[2]
      if (found.has(short) || !/\p{Lu}.*\p{Lu}|^\p{Lu}\p{Ll}*\p{Lu}/u.test(short) || /^\d/.test(short)) continue
      const sentence = match[1].split(/[.;:!?]\s/).pop() ?? match[1]
      const long = longFormFor(short, sentence)
      if (long && long.length < 90) found.set(short, { short, long, place })
    }
  }
  return found
}

// ── A table on a page, as a table for the notes ──
// The words inside the box drawn over the page, put in rows by their height on the page and in columns where the
// rows line up: each run of words with a wide gap after it is a cell, and cells that start near the same place
// across the rows are one column.
export async function tableIn(page: import('pdfjs-dist').PDFPageProxy, box: { x: number; y: number; w: number; h: number }): Promise<string[][]> {
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  type Piece = { text: string; x: number; right: number; y: number; size: number }
  const pieces: Piece[] = []
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue
    const size = Math.hypot(item.transform[2], item.transform[3]) || item.height
    const x = item.transform[4] / viewport.width, y = (viewport.height - item.transform[5] - size * 0.6) / viewport.height
    if (x < box.x - 0.005 || x > box.x + box.w || y < box.y - 0.005 || y > box.y + box.h) continue
    pieces.push({ text: item.str.normalize('NFKC'), x: item.transform[4], right: item.transform[4] + (item.width ?? 0), y: item.transform[5], size })
  }
  if (!pieces.length) return []
  // Rows: pieces whose baselines are within half a letter of each other, top first.
  pieces.sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: Piece[][] = []
  for (const piece of pieces) {
    const row = rows.find(found => Math.abs(found[0].y - piece.y) < piece.size * 0.5)
    if (row) row.push(piece); else rows.push([piece])
  }
  // Cells: pieces along a row with less than a wide space between them join.
  const cells = rows.map(row => row.sort((a, b) => a.x - b.x).reduce<Piece[]>((joined, piece) => {
    const last = joined.at(-1)
    if (last && piece.x - last.right < piece.size * 0.9) { last.text += (piece.x - last.right > piece.size * 0.15 ? ' ' : '') + piece.text; last.right = piece.right }
    else joined.push({ ...piece })
    return joined
  }, []))
  // Columns: the places cells start, near ones taken as one.
  const starts = cells.flat().map(cell => cell.x).sort((a, b) => a - b)
  const columns: number[] = []
  for (const x of starts) if (!columns.length || x - columns.at(-1)! > 14) columns.push(x)
  const columnOf = (x: number) => columns.reduce((best, start, i) => (Math.abs(start - x) < Math.abs(columns[best] - x) ? i : best), 0)
  const lines = cells.map(row => {
    const line = new Array(columns.length).fill('')
    for (const cell of row) { const at = columnOf(cell.x); line[at] = line[at] ? `${line[at]} ${cell.text.trim()}` : cell.text.trim() }
    return { line, y: row[0].y }
  }).filter(({ line }) => line.some(Boolean))
  // A cell whose words run on to a second line: the lines of one row sit closer together than two rows do.
  const gaps = lines.slice(1).map((row, i) => lines[i].y - row.y).filter(gap => gap > 0).sort((a, b) => a - b)
  const lineGap = gaps[Math.floor(gaps.length * 0.2)] ?? 0
  const rowsOut: string[][] = []
  lines.forEach(({ line }, i) => {
    const gap = i ? lines[i - 1].y - lines[i].y : Infinity
    const last = rowsOut.at(-1)
    if (last && lineGap && gap < lineGap * 1.3 && rowsOut.length > 1) line.forEach((text, j) => { if (text) last[j] = last[j] ? `${last[j]} ${text}` : text })
    else rowsOut.push([...line])
  })
  // The caption above a table ("Table 1. …") is not a row of it.
  if (rowsOut[0] && /^(table|tab\.)\s*\d/i.test(rowsOut[0][0]) && rowsOut[0].filter(Boolean).length === 1) rowsOut.shift()
  // A word broken at the end of a line joins again ("tempera- ture"); a real hyphen before a name stays ("Beer-Lambert").
  return rowsOut.map(row => row.map(text => text.replace(/(\w)- (\p{Ll})/gu, '$1$2').replace(/(\w)- (\p{Lu})/gu, '$1-$2')))
}
export const asMarkdownTable = (rows: string[][]) => {
  if (!rows.length) return ''
  const width = Math.max(...rows.map(row => row.length))
  const cell = (text: string) => text.replace(/\|/g, '\|')
  const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => cell(row[i] ?? '')).join(' | ')} |`
  return [line(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n')
}

// ── A PDF as flowing text, for reading on a phone ──
// Each page's lines are put back into paragraphs (a new one where the gap between lines is wider than usual, or
// where a short line ends a sentence) and headings (lines set larger than the text). Lines repeated on many pages
// (running heads, course titles) and bare page numbers are left out. Words broken at the end of a line join again.
export type Flow = { page: number; blocks: { heading: boolean; text: string }[] }
export function reflowOf({ lines, body, pages }: Layout): Flow[] {
  const seen = new Map<string, number>()
  for (const line of lines) { const key = line.text.toLowerCase().replace(/\d+/g, '#'); seen.set(key, (seen.get(key) ?? 0) + 1) }
  const running = (text: string) => (seen.get(text.toLowerCase().replace(/\d+/g, '#')) ?? 0) > Math.max(3, pages * 0.3)
  const out: Flow[] = []
  for (let page = 1; page <= pages; page++) {
    const mine = lines.filter(line => line.page === page && !running(line.text) && !/^\s*\d{1,4}\s*$/.test(line.text))
    const gaps = mine.slice(1).map((line, i) => line.top - mine[i].bottom).filter(gap => gap > -0.01 && gap < 0.05).sort((a, b) => a - b)
    const usual = gaps[Math.floor(gaps.length / 2)] ?? 0.005
    const widths = mine.map(line => line.text.length).sort((a, b) => a - b)
    const full = widths[Math.floor(widths.length * 0.75)] ?? 60
    const blocks: Flow['blocks'] = []
    mine.forEach((line, i) => {
      const heading = line.size >= body * 1.18 && line.text.length < 120
      const before = mine[i - 1]
      const last = blocks.at(-1)
      const gap = before ? line.top - before.bottom : 1
      // A heading broken over two lines stays one heading; text after a heading starts afresh.
      const startsNew = !last || heading !== last.heading
        || (heading && gap > usual * 3 + 0.012)
        || gap > usual * 1.8 + 0.004 || gap < -0.01
        || (/[.!?:”"]$/.test(before?.text ?? '') && (before?.text.length ?? 0) < full * 0.8)
        || /^([•▪◦\-–]|\d+[.)])\s/.test(line.text)
      if (startsNew) blocks.push({ heading, text: line.text })
      else last!.text = /[\p{L}]-$/u.test(last!.text) ? `${last!.text.slice(0, -1)}${line.text}` : `${last!.text} ${line.text}`
    })
    out.push({ page, blocks })
  }
  return out
}
