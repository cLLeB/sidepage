import { baseName, loadNote, loadNoteFile, picturesIn, saveNote, saveNoteFile, shelf } from './platform'
import { bookmarksFile } from './reading'

// A backup is one zip of everything written beside every book: notes, drawings, mind maps, highlights,
// bookmarks, the pictures in the notes, and the flashcard schedule. The books themselves are not in it; a
// book's notes join it again the next time that book is opened.
//   sidepage-backup.json     what is inside
//   <notebook>/<file>        each notebook's files
export const BACKUP_EXTENSION = 'sidepage-backup'
const NOTE_FILES = ['notes.md', 'mindmap.json', 'highlights.json', 'canvas.excalidraw', 'picture-cards.json', 'notes-history.json']
const REVIEW = '_review'

type Manifest = { format: 1; made: string; notebooks: { name: string; files: string[]; pictures: string[] }[] }

export async function packBackup(): Promise<{ data: Uint8Array; notebooks: number }> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const manifest: Manifest = { format: 1, made: new Date().toISOString(), notebooks: [] }
  // A PDF and an EPUB of the same title share a notebook: gather each notebook once, with both sets of bookmarks.
  const notebooks = new Map<string, string[]>()
  for (const book of await shelf()) notebooks.set(baseName(book.name), [...(notebooks.get(baseName(book.name)) ?? []), bookmarksFile(book.name)])
  notebooks.set(REVIEW, [])

  for (const [name, bookmarks] of notebooks) {
    const entry = { name, files: [] as string[], pictures: [] as string[] }
    const add = async (file: string) => {
      const text = await loadNote(name, file)
      if (text === null) return false
      zip.file(`${name}/${file}`, text)
      entry.files.push(file)
      return true
    }
    for (const file of name === REVIEW ? ['schedule.json'] : [...NOTE_FILES, ...bookmarks]) await add(file)
    for (let page = 2; name !== REVIEW && await add(`canvas-${page}.excalidraw`); page++);
    for (const picture of picturesIn(((await loadNote(name, 'notes.md')) ?? '') + ((await loadNote(name, 'picture-cards.json')) ?? ''))) {
      const data = await loadNoteFile(name, picture)
      if (!data) continue
      zip.file(`${name}/${picture}`, await data.arrayBuffer())
      entry.pictures.push(picture)
    }
    if (entry.files.length) manifest.notebooks.push(entry)
  }
  zip.file('sidepage-backup.json', JSON.stringify(manifest, null, 2))
  return { data: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), notebooks: manifest.notebooks.filter(n => n.name !== REVIEW).length }
}

// Puts a backup's notes back. Anything already on this device is kept, never overwritten.
export async function restoreBackup(backup: File): Promise<{ restored: number; kept: number }> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await backup.arrayBuffer())
  const manifest = JSON.parse(await zip.file('sidepage-backup.json')!.async('string')) as Manifest
  let restored = 0
  let kept = 0
  for (const notebook of manifest.notebooks) {
    for (const file of notebook.files) {
      if ((await loadNote(notebook.name, file)) !== null) { kept++; continue }
      await saveNote(notebook.name, file, await zip.file(`${notebook.name}/${file}`)!.async('string'))
      restored++
    }
    for (const picture of notebook.pictures) {
      if (await loadNoteFile(notebook.name, picture)) continue
      await saveNoteFile(notebook.name, picture, await zip.file(`${notebook.name}/${picture}`)!.async('blob'))
    }
  }
  return { restored, kept }
}
