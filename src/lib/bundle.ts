import { baseName, loadNote, loadNoteFile, picturesIn, saveNote, saveNoteFile } from './platform'
import { bookmarksFile } from './reading'

// A .sidepage file is a zip holding one book and everything written beside it:
//   sidepage.json     what is inside
//   book/<file>       the book, document or deck, untouched
//   notes/<file>      notes.md, canvas pages, mindmap.json, highlights.json
export const BUNDLE_EXTENSION = 'sidepage'
const NOTE_FILES = ['notes.md', 'mindmap.json', 'highlights.json', 'canvas.excalidraw']

export async function packBundle(book: File): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const notebook = baseName(book.name)
  const notes: string[] = []
  const add = async (file: string) => {
    const text = await loadNote(notebook, file)
    if (text === null) return false
    zip.file(`notes/${file}`, text)
    notes.push(file)
    return true
  }
  for (const file of [...NOTE_FILES, bookmarksFile(book.name)]) await add(file)
  for (let page = 2; await add(`canvas-${page}.excalidraw`); page++);
  const pictures: string[] = []
  for (const name of picturesIn((await loadNote(notebook, 'notes.md')) ?? '')) {
    const picture = await loadNoteFile(notebook, name)
    if (!picture) continue
    zip.file(`notes/${name}`, await picture.arrayBuffer())
    pictures.push(name)
  }
  const drawings = Number(localStorage.getItem(`sidepage:drawings:${book.name}`)) === book.size ? await loadNoteFile(notebook, 'drawings.pdf') : null
  if (drawings) zip.file('notes/drawings.pdf', await drawings.arrayBuffer())
  zip.file(`book/${book.name}`, await book.arrayBuffer())
  zip.file('sidepage.json', JSON.stringify({
    format: 1,
    book: book.name,
    notes,
    pictures,
    place: localStorage.getItem(`sidepage:place:${book.name}`),
    saved: new Date().toISOString(),
  }, null, 2))
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

// Returns the book; its notes are put in place first. Notes already on this device are kept, never overwritten.
export async function unpackBundle(bundle: File): Promise<File> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await bundle.arrayBuffer())
  const manifest = JSON.parse(await zip.file('sidepage.json')!.async('string')) as { book: string; notes: string[]; pictures?: string[]; place?: string | null }
  const notebook = baseName(manifest.book)
  for (const file of manifest.notes) {
    if ((await loadNote(notebook, file)) === null) await saveNote(notebook, file, await zip.file(`notes/${file}`)!.async('string'))
  }
  for (const name of manifest.pictures ?? []) {
    if (!(await loadNoteFile(notebook, name))) await saveNoteFile(notebook, name, await zip.file(`notes/${name}`)!.async('blob'))
  }
  const placeKey = `sidepage:place:${manifest.book}`
  if (manifest.place && !localStorage.getItem(placeKey)) localStorage.setItem(placeKey, manifest.place)
  const book = new File([await zip.file(`book/${manifest.book}`)!.async('blob')], manifest.book)
  const drawings = zip.file('notes/drawings.pdf')
  if (drawings && !(await loadNoteFile(notebook, 'drawings.pdf'))) {
    await saveNoteFile(notebook, 'drawings.pdf', await drawings.async('blob'))
    localStorage.setItem(`sidepage:drawings:${manifest.book}`, String(book.size))
  }
  return book
}
