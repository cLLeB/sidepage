import { getPref } from './prefs'

// Reading the words out of a picture (a scanned page, a photograph of a board, a figure's caption) with
// Tesseract. The reader itself is large, so it is not carried inside the app: it is fetched from the internet
// the first time it is used, and the device keeps it after that.
export const OCR_LANGUAGES = {
  eng: 'English', fra: 'French', 'eng+fra': 'English and French', deu: 'German', spa: 'Spanish', por: 'Portuguese', ita: 'Italian', nld: 'Dutch',
} as const

export async function readText(picture: HTMLCanvasElement | Blob, onProgress?: (share: number) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(getPref('ocr-language', 'eng').split('+'), 1, {
    logger: (step: { status: string; progress: number }) => { if (step.status === 'recognizing text') onProgress?.(step.progress) },
  })
  try {
    const { data } = await worker.recognize(picture)
    // Lines broken by the edge of the page are joined; a blank line still parts two paragraphs.
    return data.text.split(/\n{2,}/).map(paragraph => paragraph.replace(/-\n/g, '').replace(/\n/g, ' ').trim()).filter(Boolean).join('\n\n')
  } finally {
    await worker.terminate()
  }
}

// A reader kept open for many pictures in a row (a whole scanned book): fetched and started once.
export async function openReader() {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(getPref('ocr-language', 'eng').split('+'), 1)
  return {
    read: async (picture: HTMLCanvasElement) => (await worker.recognize(picture)).data.text.replace(/-\n/g, '').replace(/\s+/g, ' ').trim(),
    close: () => worker.terminate(),
  }
}

// ── A photo of a printed page you marked with a highlighter: the words, and which of them are marked ──
// Tesseract finds each word and its box; a word is marked when much of its box is the bright, strong colour of a
// highlighter (yellow, green, pink, orange, blue) rather than white paper or black ink. Runs of marked words
// make the passages you highlighted.
export type PagePhoto = { text: string; marked: string[] }
export async function readPhoto(picture: HTMLCanvasElement, onProgress?: (share: number) => void): Promise<PagePhoto> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(getPref('ocr-language', 'eng').split('+'), 1, {
    logger: (step: { status: string; progress: number }) => { if (step.status === 'recognizing text') onProgress?.(step.progress) },
  })
  try {
    type Word = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }
    type Line = { words: Word[] }
    const { data } = await worker.recognize(picture, {}, { blocks: true, text: true }) as unknown as { data: { text: string; blocks: { paragraphs: { lines: Line[] }[] }[] | null } }
    const pixels = picture.getContext('2d')!.getImageData(0, 0, picture.width, picture.height).data
    const markedShare = ({ x0, y0, x1, y1 }: Word['bbox']) => {
      let marked = 0, seen = 0
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
        const at = (Math.min(picture.height - 1, y) * picture.width + Math.min(picture.width - 1, x)) * 4
        const [r, g, b] = [pixels[at], pixels[at + 1], pixels[at + 2]]
        const high = Math.max(r, g, b), low = Math.min(r, g, b)
        seen++
        // Bright and strongly coloured: highlighter ink. Paper is bright but grey; print is dark.
        if (high > 150 && (high - low) / high > 0.28) marked++
      }
      return seen ? marked / seen : 0
    }
    const passages: string[] = []
    let run: string[] = []
    const close = () => { if (run.join(' ').length > 2) passages.push(run.join(' ').replace(/-\s/g, '')); run = [] }
    for (const block of data.blocks ?? []) for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) for (const word of line.words) {
        if (markedShare(word.bbox) > 0.3) run.push(word.text)
        else close()
      }
      close()
    }
    const text = data.text.split(/\n{2,}/).map(paragraph => paragraph.replace(/-\n/g, '').replace(/\n/g, ' ').trim()).filter(Boolean).join('\n\n')
    return { text, marked: passages }
  } finally {
    await worker.terminate()
  }
}
