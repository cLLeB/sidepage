import { extensionOf } from './platform'

// Works out what a file is from its contents, for when its name does not say. Phones often hand over a book
// as "document:19111" with no extension; the first bytes still give it away.
const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes)
const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((byte, i) => bytes[i] === byte)
// File names inside Word 97–2003 and PowerPoint 97–2003 files are stored two bytes per letter.
const wide = (word: string) => [...word].map(letter => `${letter}\0`).join('')

export async function detectExtension(file: File): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer())
  const start = text(head)

  if (start.startsWith('%PDF')) return 'pdf'
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpg'
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return 'png'
  if (start.startsWith('GIF8')) return 'gif'
  if (start.startsWith('RIFF') && start.slice(8, 12) === 'WEBP') return 'webp'
  if (start.startsWith('BM')) return 'bmp'
  if (start.startsWith('AT&TFORM')) return 'djvu'
  if (start.startsWith('{\\rtf')) return 'rtf'
  if (start.slice(60, 68) === 'BOOKMOBI') return 'mobi'
  if (start.startsWith('Rar!')) return 'cbr'
  if (startsWith(head, [0x37, 0x7a, 0xbc, 0xaf])) return 'cb7'

  // Zip-based formats: EPUB and ODT name themselves in their first entry; the rest by the files they hold.
  if (start.startsWith('PK')) {
    if (start.includes('application/epub+zip')) return 'epub'
    if (start.includes('application/vnd.oasis.opendocument.text')) return 'odt'
    const names = text(new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer()))
      + text(new Uint8Array(await file.slice(Math.max(0, file.size - 256 * 1024)).arrayBuffer()))
    if (names.includes('sidepage-backup.json')) return 'sidepage-backup'
    if (names.includes('sidepage.json')) return 'sidepage'
    if (names.includes('word/document.xml')) return 'docx'
    if (names.includes('ppt/presentation.xml')) return 'pptx'
    if (/\.(jpe?g|png|gif|webp)/i.test(names)) return 'cbz'
    return null
  }

  // Older Office files share one container; the streams inside say which program wrote it.
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0])) {
    const all = text(new Uint8Array(await file.arrayBuffer()))
    if (all.includes(wide('WordDocument'))) return 'doc'
    if (all.includes(wide('PowerPoint Document'))) return 'ppt'
    return null
  }

  const opening = start.trimStart().toLowerCase()
  if (opening.includes('<fictionbook')) return 'fb2'
  if (opening.startsWith('<!doctype html') || opening.startsWith('<html')) return 'html'
  // Nothing but readable characters: treat it as plain text.
  if (head.length && head.every(byte => byte === 9 || byte === 10 || byte === 13 || byte >= 32)) return 'txt'
  return null
}

// The same file under a name that says what it is, e.g. "document:19111" → "document 19111.pdf".
export async function withDetectedType(file: File, known: (extension: string) => boolean): Promise<File> {
  if (known(extensionOf(file.name))) return file
  const extension = await detectExtension(file)
  if (!extension) return file
  let name = file.name
  try { name = decodeURIComponent(name) } catch { /* keep it as it is */ }
  name = name.replace(/[:/\\]+/g, ' ').trim() || 'book'
  return new File([file], `${name}.${extension}`, { type: file.type })
}
