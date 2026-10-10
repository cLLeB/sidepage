// Thin layer over the two places Sidepage runs: the Tauri desktop shell and a plain browser tab.

export const isTauri = '__TAURI_INTERNALS__' in window

export const BOOK_EXTENSIONS = [
  'pdf', 'epub', 'mobi', 'azw', 'azw3', 'kf8', 'fb2', 'fbz', 'cbz',
  'docx', 'pptx', 'txt', 'md', 'markdown', 'html', 'htm',
]

export const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''
export const baseName = (name: string) => name.replace(/\.[^.]+$/, '')

export async function pickFile(): Promise<File | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const path = await open({ multiple: false, filters: [{ name: 'Books and documents', extensions: BOOK_EXTENSIONS }] })
    if (!path) return null
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const bytes = await readFile(path)
    return new File([bytes], path.split(/[\\/]/).pop() ?? 'book')
  }
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = BOOK_EXTENSIONS.map(e => `.${e}`).join(',')
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

// Notes live as plain files in Documents/Sidepage/<notebook>/ on desktop, and in localStorage in a browser tab.
const ROOT = 'Sidepage'
const safe = (part: string) => part.replace(/[<>:"/\\|?*]/g, '_').trim() || 'untitled'

export async function loadNote(notebook: string, file: string): Promise<string | null> {
  if (!isTauri) return localStorage.getItem(`sidepage:${notebook}/${file}`)
  const { readTextFile, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  const path = `${ROOT}/${safe(notebook)}/${file}`
  if (!(await exists(path, { baseDir: BaseDirectory.Document }))) return null
  return readTextFile(path, { baseDir: BaseDirectory.Document })
}

export async function saveNote(notebook: string, file: string, text: string): Promise<void> {
  if (!isTauri) return localStorage.setItem(`sidepage:${notebook}/${file}`, text)
  const { writeTextFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  await mkdir(`${ROOT}/${safe(notebook)}`, { baseDir: BaseDirectory.Document, recursive: true })
  await writeTextFile(`${ROOT}/${safe(notebook)}/${file}`, text, { baseDir: BaseDirectory.Document })
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: A) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

// A quote sent from a reader to whichever written note is open.
export type Quote = { text: string; source: string }
export const sendQuote = (quote: Quote) => window.dispatchEvent(new CustomEvent<Quote>('sidepage:quote', { detail: quote }))
export const onQuote = (handler: (quote: Quote) => void) => {
  const listener = (e: Event) => handler((e as CustomEvent<Quote>).detail)
  window.addEventListener('sidepage:quote', listener)
  return () => window.removeEventListener('sidepage:quote', listener)
}
