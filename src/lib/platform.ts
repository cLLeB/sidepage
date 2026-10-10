// Thin layer over the two places Sidepage runs: the Tauri desktop shell and a plain browser tab.

export const isTauri = '__TAURI_INTERNALS__' in window

export const BOOK_EXTENSIONS = [
  'pdf', 'epub', 'mobi', 'azw', 'azw3', 'kf8', 'fb2', 'fbz', 'cbz', 'cbr', 'cb7', 'cbt', 'djvu', 'djv',
  'docx', 'rtf', 'odt', 'pptx', 'txt', 'md', 'markdown', 'html', 'htm',
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

// The book the desktop app was started with ("Open with", or a double-click on a book file).
export async function launchFile(): Promise<File | null> {
  if (!isTauri) return null
  const { invoke } = await import('@tauri-apps/api/core')
  const name = await invoke<string | null>('launch_file_name')
  return name ? new File([await invoke<ArrayBuffer>('read_launch_file')], name) : null
}

// Hand the reader a file to keep, e.g. a PDF with their highlights.
export async function saveFileAs(name: string, bytes: Uint8Array) {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const path = await save({ defaultPath: name })
    if (!path) return
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    return writeFile(path, bytes)
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]))
  Object.assign(document.createElement('a'), { href: url, download: name }).click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// Notes are plain files. On desktop they live in Documents/Sidepage/<notebook>/. In a browser the reader can
// pick a folder for them (File System Access API); until then they stay in the browser's own storage.
const ROOT = 'Sidepage'
const safe = (part: string) => part.replace(/[<>:"/\\|?*]/g, '_').trim() || 'untitled'
const localKey = (notebook: string, file: string) => `sidepage:${notebook}/${file}`

type Permission = 'granted' | 'denied' | 'prompt'
type Folder = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: 'readwrite' }): Promise<Permission>
  requestPermission(options: { mode: 'readwrite' }): Promise<Permission>
}

let folder: Folder | null = null
let folderLocked: Folder | null = null
const folderListeners = new Set<() => void>()

export const canPickNotesFolder = !isTauri && 'showDirectoryPicker' in window
export const notesFolder = () => ({ name: (folder ?? folderLocked)?.name ?? null, locked: !folder && !!folderLocked })
export const onNotesFolderChange = (listener: () => void) => {
  folderListeners.add(listener)
  return () => { folderListeners.delete(listener) }
}

async function useFolder(handle: Folder) {
  folder = handle
  folderLocked = null
  // Carry over anything written before a folder was chosen, without overwriting files already there.
  const { entries } = await import('idb-keyval')
  for (const [key, text] of await entries<string, string>()) {
    const match = typeof key === 'string' && key.match(/^sidepage:(.+)\/([^/]+)$/)
    if (match && (await loadNote(match[1], match[2])) === null) await saveNote(match[1], match[2], text)
  }
  folderListeners.forEach(listener => listener())
}

// Called once at start: reuse the folder from last time if the browser still allows it.
export async function restoreNotesFolder() {
  if (!canPickNotesFolder) return
  const { get } = await import('idb-keyval')
  const saved = await get<Folder>('notes-folder')
  if (!saved) return
  if ((await saved.queryPermission({ mode: 'readwrite' })) === 'granted') return useFolder(saved)
  folderLocked = saved
  folderListeners.forEach(listener => listener())
}

// Needs a click: either re-allow the remembered folder or pick a new one.
export async function chooseNotesFolder() {
  if (folderLocked && (await folderLocked.requestPermission({ mode: 'readwrite' })) === 'granted') return useFolder(folderLocked)
  const picked = await (window as unknown as { showDirectoryPicker(options: object): Promise<Folder> })
    .showDirectoryPicker({ id: 'sidepage-notes', mode: 'readwrite' })
    .catch(() => null)
  if (!picked) return
  const { set } = await import('idb-keyval')
  await set('notes-folder', picked)
  await useFolder(picked)
}

export async function loadNote(notebook: string, file: string): Promise<string | null> {
  if (isTauri) {
    const { readTextFile, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const path = `${ROOT}/${safe(notebook)}/${file}`
    if (!(await exists(path, { baseDir: BaseDirectory.Document }))) return null
    return readTextFile(path, { baseDir: BaseDirectory.Document })
  }
  if (!folder) {
    // The browser's own database: works on phones and tablets too, and holds far more than localStorage.
    const { get } = await import('idb-keyval')
    return (await get<string>(localKey(notebook, file))) ?? localStorage.getItem(localKey(notebook, file))
  }
  try {
    const dir = await folder.getDirectoryHandle(safe(notebook))
    return await (await (await dir.getFileHandle(file)).getFile()).text()
  } catch {
    return null
  }
}

export async function saveNote(notebook: string, file: string, text: string): Promise<void> {
  if (isTauri) {
    const { writeTextFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await mkdir(`${ROOT}/${safe(notebook)}`, { baseDir: BaseDirectory.Document, recursive: true })
    return writeTextFile(`${ROOT}/${safe(notebook)}/${file}`, text, { baseDir: BaseDirectory.Document })
  }
  if (!folder) {
    const { set } = await import('idb-keyval')
    return set(localKey(notebook, file), text)
  }
  const dir = await folder.getDirectoryHandle(safe(notebook), { create: true })
  const writable = await (await dir.getFileHandle(file, { create: true })).createWritable()
  await writable.write(text)
  await writable.close()
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
