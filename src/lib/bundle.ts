import { baseName, loadNote, saveNote } from './platform'

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
  for (const file of NOTE_FILES) await add(file)
  for (let page = 2; await add(`canvas-${page}.excalidraw`); page++);
  zip.file(`book/${book.name}`, await book.arrayBuffer())
  zip.file('sidepage.json', JSON.stringify({
    format: 1,
    book: book.name,
    notes,
    place: localStorage.getItem(`sidepage:place:${book.name}`),
    saved: new Date().toISOString(),
  }, null, 2))
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

// Returns the book; its notes are put in place first. Notes already on this device are kept, never overwritten.
export async function unpackBundle(bundle: File): Promise<File> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await bundle.arrayBuffer())
  const manifest = JSON.parse(await zip.file('sidepage.json')!.async('string')) as { book: string; notes: string[]; place?: string | null }
  const notebook = baseName(manifest.book)
  for (const file of manifest.notes) {
    if ((await loadNote(notebook, file)) === null) await saveNote(notebook, file, await zip.file(`notes/${file}`)!.async('string'))
  }
  const placeKey = `sidepage:place:${manifest.book}`
  if (manifest.place && !localStorage.getItem(placeKey)) localStorage.setItem(placeKey, manifest.place)
  return new File([await zip.file(`book/${manifest.book}`)!.async('blob')], manifest.book)
}
