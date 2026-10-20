import {
  AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
  type IRunOptions, type ParagraphChild,
} from 'docx'

// A written note as a real Word document (.docx, made with the open-source docx library): headings, paragraphs
// with their alignment, lists and checklists, quotes, tables, code, and the pictures themselves inside the file.
type Look = { bold?: boolean; italics?: boolean; underline?: boolean; strike?: boolean; code?: boolean; color?: string; shade?: string; scale?: number; superScript?: boolean; subScript?: boolean }
const BASE = 24 // half-points: 12 pt
const PAGE_WIDTH = 600 // pixels of picture across the page

const hex = (colour: string) => {
  if (colour.startsWith('#')) return colour.slice(1, 7).padEnd(6, '0')
  const parts = colour.match(/\d+/g)
  return parts ? parts.slice(0, 3).map(part => Number(part).toString(16).padStart(2, '0')).join('') : undefined
}

// The words of an element, run by run, each run carrying the looks of the tags round it.
function runs(node: Node, look: Look = {}): ParagraphChild[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ''
    if (!text) return []
    const options: IRunOptions = {
      text, bold: look.bold, italics: look.italics, strike: look.strike, underline: look.underline ? {} : undefined,
      color: look.color, superScript: look.superScript, subScript: look.subScript,
      font: look.code ? 'Consolas' : undefined, size: look.scale ? Math.round(BASE * look.scale) : undefined,
      shading: look.shade ? { type: ShadingType.CLEAR, color: 'auto', fill: look.shade } : undefined,
    }
    return [new TextRun(options)]
  }
  if (!(node instanceof HTMLElement)) return []
  if (node.matches('br')) return [new TextRun({ text: '', break: 1 })]
  const tag = node.tagName.toLowerCase()
  const next: Look = { ...look }
  if (tag === 'strong' || tag === 'b') next.bold = true
  if (tag === 'em' || tag === 'i') next.italics = true
  if (tag === 'u') next.underline = true
  if (tag === 's' || tag === 'del') next.strike = true
  if (tag === 'code') next.code = true
  if (tag === 'sup') next.superScript = true
  if (tag === 'sub') next.subScript = true
  if (node.dataset.ink) next.color = hex(node.dataset.ink)
  if (node.dataset.marker) next.shade = hex(node.dataset.marker)
  if (node.dataset.size) next.scale = parseFloat(node.dataset.size) || undefined
  return [...node.childNodes].flatMap(child => runs(child, next))
}

const alignment = (element: HTMLElement) => ({ center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED } as Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]>)[element.style.textAlign]

async function picture(img: HTMLImageElement): Promise<Paragraph | null> {
  try {
    const blob = await (await fetch(img.src)).blob()
    const data = new Uint8Array(await blob.arrayBuffer())
    const type = blob.type.includes('png') ? 'png' : blob.type.includes('gif') ? 'gif' : blob.type.includes('bmp') ? 'bmp' : 'jpg'
    const width = img.naturalWidth || 600, height = img.naturalHeight || 400
    const scale = Math.min(1, PAGE_WIDTH / width)
    return new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type, data, transformation: { width: Math.round(width * scale), height: Math.round(height * scale) } })] })
  } catch {
    return null
  }
}

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]

async function blocks(element: HTMLElement, depth = 0): Promise<(Paragraph | Table)[]> {
  const tag = element.tagName.toLowerCase()
  if (/^h[1-6]$/.test(tag)) return [new Paragraph({ heading: HEADINGS[Number(tag[1]) - 1], alignment: alignment(element), children: runs(element) })]
  if (tag === 'p') return element.textContent?.trim() || element.querySelector('br') ? [new Paragraph({ alignment: alignment(element), children: runs(element) })] : [new Paragraph({})]
  if (tag === 'hr') return [new Paragraph({ border: { bottom: { color: 'AAAAAA', space: 1, style: BorderStyle.SINGLE, size: 6 } }, children: [] })]
  if (tag === 'img') { const made = await picture(element as HTMLImageElement); return made ? [made] : [] }
  if (tag === 'pre') return (element.textContent ?? '').split('\n').map(line => new Paragraph({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F2F2F2' }, children: [new TextRun({ text: line, font: 'Consolas', size: 20 })] }))
  if (tag === 'blockquote') {
    const inner = await Promise.all([...element.children].map(child => blocks(child as HTMLElement, depth)))
    return inner.flat().map(part => (part instanceof Paragraph ? part : part))
  }
  if (tag === 'table') {
    const rows = [...element.querySelectorAll('tr')].map(row => new TableRow({
      children: [...row.querySelectorAll('th, td')].map(cell => new TableCell({ children: [new Paragraph({ children: runs(cell, cell.tagName === 'TH' ? { bold: true } : {}) })] })),
    }))
    return rows.length ? [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })] : []
  }
  if (tag === 'ul' || tag === 'ol') {
    const out: (Paragraph | Table)[] = []
    let number = 0
    for (const item of element.querySelectorAll(':scope > li, :scope > * > li')) {
      number++
      const own = item.cloneNode(true) as HTMLElement
      own.querySelectorAll('ul, ol').forEach(nested => nested.remove())
      // The editor shows a checklist's box as a drawn label: ticked or not.
      const label = item.querySelector('.label')?.classList
      const checked = label?.contains('checked') ? 'true' : label?.contains('unchecked') ? 'false' : (item as HTMLElement).dataset.checked
      own.querySelectorAll('.label-wrapper').forEach(box => box.remove())
      const mark = checked === 'true' ? '☑ ' : checked === 'false' ? '☐ ' : tag === 'ol' ? `${number}. ` : ''
      out.push(new Paragraph({ bullet: tag === 'ul' && !mark ? { level: Math.min(depth, 8) } : undefined, indent: mark ? { left: 360 * (depth + 1) } : undefined, children: [new TextRun(mark), ...runs(own)] }))
      for (const nested of item.querySelectorAll(':scope > ul, :scope > ol, :scope > * > ul, :scope > * > ol')) out.push(...(await blocks(nested as HTMLElement, depth + 1)))
    }
    return out
  }
  // A wrapper the editor puts round a block (a picture, a code block, a list item): what is inside it.
  const pictures = element.querySelectorAll('img')
  if (pictures.length && !element.querySelector('p, h1, h2, h3, table')) return (await Promise.all([...pictures].map(picture))).filter((made): made is Paragraph => !!made)
  const inner = await Promise.all([...element.children].map(child => blocks(child as HTMLElement, depth)))
  if (inner.flat().length) return inner.flat()
  return element.textContent?.trim() ? [new Paragraph({ children: runs(element) })] : []
}

export async function noteAsWord(page: HTMLElement, title: string, font: string): Promise<Uint8Array> {
  const children = (await Promise.all([...page.children].map(child => blocks(child as HTMLElement)))).flat()
  const document = new Document({
    creator: 'Sidepage', title,
    styles: { default: { document: { run: { font, size: BASE } } } },
    sections: [{ children: children.length ? children : [new Paragraph({})] }],
  })
  return new Uint8Array(await (await Packer.toBlob(document)).arrayBuffer())
}
