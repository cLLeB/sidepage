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
