import { BOOK_EXTENSIONS, extensionOf, isMobile, isTauri } from './platform'
import { getPref, setPref } from './prefs'

// Folders of books and documents, opened once and gone back to whenever they are wanted.
//   • "path":   a folder on a computer, read where it is (the installed app), so new files show up by themselves
//   • "handle": a folder a browser was let into (Chrome and Edge on a computer), asked for again after a restart
//   • "kept":   files chosen together on a phone or tablet, which do not let apps keep a folder: Sidepage keeps
//               a copy of them, as one folder
export type Folder = { id: string; name: string; kind: 'path' | 'handle' | 'kept'; path?: string; added: number }
export type Entry = { id: string; name: string; children?: Entry[]; size: number }

const KINDS = BOOK_EXTENSIONS.filter(kind => kind !== 'zip' && kind !== 'sidepage')
export const folders = () => getPref<Folder[]>('folders', [])
const save = (list: Folder[]) => setPref('folders', list)
const newId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

type DirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>
  queryPermission(options: { mode: 'read' }): Promise<PermissionState>
  requestPermission(options: { mode: 'read' }): Promise<PermissionState>
}
export const canLinkFolders = (isTauri && !isMobile) || (!isTauri && 'showDirectoryPicker' in window)

// Asks for a folder (or, where folders cannot be kept, for files to keep together) and remembers it.
export async function addFolder(): Promise<Folder | null> {
  let folder: Folder | null = null
  if (isTauri && !isMobile) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const path = await open({ directory: true, multiple: false })
    if (typeof path !== 'string') return null
    folder = { id: newId(), name: path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path, kind: 'path', path, added: Date.now() }
  } else if (!isTauri && 'showDirectoryPicker' in window) {
    const handle = await (window as unknown as { showDirectoryPicker(o: object): Promise<DirectoryHandle> }).showDirectoryPicker({ mode: 'read' }).catch(() => null)
    if (!handle) return null
    folder = { id: newId(), name: handle.name, kind: 'handle', added: Date.now() }
    const { set } = await import('idb-keyval')
    await set(`folder-handle:${folder.id}`, handle)
  } else {
    const files = await pickMany()
    if (!files.length) return null
    const name = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : `${files.length} files, ${new Date().toLocaleDateString()}`
    folder = { id: newId(), name, kind: 'kept', added: Date.now() }
    await keep(folder, files)
  }
  save([folder, ...folders().filter(old => !(old.kind === 'path' && old.path === folder!.path && folder!.kind === 'path'))])
  return folder
}

// More files put into a kept folder (phones and tablets).
export async function addFilesTo(folder: Folder): Promise<number> {
  const files = await pickMany()
  if (files.length) await keep(folder, files)
  return files.length
}

async function pickMany(): Promise<File[]> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({ multiple: true, filters: isMobile ? undefined : [{ name: 'Books and documents', extensions: KINDS }] })
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : []
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const android = (window as unknown as { SidepageAndroid?: { nameOf(reference: string): string } }).SidepageAndroid
    const files: File[] = []
    for (const path of paths) {
      try { files.push(new File([await readFile(path)], android?.nameOf(path) || path.split(/[\\/]/).pop() || 'book')) } catch { /* unreadable */ }
    }
    return files
  }
  return new Promise(resolve => {
    const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: KINDS.map(kind => `.${kind}`).join(',') })
    input.onchange = () => resolve([...(input.files ?? [])])
    input.oncancel = () => resolve([])
    input.click()
  })
}

async function keep(folder: Folder, files: File[]) {
  const { get, set } = await import('idb-keyval')
  const list = (await get<Entry[]>(`kept:${folder.id}`)) ?? []
  for (const file of files) {
    if (!KINDS.includes(extensionOf(file.name))) continue
    await set(`kept:${folder.id}:${file.name}`, file)
    if (!list.some(entry => entry.id === file.name)) list.push({ id: file.name, name: file.name, size: file.size })
  }
  list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  await set(`kept:${folder.id}`, list)
}

// Whether a browser folder still needs the reader's leave (asked again after the browser restarts).
export async function needsLeave(folder: Folder): Promise<boolean> {
  if (folder.kind !== 'handle') return false
  const handle = await handleOf(folder)
  return !handle || (await handle.queryPermission({ mode: 'read' })) !== 'granted'
}
export async function askLeave(folder: Folder): Promise<boolean> {
  const handle = await handleOf(folder)
  return !!handle && (await handle.requestPermission({ mode: 'read' })) === 'granted'
}
const handleOf = async (folder: Folder) => (await import('idb-keyval')).get<DirectoryHandle>(`folder-handle:${folder.id}`)

// The folder's readable files, as a tree, folders first then files, in natural order (2 before 10).
export async function listFolder(folder: Folder): Promise<Entry[]> {
  if (folder.kind === 'path') {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<Entry[]>('list_folder', { path: folder.path, kinds: KINDS })
  }
  if (folder.kind === 'kept') return (await (await import('idb-keyval')).get<Entry[]>(`kept:${folder.id}`)) ?? []
  const handle = await handleOf(folder)
  if (!handle) return []
  let budget = 5000
  const walk = async (dir: DirectoryHandle, prefix: string, depth: number): Promise<Entry[]> => {
    const found: Entry[] = []
    for await (const item of dir.values()) {
      if (budget <= 0 || item.name.startsWith('.') || item.name === 'node_modules') continue
      const id = prefix ? `${prefix}/${item.name}` : item.name
      if (item.kind === 'directory') {
        if (depth < 8) { const children = await walk(item as DirectoryHandle, id, depth + 1); if (children.length) found.push({ id, name: item.name, children, size: 0 }) }
      } else if (KINDS.includes(extensionOf(item.name))) {
        budget--
        found.push({ id, name: item.name, size: 0 })
      }
    }
    return found.sort(order)
  }
  return walk(handle, '', 0)
}
const order = (a: Entry, b: Entry) => (a.children ? 0 : 1) - (b.children ? 0 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true })

export async function openEntry(folder: Folder, id: string): Promise<File> {
  const name = id.split('/').pop() ?? id
  if (folder.kind === 'path') {
    const { invoke } = await import('@tauri-apps/api/core')
    const separator = folder.path!.includes('\\') ? '\\' : '/'
    const bytes = await invoke<ArrayBuffer>('read_path', { path: `${folder.path}${separator}${id.split('/').join(separator)}` })
    return new File([bytes], name)
  }
  if (folder.kind === 'kept') {
    const blob = await (await import('idb-keyval')).get<Blob>(`kept:${folder.id}:${id}`)
    if (!blob) throw new Error('This file is not kept any more.')
    return new File([blob], name)
  }
  let dir = (await handleOf(folder))!
  const parts = id.split('/')
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part) as DirectoryHandle
  return (await dir.getFileHandle(name)).getFile()
}

export async function removeFolder(folder: Folder) {
  save(folders().filter(other => other.id !== folder.id))
  const { del, get } = await import('idb-keyval')
  await del(`folder-handle:${folder.id}`)
  for (const entry of (await get<Entry[]>(`kept:${folder.id}`)) ?? []) await del(`kept:${folder.id}:${entry.id}`)
  await del(`kept:${folder.id}`)
}

// Every file of a tree, in the order shown: for going to the previous or next one.
export const filesIn = (entries: Entry[]): Entry[] => entries.flatMap(entry => entry.children ? filesIn(entry.children) : [entry])
export const countFiles = (entries: Entry[]) => filesIn(entries).length
