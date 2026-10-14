import { useEffect, useRef, useState } from 'react'
import MindElixir from 'mind-elixir'
import 'mind-elixir/style.css'
import { FileDown, ListTree, Sparkles } from 'lucide-react'
import { Tool } from '../ui'
import { debounce, loadNote, saveFileAs, saveNote, shelf } from '../lib/platform'
import { ideaTree, termsOf } from '../lib/insight'
import { useTheme } from '../lib/theme'

type Branch = { id: string; topic: string; children: Branch[] }
let made = 0
const branch = (topic: string): Branch => ({ id: `n${Date.now().toString(36)}${made++}`, topic, children: [] })

// A note's shape as branches: each heading a branch, deeper headings and bullet points under it.
function branchesOf(markdown: string): Branch[] {
  const top: Branch[] = []
  // The heading each level is currently under, so a deeper heading knows its parent.
  const open: (Branch | undefined)[] = []
  for (const raw of markdown.split('\n')) {
    const heading = raw.match(/^(#{1,6})\s+(.+)/)
    const bullet = raw.match(/^\s*(?:[-*+]|\d+\.)\s+(.+)/)
    const question = raw.match(/^\s*Q[:.]\s*(.+)/i)
    const clean = (text: string) => text.replace(/<\/?(?:span|u|sup|sub|div)\b[^>]*>/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').trim().slice(0, 90)
    if (heading) {
      const level = heading[1].length
      const node = branch(clean(heading[2]))
      const parent = open.slice(0, level).reverse().find(Boolean)
      ;(parent ? parent.children : top).push(node)
      open.length = level
      open[level] = node
    } else if (bullet || question) {
      const text = clean((bullet ?? question)![1])
      if (!text) continue
      const parent = [...open].reverse().find(Boolean)
      ;(parent ? parent.children : top).push(branch(text))
    }
  }
  return top
}

// Mind map (Mind Elixir), saved as mindmap.json.
export default function MindMapNote({ notebook }: { notebook: string }) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<InstanceType<typeof MindElixir> | null>(null)
  const theme = useTheme()
  const themeAtStart = useRef(theme)
  themeAtStart.current = theme

  useEffect(() => {
    map.current?.changeTheme(theme === 'dark' ? MindElixir.DARK_THEME : MindElixir.THEME)
  }, [theme])

  useEffect(() => {
    let cancelled = false
    let mind: InstanceType<typeof MindElixir> | undefined
    let centre: ResizeObserver | undefined
    const save = debounce(() => {
      if (mind) void saveNote(notebook, 'mindmap.json', JSON.stringify(mind.getData()))
    }, 500)
    loadNote(notebook, 'mindmap.json').then(saved => {
      if (cancelled || !host.current) return
      mind = new MindElixir({ el: host.current, direction: MindElixir.SIDE })
      mind.init(saved ? JSON.parse(saved) : MindElixir.new(notebook))
      map.current = mind
      if (themeAtStart.current === 'dark') mind.changeTheme(MindElixir.DARK_THEME)
      mind.bus.addListener('operation', save)
      // A map created in a hidden tab has no size yet; centre it the first time it is shown.
      centre = new ResizeObserver(() => {
        if (!host.current?.clientWidth) return
        mind?.toCenter()
        centre?.disconnect()
      })
      centre.observe(host.current)
    })
    return () => {
      cancelled = true
      centre?.disconnect()
      mind?.destroy?.()
      map.current = null
    }
  }, [notebook])

  // Grow the map from the written notes: their headings and bullet points are added as branches. What is
  // already on the map stays; a branch with the same name as one already there is not added twice.
  const fromNotes = async () => {
    const mind = map.current
    if (!mind) return
    const data = mind.getData()
    const root = data.nodeData as unknown as Branch
    const have = new Set((root.children ?? []).map(child => child.topic))
    let found = branchesOf((await loadNote(notebook, 'notes.md')) ?? '')
    // A note usually opens with the book's title as its one main heading; the map already has that at its centre.
    if (found.length === 1 && found[0].topic === root.topic) found = found[0].children
    const fresh = found.filter(node => !have.has(node.topic))
    if (!fresh.length) return
    root.children = [...(root.children ?? []), ...fresh]
    mind.refresh(data)
    mind.toCenter()
    await saveNote(notebook, 'mindmap.json', JSON.stringify(mind.getData()))
  }

  // Grow the map from the book itself: its key terms, each gathered under the one it keeps company with.
  const [growing, setGrowing] = useState('')
  const fromBook = async () => {
    const mind = map.current
    if (!mind) return
    const book = (await shelf()).map(entry => entry.name).find(name => name.replace(/\.[^.]+$/, '') === notebook)
    if (!book) return setGrowing('Open the book once first, so its words are known.')
    setGrowing('Going through the book…')
    const tree = ideaTree(await termsOf(book))
    if (!tree.length) return setGrowing('This book\'s words are not gathered yet. Open it and give it a moment.')
    const data = mind.getData()
    const root = data.nodeData as unknown as Branch
    const have = new Set((root.children ?? []).map(child => child.topic))
    const fresh = tree.filter(idea => !have.has(idea.topic)).map(idea => ({ ...branch(idea.topic), children: idea.children.map(child => branch(child.topic)) }))
    root.children = [...(root.children ?? []), ...fresh]
    mind.refresh(data)
    mind.toCenter()
    await saveNote(notebook, 'mindmap.json', JSON.stringify(mind.getData()))
    setGrowing('')
  }

  // The map written out as an outline: each branch a point, its branches indented under it.
  const saveOutline = async () => {
    const mind = map.current
    if (!mind) return
    const root = mind.getData().nodeData as unknown as Branch
    const lines = (node: Branch, depth: number): string[] => [`${'  '.repeat(depth)}- ${node.topic}`, ...(node.children ?? []).flatMap(child => lines(child, depth + 1))]
    await saveFileAs(`${notebook} mind map.md`, new TextEncoder().encode(`# ${root.topic}\n\n${(root.children ?? []).flatMap(child => lines(child, 0)).join('\n')}\n`))
  }

  return (
    <div className="note mindmap-wrap">
      <div ref={host} className="mindmap-note" />
      <div className="page-bar">
        <Tool icon={ListTree} label="Grow from my notes" hint="Add the headings and bullet points of this book's written notes as branches" onClick={() => void fromNotes()} />
        <Tool icon={Sparkles} label="Grow from the book's ideas" hint="Add the book's key terms as branches, each gathered under the one it keeps company with" onClick={() => void fromBook()} />
        {growing && <span className="viewer-pos">{growing}</span>}
        <Tool icon={FileDown} label="Save as an outline" hint="The map as a Markdown file of nested points" onClick={() => void saveOutline()} />
      </div>
    </div>
  )
}
