import { useEffect, useRef } from 'react'
import ForceGraph from 'force-graph'
import { baseName, noteLinks, openBookByName, shelf } from '../lib/platform'
import { useTheme } from '../lib/theme'

type Node = { id: string; label: string; links: number; x?: number; y?: number }

// Every book on the shelf as a dot, joined wherever one book's notes link to another (drawn by force-graph).
export default function GraphView() {
  const host = useRef<HTMLDivElement>(null)
  const theme = useTheme()

  useEffect(() => {
    const el = host.current!
    let cancelled = false
    let graph: InstanceType<typeof ForceGraph> | undefined
    const css = getComputedStyle(document.documentElement)
    const colour = (name: string) => css.getPropertyValue(name).trim()
    ;(async () => {
      const [books, links] = await Promise.all([shelf(), noteLinks()])
      if (cancelled) return
      const names = new Set(books.map(book => book.name))
      const joined = links.filter(link => names.has(link.from) && names.has(link.to))
      const nodes: Node[] = books.map(book => ({
        id: book.name,
        label: baseName(book.name),
        links: joined.filter(link => link.from === book.name || link.to === book.name).length,
      }))
      graph = new ForceGraph(el)
        .width(el.clientWidth)
        .height(el.clientHeight)
        .backgroundColor('rgba(0,0,0,0)')
        .graphData({ nodes, links: joined.map(link => ({ source: link.from, target: link.to })) })
        .linkColor(() => colour('--muted'))
        .linkDirectionalArrowLength(5)
        .linkDirectionalArrowRelPos(1)
        .nodeCanvasObject((node, ctx, scale) => {
          const { x = 0, y = 0, label, links: count } = node as Node
          const radius = 5 + Math.min(count, 6)
          ctx.beginPath()
          ctx.arc(x, y, radius, 0, Math.PI * 2)
          ctx.fillStyle = colour('--accent')
          ctx.fill()
          ctx.font = `${12 / scale}px system-ui, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.fillStyle = colour('--text')
          ctx.fillText(label, x, y + radius + 3 / scale)
        })
        .nodePointerAreaPaint((node, paint, ctx) => {
          ctx.fillStyle = paint
          ctx.beginPath()
          ctx.arc(node.x ?? 0, node.y ?? 0, 12, 0, Math.PI * 2)
          ctx.fill()
        })
        .onNodeClick(node => openBookByName((node as Node).id))
      // Fit everything in view once the dots settle, without blowing a small graph up to fill the panel.
      graph.cooldownTime(1500).onEngineStop(() => {
        graph?.zoomToFit(0, 80)
        if ((graph?.zoom() ?? 1) > 1.6) graph?.zoom(1.6)
      })
    })()
    const resize = new ResizeObserver(() => graph?.width(el.clientWidth).height(el.clientHeight))
    resize.observe(el)
    return () => {
      cancelled = true
      resize.disconnect()
      graph?._destructor()
      el.replaceChildren()
    }
  }, [theme])

  return <div ref={host} className="note graph-view" />
}
