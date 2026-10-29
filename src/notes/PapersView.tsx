import { useEffect, useRef, useState } from 'react'
import ForceGraph from 'force-graph'
import { ArrowLeft, ExternalLink, FileDown, Search } from 'lucide-react'
import { openFileNow, openOutside, placeNow } from '../lib/platform'
import { usePref } from '../lib/prefs'
import { useTheme } from '../lib/theme'
import { authorsLine, citingWorks, findPapers, guessFromBook, paper as fetchPaper, paperFile, referencesOf, relatedTo, type Paper } from '../lib/papers'

type Tab = 'cites' | 'cited' | 'related' | 'map'
type Around = { cites: Paper[] | null; cited: Paper[] | null; related: Paper[] | null }

// The paper explorer: a work, what it cites, what cites it and what is near it, from OpenAlex. Any work can be
// explored in turn, and any free PDF opened in Sidepage beside your notes.
export default function PapersView() {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Paper[] | null>(null)
  const [focus, setFocus] = useState<Paper | null>(null)
  const [trail, setTrail] = useState<Paper[]>([])
  const [around, setAround] = useState<Around>({ cites: null, cited: null, related: null })
  const [tab, setTab] = useState<Tab>('cited')
  const [busy, setBusy] = useState('')
  const [problem, setProblem] = useState('')
  const [key, setKey] = usePref('openalex-key', '')
  const [showAbstract, setShowAbstract] = useState(false)

  const search = async (text: string) => {
    if (!text.trim()) return
    setBusy('Looking in OpenAlex…'); setProblem(''); setFocus(null); setTrail([])
    try {
      const papers = await findPapers(text)
      setFound(papers)
      if (papers.length === 1) explore(papers[0], false)
    } catch (error) { setProblem((error as Error).message || 'OpenAlex could not be reached.') }
    setBusy('')
  }

  // The book that is open starts the search, so the panel shows something useful at once.
  useEffect(() => {
    const here = placeNow()
    if (!here) return
    void guessFromBook(here.book).then(text => { setQuery(text); void search(text) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const explore = (work: Paper, remember = true) => {
    if (remember && focus) setTrail(earlier => [...earlier, focus])
    setFocus(work); setShowAbstract(false); setProblem('')
    setAround({ cites: null, cited: null, related: null })
  }
  useEffect(() => {
    if (!focus) return
    let cancelled = false
    const fill = (part: keyof Around, load: Promise<Paper[]>) => void load
      .then(list => { if (!cancelled) setAround(now => ({ ...now, [part]: list })) })
      .catch(error => { if (!cancelled) { setAround(now => ({ ...now, [part]: [] })); setProblem((error as Error).message) } })
    // A work found by a search comes without its lists of references; it is fetched whole first.
    void (focus.references.length || focus.related.length ? Promise.resolve(focus) : fetchPaper(focus.id)).then(whole => {
      if (cancelled) return
      fill('cites', referencesOf(whole))
      fill('cited', citingWorks(whole))
      fill('related', relatedTo(whole))
    }).catch(error => setProblem((error as Error).message))
    return () => { cancelled = true }
  }, [focus])

  const open = async (work: Paper) => {
    setBusy('Fetching the PDF…'); setProblem('')
    try { openFileNow(await paperFile(work)) } catch (error) {
      // In a browser, most publishers do not let another page fetch their PDFs (the installed app can): it is
      // opened in a tab of its own instead.
      if (work.pdf && ((error as Error).message === 'not-a-pdf' || !('__TAURI_INTERNALS__' in window))) {
        void openOutside(work.pdf)
        setProblem((error as Error).message === 'not-a-pdf'
          ? 'The publisher wants a browser for this PDF, so it opened in your browser. Save it there, then open it in Sidepage.'
          : 'The publisher does not let the browser version fetch this PDF, so it opened in a new tab. The installed app opens it beside your notes.')
      } else setProblem(`${(error as Error).message} Its page can be opened instead.`)
    }
    setBusy('')
  }

  const row = (work: Paper) => (
    <div key={work.id} className="paper-row">
      <button className="paper-main" onClick={() => explore(work)} title="Explore from this work">
        <span className="paper-title">{work.title}</span>
        <span className="paper-meta">{[authorsLine(work), work.year, work.venue].filter(Boolean).join(' · ')}</span>
      </button>
      <span className="paper-side">
        <span className="paper-count" title="Times cited">{work.cites.toLocaleString()}</span>
        {work.pdf && <button className="paper-free" onClick={() => void open(work)} title="Open the free PDF in Sidepage">Free PDF</button>}
      </span>
    </div>
  )
  const list = (papers: Paper[] | null, empty: string) => papers === null
    ? <p className="guide-wait">Gathering…</p>
    : papers.length ? papers.map(row) : <p className="guide-wait">{empty}</p>

  return (
    <div className="note papers">
      <form className="ask" onSubmit={e => { e.preventDefault(); void search(query) }}>
        <input value={query} placeholder="A subject, a title or a DOI" onChange={e => setQuery(e.target.value)} />
        <button className="primary" disabled={!!busy || !query.trim()}><Search size={16} aria-hidden /> Find</button>
      </form>
      {busy && <p className="guide-wait">{busy}</p>}
      {problem && <p className="guide-wait">{problem}</p>}

      {!focus && found && (
        <section>
          <p className="eyebrow">{found.length ? 'Choose the work to explore' : 'Nothing found. Try other words.'}</p>
          {found.map(row)}
        </section>
      )}

      {focus && (
        <section className="paper-focus">
          <div className="paper-nav">
            <button className="soft" onClick={() => { const back = trail.at(-1); if (back) { setTrail(trail.slice(0, -1)); explore(back, false) } else setFocus(null) }}>
              <ArrowLeft size={15} aria-hidden /> {trail.length ? 'Back' : 'Results'}
            </button>
          </div>
          <h2>{focus.title}</h2>
          <p className="paper-meta">{[authorsLine(focus), focus.year, focus.venue].filter(Boolean).join(' · ')}</p>
          <p className="paper-meta">{`Cited ${focus.cites.toLocaleString()} times`}{focus.doi ? ` · doi ${focus.doi}` : ''}</p>
          {focus.abstract && (
            <p className={showAbstract ? 'paper-abstract' : 'paper-abstract folded'} onClick={() => setShowAbstract(!showAbstract)}>{focus.abstract}</p>
          )}
          <div className="paper-actions">
            {focus.pdf && <button className="primary" onClick={() => void open(focus)}><FileDown size={16} aria-hidden /> Open the free PDF</button>}
            {focus.page && <button className="soft" onClick={() => void openOutside(focus.page!)}><ExternalLink size={16} aria-hidden /> Its page</button>}
          </div>
          <div className="menu-segment paper-tabs" role="tablist">
            {([['cited', 'Cited by', around.cited], ['cites', 'It cites', around.cites], ['related', 'Related', around.related], ['map', 'Map', null]] as const).map(([name, label, papers]) => (
              <button key={name} role="tab" className={tab === name ? 'on' : ''} onClick={() => setTab(name)}>
                {label}{papers ? ` ${papers.length}` : ''}
              </button>
            ))}
          </div>
          {tab === 'cited' && list(around.cited, 'Nothing cites it yet.')}
          {tab === 'cites' && list(around.cites, 'OpenAlex does not know what it cites.')}
          {tab === 'related' && list(around.related, 'Nothing related was found.')}
          {tab === 'map' && <PaperMap focus={focus} around={around} onPick={explore} />}
        </section>
      )}

      <details className="paper-key">
        <summary>Searching a lot?</summary>
        <p className="menu-note">OpenAlex is free with a daily allowance for each network. A free key from openalex.org gives you an allowance of your own.</p>
        <input className="menu-input" value={key} placeholder="OpenAlex key (optional)" onChange={e => setKey(e.target.value.trim())} />
      </details>
    </div>
  )
}

// The work in the middle, what it cites on one side, what cites it on the other, related works around; the
// bigger the dot, the more it has been cited. A dot picked becomes the middle.
function PaperMap({ focus, around, onPick }: { focus: Paper; around: Around; onPick(work: Paper): void }) {
  const holder = useRef<HTMLDivElement>(null)
  const theme = useTheme()
  useEffect(() => {
    const el = holder.current
    if (!el) return
    const colour = (name: string) => getComputedStyle(el).getPropertyValue(name).trim() || '#888'
    type Dot = { id: string; work: Paper; kind: 'focus' | 'cites' | 'cited' | 'related'; x?: number; y?: number }
    const dots = new Map<string, Dot>([[focus.id, { id: focus.id, work: focus, kind: 'focus' }]])
    const links: { source: string; target: string }[] = []
    const add = (papers: Paper[] | null, kind: Dot['kind']) => (papers ?? []).slice(0, 30).forEach(work => {
      if (!dots.has(work.id)) dots.set(work.id, { id: work.id, work, kind })
      links.push(kind === 'cited' ? { source: work.id, target: focus.id } : { source: focus.id, target: work.id })
    })
    add(around.cites, 'cites'); add(around.cited, 'cited'); add(around.related, 'related')
    const fills = { focus: colour('--accent'), cites: '#4a8fd9', cited: '#3fae6a', related: '#9aa0a6' }
    const graph = new ForceGraph(el)
      .width(el.clientWidth).height(Math.max(320, el.clientHeight))
      .backgroundColor('rgba(0,0,0,0)')
      .graphData({ nodes: [...dots.values()], links })
      .linkColor(() => colour('--border') || '#bbb')
      .linkDirectionalArrowLength(3).linkDirectionalArrowRelPos(1)
      .nodeLabel(node => { const dot = node as Dot; return `${dot.work.title} (${dot.work.year ?? '?'}, cited ${dot.work.cites})` })
      .nodeCanvasObject((node, ctx) => {
        const dot = node as Dot
        const radius = dot.kind === 'focus' ? 7 : 2 + Math.min(5, Math.log10(dot.work.cites + 1) * 1.3)
        ctx.beginPath(); ctx.arc(dot.x ?? 0, dot.y ?? 0, radius, 0, Math.PI * 2)
        ctx.fillStyle = fills[dot.kind]; ctx.fill()
      })
      .nodePointerAreaPaint((node, paint, ctx) => { const dot = node as Dot; ctx.fillStyle = paint; ctx.beginPath(); ctx.arc(dot.x ?? 0, dot.y ?? 0, 10, 0, Math.PI * 2); ctx.fill() })
      .onNodeClick(node => { const dot = node as Dot; if (dot.kind !== 'focus') onPick(dot.work) })
    // Room between the dots, so each can be told apart and tapped.
    graph.d3Force('charge')?.strength(-90)
    ;(graph.d3Force('link') as unknown as { distance(d: number): void } | undefined)?.distance(70)
    const fit = setTimeout(() => graph.zoomToFit(400, 30), 900)
    return () => { clearTimeout(fit); graph._destructor() }
  }, [focus, around, onPick, theme])
  return (
    <>
      <div className="paper-map" ref={holder} />
      <p className="paper-legend"><i style={{ background: '#4a8fd9' }} /> It cites <i style={{ background: '#3fae6a' }} /> Cited by <i style={{ background: '#9aa0a6' }} /> Related</p>
    </>
  )
}
