import { extensionOf, isMobile, isTauri, saveFileAs } from './platform'

// Sharing the book in front with another app: WhatsApp, an email, a chat, a drive.
// On Android, the phone's own share sheet. On a computer, the file is put on the clipboard as the file manager's
// Copy would, ready to paste where it should go. In a browser that can share files, its share sheet; otherwise
// the file is saved, to be attached from the downloads.
export type Shared = 'sheet' | 'copied' | 'saved'

type ShareBridge = { begin(name: string): boolean; add(piece: string): boolean; send(type: string, title: string): boolean }
const androidShare = () => (window as unknown as { SidepageShare?: ShareBridge }).SidepageShare

const TYPES: Record<string, string> = {
  pdf: 'application/pdf', epub: 'application/epub+zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ppt: 'application/vnd.ms-powerpoint',
  odt: 'application/vnd.oasis.opendocument.text', rtf: 'application/rtf', txt: 'text/plain', md: 'text/markdown', html: 'text/html', htm: 'text/html',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  djvu: 'image/vnd.djvu', cbz: 'application/vnd.comicbook+zip', zip: 'application/zip',
}
export const typeOf = (file: File) => file.type || TYPES[extensionOf(file.name)] || 'application/octet-stream'

// The file's name only (a book opened from a folder can carry the folder in its name).
const plainName = (file: File) => file.name.replace(/^.*[\\/]/, '')

async function putAside(file: File): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('share_file', new Uint8Array(await file.arrayBuffer()), { headers: { name: encodeURIComponent(plainName(file)) } })
}

export async function shareFile(file: File): Promise<Shared> {
  const name = plainName(file)
  const bridge = androidShare()
  // Android: the web view hands its app only text, so the book goes over in pieces of base64 (each a whole number
  // of 3 bytes, so each decodes alone), and Android's share sheet opens on it.
  if (isTauri && bridge) {
    if (!bridge.begin(name)) throw new Error('Android could not make room for the book')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const PIECE = 3 * 256 * 1024
    for (let at = 0; at < bytes.length; at += PIECE) {
      const part = bytes.subarray(at, at + PIECE)
      let binary = ''
      for (let i = 0; i < part.length; i += 0x8000) binary += String.fromCharCode(...part.subarray(i, i + 0x8000))
      if (!bridge.add(btoa(binary))) throw new Error('Android could not take the book')
    }
    if (bridge.send(typeOf(file), name)) return 'sheet'
    throw new Error('Android could not open its share sheet')
  }
  if (isTauri && !isMobile) {
    const path = await putAside(file)
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('copy_file', { path })
    return 'copied'
  }
  const given = new File([file], name, { type: typeOf(file) })
  if (navigator.canShare?.({ files: [given] })) {
    try { await navigator.share({ files: [given], title: name }); return 'sheet' }
    catch (e) { if ((e as Error).name === 'AbortError') return 'sheet' }
  }
  await saveFileAs(name, new Uint8Array(await file.arrayBuffer()))
  return 'saved'
}
