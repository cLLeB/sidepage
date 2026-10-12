// Thin layer over the two places Sidepage runs: the Tauri desktop shell and a plain browser tab.

export const isTauri = '__TAURI_INTERNALS__' in window
export const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
// Desktop apps keep notes as files in the Documents folder. A phone or tablet gives an app no such folder to
// write in freely, so there notes are kept in the app's own private storage.
const usesComputerFiles = isTauri && !isMobile
export const PICTURE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif']

export const BOOK_EXTENSIONS = [
  'pdf', 'epub', 'mobi', 'azw', 'azw3', 'kf8', 'fb2', 'fbz', 'cbz', 'cbr', 'cb7', 'cbt', 'djvu', 'djv',
  'docx', 'doc', 'rtf', 'odt', 'pptx', 'ppt', 'pps', 'sidepage', 'zip', 'txt', 'md', 'markdown', 'html', 'htm',
  ...PICTURE_EXTENSIONS,
]

export const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''
export const baseName = (name: string) => name.replace(/\.[^.]+$/, '')

export async function pickFile(): Promise<File | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    // A phone's picker sorts by kind of file, not by ending, and would grey books out: there every file is offered.
    const path = await open({ multiple: false, filters: isMobile ? undefined : [{ name: 'Books and documents', extensions: BOOK_EXTENSIONS }] })
    if (!path) return null
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const bytes = await readFile(path)
    // On Android the "path" is an internal reference with no name in it. The app's Android side knows the real
    // name (see src-tauri/android/MainActivity.kt); failing that, openFile recognises the file by its contents.
    const android = (window as unknown as { SidepageAndroid?: { nameOf(reference: string): string } }).SidepageAndroid
    return new File([bytes], android?.nameOf(path) || path.split(/[\/]/).pop() || 'book')
  }
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    // Phones filter by kind of file, not by ending, and would grey books out; there every file is offered.
    if (!isMobile) input.accept = BOOK_EXTENSIONS.map(e => `.${e}`).join(',')
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
    if (!match) continue
    if ((text as unknown) instanceof Blob) {
      if (!(await loadNoteFile(match[1], match[2]))) await saveNoteFile(match[1], match[2], text as unknown as Blob)
    } else if ((await loadNote(match[1], match[2])) === null) await saveNote(match[1], match[2], text)
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
  if (usesComputerFiles) {
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
  if (usesComputerFiles) {
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

// A picture kept in a notebook, beside its notes.
export async function saveNoteFile(notebook: string, file: string, data: Blob): Promise<void> {
  if (usesComputerFiles) {
    const { writeFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await mkdir(`${ROOT}/${safe(notebook)}`, { baseDir: BaseDirectory.Document, recursive: true })
    return writeFile(`${ROOT}/${safe(notebook)}/${file}`, new Uint8Array(await data.arrayBuffer()), { baseDir: BaseDirectory.Document })
  }
  if (!folder) {
    const { set } = await import('idb-keyval')
    return set(localKey(notebook, file), data)
  }
  const dir = await folder.getDirectoryHandle(safe(notebook), { create: true })
  const writable = await (await dir.getFileHandle(file, { create: true })).createWritable()
  await writable.write(data)
  await writable.close()
}

export async function loadNoteFile(notebook: string, file: string): Promise<Blob | null> {
  try {
    if (usesComputerFiles) {
      const { readFile, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      const path = `${ROOT}/${safe(notebook)}/${file}`
      if (!(await exists(path, { baseDir: BaseDirectory.Document }))) return null
      return new Blob([await readFile(path, { baseDir: BaseDirectory.Document })])
    }
    if (!folder) {
      const { get } = await import('idb-keyval')
      return (await get<Blob>(localKey(notebook, file))) ?? null
    }
    const dir = await folder.getDirectoryHandle(safe(notebook))
    return await (await dir.getFileHandle(file)).getFile()
  } catch {
    return null
  }
}

// The pictures a note refers to that live in its notebook (not ones on the web).
export const picturesIn = (markdown: string) => [...markdown.matchAll(/!\[[^\]]*\]\(((?:clip|picture)-[\w.-]+)(?:\s+"[^"]*")?\)/g)].map(match => match[1])

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: A) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

// Whether books open as pages to turn (Flip) or as a scroll; the last choice is kept.
export const prefersFlip = () => localStorage.getItem('sidepage:flip') === '1'
export const rememberFlip = (on: boolean) => localStorage.setItem('sidepage:flip', on ? '1' : '0')

// Messages between the reading side and the writing side, so they behave as one workspace.
function channel<T>(name: string) {
  const send = (detail: T) => { window.dispatchEvent(new CustomEvent<T>(name, { detail })) }
  const listen = (handler: (detail: T) => void) => {
    const listener = (e: Event) => handler((e as CustomEvent<T>).detail)
    window.addEventListener(name, listener)
    return () => window.removeEventListener(name, listener)
  }
  return [send, listen] as const
}

// A passage sent from a reader to the written note. `place` is where it sits in the book
// ("page=12" or an EPUB CFI), which makes the note's source line a link back to that spot.
export type Quote = { text: string; source: string; book?: string; place?: string; again?: boolean }
export const [sendQuote, onQuote] = channel<Quote>('sidepage:quote')

// Whether an element is really on screen: laid out, and not in a tab that is behind another.
export const isShown = (el: Element | null | undefined) =>
  !!el && (el as HTMLElement).offsetParent !== null && getComputedStyle(el).visibility !== 'hidden'

// A piece of a page (a figure, a formula) cut out as a picture, for the notes. It goes to the Canvas when the
// Canvas is the note in front, and to the written notes otherwise. (`again` marks one sent a second time,
// after the notes had to be opened to receive it.)
export type Clip = { image: string; source: string; book: string; place: string; again?: boolean }
export const [sendClip, onClip] = channel<Clip>('sidepage:clip')

// Note → book: open this place. Book → note: show the note that quotes this passage.
export type Place = { book: string; place: string }
export const [goToPlace, onGoToPlace] = channel<Place>('sidepage:goto')
export const [findInNotes, onFindInNotes] = channel<{ text: string }>('sidepage:find')

// A hash link: editors and sanitisers leave it alone, and it is harmless if the note is opened elsewhere.
const LINK = '#sidepage-open'
// Brackets are escaped too, so the link survives inside Markdown's [text](url).
const escapeForLink = (text: string) => encodeURIComponent(text).replace(/[()!'*]/g, c => `%${c.charCodeAt(0).toString(16)}`)
export const placeLink = ({ book, place }: Place) => `${LINK}?book=${escapeForLink(book)}&at=${escapeForLink(place)}`
export const parsePlaceLink = (href: string): Place | null => {
  if (!href.startsWith(LINK)) return null
  const query = new URLSearchParams(href.slice(LINK.length + 1))
  const book = query.get('book')
  const place = query.get('at')
  return book && place ? { book, place } : null
}

// Note → note: a link in one book's notes that opens another book and its notes.
const NOTE_LINK = '#sidepage-note'
export const noteLink = (book: string) => `${NOTE_LINK}?book=${escapeForLink(book)}`
export const parseNoteLink = (href: string) =>
  href.startsWith(NOTE_LINK) ? new URLSearchParams(href.slice(NOTE_LINK.length + 1)).get('book') : null
export const [openBookByName, onOpenBookByName] = channel<string>('sidepage:open')

// Every link between notebooks, as book file names: what the graph draws and what "Linked from" lists.
export async function noteLinks(): Promise<{ from: string; to: string }[]> {
  const links: { from: string; to: string }[] = []
  for (const book of await shelf()) {
    const notes = (await loadNote(baseName(book.name), 'notes.md')) ?? ''
    for (const match of notes.matchAll(/#sidepage-note\?book=([^)\s]+)/g)) links.push({ from: book.name, to: decodeURIComponent(match[1]) })
  }
  return links
}

// The books opened on this device, kept so they can be reopened from the home screen or from a link in a note.
export type Shelved = { name: string; opened: number; size: number }

export async function shelve(file: File) {
  const { get, set } = await import('idb-keyval')
  const shelf = ((await get<Shelved[]>('shelf')) ?? []).filter(book => book.name !== file.name)
  shelf.unshift({ name: file.name, opened: Date.now(), size: file.size })
  try {
    await set(`book:${file.name}`, file)
    await set('shelf', shelf)
  } catch {
    // Out of space: the book still opens, it just is not remembered.
  }
}

export async function shelf(): Promise<Shelved[]> {
  const { get } = await import('idb-keyval')
  return (await get<Shelved[]>('shelf')) ?? []
}

export async function fromShelf(name: string): Promise<File | null> {
  const { get } = await import('idb-keyval')
  const stored = await get<Blob>(`book:${name}`)
  return stored ? new File([stored], name) : null
}

export async function unshelve(name: string) {
  const { get, set, del } = await import('idb-keyval')
  await del(`book:${name}`)
  await set('shelf', ((await get<Shelved[]>('shelf')) ?? []).filter(book => book.name !== name))
}
