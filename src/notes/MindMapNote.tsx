import { useEffect, useRef } from 'react'
import MindElixir from 'mind-elixir'
import 'mind-elixir/style.css'
import { debounce, loadNote, saveNote } from '../lib/platform'

// Mind map (Mind Elixir), saved as mindmap.json.
export default function MindMapNote({ notebook }: { notebook: string }) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let mind: InstanceType<typeof MindElixir> | undefined
    const save = debounce(() => {
      if (mind) void saveNote(notebook, 'mindmap.json', JSON.stringify(mind.getData()))
    }, 500)
    loadNote(notebook, 'mindmap.json').then(saved => {
      if (cancelled || !host.current) return
      mind = new MindElixir({ el: host.current, direction: MindElixir.SIDE })
      mind.init(saved ? JSON.parse(saved) : MindElixir.new(notebook))
      mind.bus.addListener('operation', save)
    })
    return () => {
      cancelled = true
      mind?.destroy?.()
    }
  }, [notebook])

  return <div ref={host} className="note mindmap-note" />
}
