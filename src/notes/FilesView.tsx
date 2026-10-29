import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tree, type NodeRendererProps } from 'react-arborist'
import { FolderClosed, BookImage, BookOpen, ChevronDown, ChevronLeft, ChevronRight, File as FileIcon, FileText, FolderOpen, FolderPlus, Globe, Image, Plus, Presentation, RefreshCw, Search, Trash2 } from 'lucide-react'
import { extensionOf, onPlace, openFileNow, placeNow } from '../lib/platform'
import { usePref } from '../lib/prefs'
import { addFilesTo, addFolder, askLeave, canLinkFolders, countFiles, filesIn, folders as savedFolders, listFolder, needsLeave, openEntry, removeFolder, type Entry, type Folder } from '../lib/folders'

// A file's look, from its kind.
const iconOf = (name: string) => {
  const kind = extensionOf(name)
  if (kind === 'pdf') return FileText
  if (['epub', 'mobi', 'azw', 'azw3', 'kf8', 'fb2', 'fbz'].includes(kind)) return BookOpen
  if (['cbz', 'cbr', 'cb7', 'cbt', 'djvu', 'djv'].includes(kind)) return BookImage
  if (['pptx', 'ppt', 'pps'].includes(kind)) return Presentation
  if (['html', 'htm'].includes(kind)) return Globe
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(kind)) return Image
  if (['docx', 'doc', 'odt', 'rtf', 'txt', 'md', 'markdown'].includes(kind)) return FileText
  return FileIcon
}
const KIND_COLOUR: Record<string, string> = { pdf: '#d0453b', epub: '#3f7fd6', docx: '#2b5fb4', doc: '#2b5fb4', pptx: '#d2692c', ppt: '#d2692c', md: '#6b6f78', txt: '#6b6f78', html: '#2f8f74' }

// Step to the previous or next file of the folder from anywhere (the palette, a key).
export const stepInFolder = (by: 1 | -1) => window.dispatchEvent(new CustomEvent('sidepage:folder-step', { detail: by }))

// The folders panel: the files of a folder as a tree, opened with a tap, and stepped through one after another.
export default function FilesView() {
  const [list, setList] = useState<Folder[]>(savedFolders)
  const [currentId, setCurrentId] = usePref('folder-current', '')
  const folder = list.find(found => found.id === currentId) ?? list[0]
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [locked, setLocked] = useState(false)
  const [problem, setProblem] = useState('')
  const [search, setSearch] = useState('')
  const [openName, setOpenName] = useState(() => placeNow()?.book ?? '')
  const [lastOpened, setLastOpened] = usePref<Record<string, string>>('folder-last', {})
  const [choosing, setChoosing] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 280, height: 400 })
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

  useEffect(() => onPlace(here => setOpenName(here.book)), [])
  useEffect(() => {
    const el = host.current
    if (!el) return
    const watch = new ResizeObserver(() => setSize({ width: el.clientWidth - 8, height: el.clientHeight }))
    watch.observe(el)
    return () => watch.disconnect()
  }, [entries])

  const load = useCallback(async (which: Folder | undefined) => {
    setEntries(null); setProblem(''); setLocked(false)
    if (!which) return setEntries([])
    if (await needsLeave(which)) { setLocked(true); return setEntries([]) }
    try { setEntries(await listFolder(which)) } catch (error) { setProblem(String((error as Error)?.message ?? error)); setEntries([]) }
  }, [])
  useEffect(() => { void load(folder) }, [folder?.id, load]) // eslint-disable-line react-hooks/exhaustive-deps

  const files = useMemo(() => filesIn(entries ?? []), [entries])
  const currentFile = files.find(file => file.name === openName)?.id ?? (folder ? lastOpened[folder.id] : undefined)
  // Where the open book stands in the folder, for the small stepper shown over the book when this list is out of
  // sight (on a phone, the list is a tab of its own).
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const tell = () => {
      const index = files.findIndex(file => file.name === openName)
      window.dispatchEvent(new CustomEvent('sidepage:folder-position', { detail: { index, total: files.length, shown: !!panel.current && panel.current.offsetWidth > 0 } }))
    }
    tell()
    const watch = new ResizeObserver(tell)
    if (panel.current) watch.observe(panel.current)
    return () => watch.disconnect()
  }, [files, openName])

  const open = useCallback(async (id: string) => {
    if (!folder) return
    try {
      openFileNow(await openEntry(folder, id))
      setLastOpened({ ...lastOpened, [folder.id]: id })
    } catch (error) { setProblem(String((error as Error)?.message ?? error)) }
  }, [folder, lastOpened, setLastOpened])

  const step = useCallback((by: number) => {
    if (!files.length) return
    const at = files.findIndex(file => file.id === currentFile)
    const next = files[at < 0 ? 0 : (at + by + files.length) % files.length]
    void open(next.id)
  }, [files, currentFile, open])
  useEffect(() => {
    const onStep = (e: Event) => step((e as CustomEvent<number>).detail)
    const onKey = (e: KeyboardEvent) => { if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); step(e.key === 'ArrowDown' ? 1 : -1) } }
    window.addEventListener('sidepage:folder-step', onStep)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('sidepage:folder-step', onStep); window.removeEventListener('keydown', onKey) }
  }, [step])

  const add = async () => {
    const made = await addFolder().catch(error => { setProblem(String(error?.message ?? error)); return null })
    if (!made) return
    setList(savedFolders()); setCurrentId(made.id)
  }

  const Row = ({ node, style }: NodeRendererProps<Entry>) => {
    const Icon = node.isLeaf ? iconOf(node.data.name) : node.isOpen ? FolderOpen : FolderClosed
    const colour = node.isLeaf ? KIND_COLOUR[extensionOf(node.data.name)] : undefined
    return (
      <div style={style} className={`file-row${node.isLeaf && node.id === currentFile ? ' current' : ''}${node.isSelected ? ' selected' : ''}${node.isFocused ? ' focused' : ''}`}
        onClick={() => (node.isLeaf ? void open(node.id) : node.toggle())} title={node.data.name}>
        {!node.isLeaf ? <ChevronDown size={14} className={node.isOpen ? 'file-chevron open' : 'file-chevron'} aria-hidden /> : <span className="file-chevron" />}
        <Icon size={17} aria-hidden style={colour ? { color: colour } : undefined} className={node.isLeaf ? 'file-icon' : 'file-icon folder'} />
        <span className="file-name">{node.isLeaf ? node.data.name.replace(/\.[^.]+$/, '') : node.data.name}</span>
        {node.isLeaf && <span className="file-kind">{extensionOf(node.data.name)}</span>}
        {!node.isLeaf && <span className="file-count">{countFiles(node.data.children ?? [])}</span>}
      </div>
    )
  }

  if (!list.length) {
    return (
      <div className="note files" ref={panel}>
        <div className="review-empty">
          <h2>Your folders</h2>
          <p>{canLinkFolders
            ? 'Open a folder of books, papers, slides or notes once. It stays here: open any file with a tap, and move to the next or the previous one as you work.'
            : 'Choose the files you want together (lecture slides, papers, a course). Sidepage keeps them as one folder: open any with a tap, and move to the next or the previous one as you work.'}</p>
          <button className="primary" onClick={() => void add()}><FolderPlus size={17} aria-hidden /> {canLinkFolders ? 'Open a folder' : 'Choose files to keep together'}</button>
          {problem && <p className="guide-wait">{problem}</p>}
        </div>
      </div>
    )
  }

  const at = files.findIndex(file => file.id === currentFile)
  return (
    <div className="note files" ref={panel}>
      <div className="files-head">
        <button className="files-folder" onClick={() => setChoosing(!choosing)} aria-expanded={choosing} title="Change folder">
          <FolderOpen size={18} aria-hidden /><span>{folder?.name}</span><ChevronDown size={15} aria-hidden />
        </button>
        <button className="files-tool" onClick={() => void load(folder)} title="Look again for new files" aria-label="Refresh"><RefreshCw size={16} aria-hidden /></button>
        {folder?.kind === 'kept' && <button className="files-tool" title="Add files to this folder" aria-label="Add files" onClick={() => void addFilesTo(folder).then(count => { if (count) void load(folder) })}><Plus size={17} aria-hidden /></button>}
      </div>
      {choosing && (
        <div className="files-choose">
          {list.map(other => (
            <div key={other.id} className={other.id === folder?.id ? 'files-choice on' : 'files-choice'}>
              <button onClick={() => { setCurrentId(other.id); setChoosing(false) }}><FolderOpen size={16} aria-hidden /> {other.name}</button>
              <button className="files-tool" title="Forget this folder (its files are not touched)" aria-label="Forget this folder"
                onClick={() => void removeFolder(other).then(() => { const rest = savedFolders(); setList(rest); if (other.id === folder?.id) setCurrentId(rest[0]?.id ?? '') })}><Trash2 size={15} aria-hidden /></button>
            </div>
          ))}
          <button className="files-choice add" onClick={() => { setChoosing(false); void add() }}><FolderPlus size={16} aria-hidden /> {canLinkFolders ? 'Open another folder' : 'Keep more files as a folder'}</button>
        </div>
      )}
      <label className="files-search">
        <Search size={15} aria-hidden />
        <input value={search} placeholder={`Find in ${files.length} file${files.length === 1 ? '' : 's'}`} onChange={e => setSearch(e.target.value)} />
      </label>
      {locked && folder && <button className="primary files-leave" onClick={() => void askLeave(folder).then(ok => { if (ok) void load(folder) })}>Let Sidepage into “{folder.name}” again</button>}
      {problem && <p className="guide-wait">{problem}</p>}
      <div className="files-tree" ref={host}>
        {entries === null
          ? <p className="guide-wait">Looking through the folder…</p>
          : entries.length || locked
            ? <Tree<Entry> data={entries} idAccessor="id" childrenAccessor={entry => entry.children ?? null} openByDefault={files.length < 60}
                width={size.width} height={size.height} rowHeight={touch ? 44 : 34} indent={16} padding={4}
                searchTerm={search} searchMatch={(node, term) => node.data.name.toLowerCase().includes(term.toLowerCase())}
                disableDrag disableDrop disableEdit disableMultiSelection selection={currentFile}
                onActivate={node => { if (node.isLeaf) void open(node.id) }}>
                {Row}
              </Tree>
            : <p className="guide-wait">No books or documents in this folder.</p>}
      </div>
      <div className="files-foot">
        <button className="files-step" disabled={!files.length} onClick={() => step(-1)} title="The previous file (Alt+↑)"><ChevronLeft size={17} aria-hidden /> Previous</button>
        <span className="files-where">{at >= 0 ? `${at + 1} of ${files.length}` : `${files.length} file${files.length === 1 ? '' : 's'}`}</span>
        <button className="files-step" disabled={!files.length} onClick={() => step(1)} title="The next file (Alt+↓)">Next <ChevronRight size={17} aria-hidden /></button>
      </div>
    </div>
  )
}
