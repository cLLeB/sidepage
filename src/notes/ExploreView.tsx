import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph from 'force-graph'
import { useTheme } from '../lib/theme'
import { baseName, goToPlace, onPlace, placeNow, shelf, type Place } from '../lib/platform'
import { placeName } from '../lib/library'
import { usePref } from '../lib/prefs'
import { usesOf, type Use } from '../lib/pages'
import { arcOf, charactersOf, locate, phrasesOf, placesOf, styleOf, type Character, type Meeting, type Mood, type Phrase, type Spot, type Style } from '../lib/explore'
import 'leaflet/dist/leaflet.css'

// The book from above: its people, its mood, its phrases, its places, and how it is written.
const PARTS = { people: 'People', mood: 'Mood', phrases: 'Phrases', places: 'Places', style: 'Style', listen: 'Listen' } as const
type Part = keyof typeof PARTS

export default function ExploreView() {
  const [here, setHere] = useState<Place | null>(placeNow)
  useEffect(() => { const stop = onPlace(setHere); setHere(placeNow()); return stop }, [])
  const [part, setPart] = usePref<Part>('explore-part', 'people')
  const book = here?.book
  const go = (place: string) => { if (book) goToPlace({ book, place }) }
  return (
    <div className="guide explore">
      <div className="practice-tabs" role="tablist">
        {(Object.keys(PARTS) as Part[]).map(key => <button key={key} role="tab" aria-selected={part === key} className={part === key ? 'chip on' : 'chip'} onClick={() => setPart(key)}>{PARTS[key]}</button>)}
      </div>
      {!book ? <p className="guide-wait">Open a book first.</p> : <>
        {part === 'people' && <People book={book} onGo={go} />}
        {part === 'mood' && <MoodArc book={book} onGo={go} />}
        {part === 'phrases' && <Phrases book={book} onGo={go} />}
        {part === 'places' && <Places book={book} onGo={go} />}
        {part === 'style' && <StyleCompare book={book} />}
        {part === 'listen' && here && <ListenMaker here={here} />}
      </>}
    </div>
  )
}

// Where in the book something comes: a strip from start to end with a mark at each part.
function Strip({ places, all, onGo }: { places: string[]; all: number; onGo(place: string): void }) {
  const number = (place: string) => Number(place.match(/\d+/)?.[0] ?? 0)
  const first = (place: string) => (place.startsWith('section') ? 0 : 1)
  return (
    <div className="strip" title="Where it comes, from the start of the book to the end">
      {places.map(place => <button key={place} style={{ left: `${((number(place) - first(place)) / Math.max(1, all)) * 100}%` }} title={placeName(place)} aria-label={placeName(place)} onClick={() => onGo(place)} />)}
    </div>
  )
}

// ── People: who is in the book, and who comes with whom ──
function People({ book, onGo }: { book: string; onGo(place: string): void }) {
  const [found, setFound] = useState<{ people: Character[]; meetings: Meeting[] } | null>(null)
  const [picked, setPicked] = useState<Character | null>(null)
  const [parts, setParts] = useState(1)
  useEffect(() => {
    setFound(null); setPicked(null)
    let cancelled = false
    void charactersOf(book).then(result => { if (!cancelled) setFound(result) })
    void import('../lib/insight').then(({ stretchesOf }) => stretchesOf(book)).then(all => setParts(all.length))
    return () => { cancelled = true }
  }, [book])
  if (!found) return <p className="guide-wait">Finding the people in the book…</p>
  if (!found.people.length) return <p className="guide-wait">No names come often enough in this book to make out its people.</p>
  return (
    <section>
      <p className="menu-note">Each name is sized by how often it comes; a line joins people named on the same pages, thicker the more often.</p>
      <NameMap people={found.people} meetings={found.meetings} onPick={setPicked} />
      {picked && <div className="picked">
        <b>{picked.name}</b> <span className="menu-note">{`named ${picked.count} times, on ${picked.places.length} pages`}</span>
        <Strip places={picked.places} all={parts} onGo={onGo} />
        <p className="menu-note">{found.meetings.filter(m => m.source === picked.name || m.target === picked.name).slice(0, 6).map(m => (m.source === picked.name ? m.target : m.source)).join(', ')}</p>
      </div>}
      <ol className="order-list">
        {found.people.slice(0, 15).map(person => <li key={person.name}><button className="link-button" onClick={() => setPicked(person)}>{person.name}</button> <span className="menu-note">{person.count}</span></li>)}
      </ol>
    </section>
  )
}
function NameMap({ people, meetings, onPick }: { people: Character[]; meetings: Meeting[]; onPick(person: Character): void }) {
  const host = useRef<HTMLDivElement>(null)
  const theme = useTheme()
  const pick = useRef(onPick)
  pick.current = onPick
  useEffect(() => {
    const el = host.current
    if (!el) return
    const css = getComputedStyle(document.documentElement)
    const colour = (name: string) => css.getPropertyValue(name).trim()
    const most = Math.max(...people.map(person => person.count))
    const strongest = Math.max(1, ...meetings.map(meeting => meeting.together))
    type Dot = { id: string; count: number; x?: number; y?: number }
    const graph = new ForceGraph(el)
      .width(el.clientWidth).height(el.clientHeight).backgroundColor('rgba(0,0,0,0)')
      // People with no one beside them stay in the list below, off the map, so it is not zoomed out for them.
      .graphData({ nodes: people.filter(person => meetings.some(m => m.source === person.name || m.target === person.name)).map(person => ({ id: person.name, count: person.count })), links: meetings.map(meeting => ({ ...meeting })) })
      .linkColor(() => colour('--border')).linkWidth(link => 0.6 + 5 * ((link as Meeting).together / strongest))
      .nodeCanvasObject((node, ctx, scale) => {
        const { x = 0, y = 0, id, count } = node as Dot
        const radius = 3 + 9 * Math.sqrt(count / most)
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = colour('--accent'); ctx.fill()
        ctx.font = `${11.5 / scale}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = colour('--text')
        ctx.fillText(id, x, y + radius + 2 / scale)
      })
      .nodePointerAreaPaint((node, paint, ctx) => { ctx.fillStyle = paint; ctx.beginPath(); ctx.arc(node.x ?? 0, node.y ?? 0, 12, 0, Math.PI * 2); ctx.fill() })
      .onNodeClick(node => { const person = people.find(found => found.name === (node as Dot).id); if (person) pick.current(person) })
      .cooldownTime(1800)
      .onEngineStop(() => graph.zoomToFit(0, 30))
    // People push apart harder than terms do, so a crowded cast still reads.
    ;(graph.d3Force('charge') as unknown as { strength(n: number): void } | undefined)?.strength(-160)
    ;(graph.d3Force('link') as unknown as { distance(n: number): void } | undefined)?.distance(70)
    const resize = new ResizeObserver(() => graph.width(el.clientWidth).height(el.clientHeight))
    resize.observe(el)
    return () => { resize.disconnect(); graph._destructor(); el.replaceChildren() }
  }, [people, meetings, theme])
  return <div ref={host} className="idea-map" />
}

// ── Mood: the book's emotional arc, part by part ──
function MoodArc({ book, onGo }: { book: string; onGo(place: string): void }) {
  const [arc, setArc] = useState<Mood[] | 'language' | null>(null)
  useEffect(() => { setArc(null); let cancelled = false; void arcOf(book).then(found => { if (!cancelled) setArc(found) }); return () => { cancelled = true } }, [book])
  if (!arc) return <p className="guide-wait">Reading the mood of each part…</p>
  if (arc === 'language') return <p className="guide-wait">The mood can be read in English books only.</p>
  if (arc.length < 3) return <p className="guide-wait">This book is too short to show a mood that rises and falls.</p>
  const [w, h, pad] = [600, 200, 14]
  const top = Math.max(...arc.map(mood => Math.abs(mood.score)), 0.01)
  const x = (i: number) => pad + (i / (arc.length - 1)) * (w - pad * 2)
  const y = (score: number) => h / 2 - (score / top) * (h / 2 - pad)
  const line = arc.map((mood, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(mood.score).toFixed(1)}`).join(' ')
  const brightest = arc.reduce((a, b) => (b.score > a.score ? b : a))
  const darkest = arc.reduce((a, b) => (b.score < a.score ? b : a))
  return (
    <section>
      <p className="menu-note">Above the line, the words of that part are mostly warm and hopeful; below it, mostly dark or sad. Click the line to go there.</p>
      <svg className="mood" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="The mood of the book from start to end">
        <line x1={pad} x2={w - pad} y1={h / 2} y2={h / 2} className="mood-axis" />
        <path d={`${line} L${x(arc.length - 1)},${h / 2} L${x(0)},${h / 2} Z`} className="mood-area" />
        <path d={line} className="mood-line" />
        {arc.map((mood, i) => <rect key={mood.place} x={x(i) - w / arc.length / 2} y={0} width={w / arc.length} height={h} className="mood-hit" onClick={() => onGo(mood.place)}><title>{placeName(mood.place)}</title></rect>)}
      </svg>
      <div className="study-sheet-row">
        <span>Start</span><span className="spacer" /><span>End</span>
      </div>
      <div className="study-sheet-row">
        <button className="soft" onClick={() => onGo(brightest.place)}>{`Brightest: ${placeName(brightest.place)}`}</button>
        <button className="soft" onClick={() => onGo(darkest.place)}>{`Darkest: ${placeName(darkest.place)}`}</button>
      </div>
    </section>
  )
}

// ── Phrases: what the book keeps saying ──
function Phrases({ book, onGo }: { book: string; onGo(place: string): void }) {
  const [phrases, setPhrases] = useState<Phrase[] | null>(null)
  const [open, setOpen] = useState<{ phrase: string; uses: Use[] } | null>(null)
  useEffect(() => { setPhrases(null); let cancelled = false; void phrasesOf(book).then(found => { if (!cancelled) setPhrases(found) }); return () => { cancelled = true } }, [book])
  if (!phrases) return <p className="guide-wait">Looking for the phrases the book repeats…</p>
  if (!phrases.length) return <p className="guide-wait">No phrase comes back three times or more.</p>
  return (
    <section>
      <p className="menu-note">Runs of words the book says three times or more: refrains, set phrases, an author’s habits.</p>
      <div className="word-list">
        {phrases.map(phrase => (
          <div key={phrase.phrase} className="phrase">
            <button className="exam-question" onClick={async () => setOpen(open?.phrase === phrase.phrase ? null : { phrase: phrase.phrase, uses: await usesOf(book, phrase.phrase, 40) })}>
              “{phrase.phrase}” <span className="word-count">×{phrase.count}</span>
            </button>
            {open?.phrase === phrase.phrase && <div className="concordance">
              {open.uses.map((use, i) => (
                <button key={i} onClick={() => onGo(use.place)}>
                  <span className="kwic-place">{placeName(use.place)}</span>
                  <span className="kwic-before"><span>{use.before}</span></span>
                  <mark>{use.match}</mark>
                  <span className="kwic-after">{use.after}</span>
                </button>
              ))}
            </div>}
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Places: where the book goes, on a map (OpenStreetMap) ──
function Places({ book, onGo }: { book: string; onGo(place: string): void }) {
  const [spots, setSpots] = useState<Spot[] | null>(null)
  const [located, setLocated] = useState(0)
  const [offline, setOffline] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setSpots(null); setLocated(0); setOffline(false)
    let cancelled = false
    void placesOf(book).then(async found => {
      if (cancelled) return
      setSpots(found)
      for (const spot of found) {
        try { Object.assign(spot, await locate(spot.name) ?? {}) } catch { setOffline(true); break }
        if (cancelled) return
        setLocated(n => n + 1)
      }
    })
    return () => { cancelled = true }
  }, [book])
  const onMap = useMemo(() => spots?.filter(spot => spot.lat !== undefined) ?? [], [spots, located]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = host.current
    if (!el || !onMap.length) return
    let map: import('leaflet').Map | undefined
    let cancelled = false
    void import('leaflet').then(L => {
      if (cancelled) return
      map = L.map(el, { zoomControl: true, attributionControl: true })
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors' }).addTo(map)
      const most = Math.max(...onMap.map(spot => spot.count))
      for (const spot of onMap) {
        L.circleMarker([spot.lat!, spot.lon!], { radius: 5 + 9 * Math.sqrt(spot.count / most), color: '#2f6fed', weight: 2, fillOpacity: 0.35 })
          .addTo(map).bindTooltip(`${spot.name} (${spot.count})`).on('click', () => onGo(spot.places[0]))
      }
      map.fitBounds(L.latLngBounds(onMap.map(spot => [spot.lat!, spot.lon!] as [number, number])).pad(0.3), { maxZoom: 9 })
    })
    return () => { cancelled = true; map?.remove() }
  }, [onMap]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!spots) return <p className="guide-wait">Finding the places the book names…</p>
  if (!spots.length) return <p className="guide-wait">This book names too few places to map.</p>
  return (
    <section>
      <p className="menu-note">{located < spots.length && !offline ? `Finding them on the map… ${located} / ${spots.length}` : 'Places named after “in”, “at”, “to” or “from”, found on OpenStreetMap. Click one to go to where the book first names it.'}</p>
      {offline && <p className="menu-note">The map needs the internet.</p>}
      <div ref={host} className="places-map" />
      <ol className="order-list">
        {spots.map(spot => <li key={spot.name}><button className="link-button" onClick={() => onGo(spot.places[0])}>{spot.name}</button> <span className="menu-note">{spot.count}{spot.lat === undefined && located >= spots.length ? ' · not on the map' : ''}</span></li>)}
      </ol>
    </section>
  )
}

// ── Style: how this book is written, next to your other books ──
function StyleCompare({ book }: { book: string }) {
  const [rows, setRows] = useState<Style[] | null>(null)
  useEffect(() => {
    setRows(null)
    let cancelled = false
    void (async () => {
      const books = [book, ...(await shelf()).map(found => found.name).filter(name => name !== book)].slice(0, 10)
      const out: Style[] = []
      for (const name of books) { const style = await styleOf(name).catch(() => null); if (style) out.push(style) }
      if (!cancelled) setRows(out)
    })()
    return () => { cancelled = true }
  }, [book])
  if (!rows) return <p className="guide-wait">Measuring how the books are written…</p>
  if (!rows.length) return <p className="guide-wait">This book is too short to measure.</p>
  const columns: [keyof Style, string, (value: number) => string][] = [
    ['words', 'Words', value => Math.round(value).toLocaleString()],
    ['hours', 'Reading time', value => (value < 1 ? `${Math.max(1, Math.round(value * 60))} min` : `${value.toFixed(1)} h`)],
    ['sentenceLength', 'Words per sentence', value => value.toFixed(1)],
    ['variety', 'Variety of words', value => `${Math.round(value * 100)}%`],
    ['rare', 'Rare words', value => `${Math.round(value * 100)}%`],
    ['grade', 'School grade', value => value.toFixed(1)],
  ]
  return (
    <section>
      <p className="menu-note">How this book is written, next to the others you opened. Variety of words: how many different words in each run of 500. Rare words: words outside the 6,000 most spoken. School grade: the Flesch Kincaid grade.</p>
      <div className="style-table">
        <table>
          <thead><tr><th>Book</th>{columns.map(([key, name]) => <th key={key}>{name}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.book} className={row.book === book ? 'this' : ''}><td>{baseName(row.book)}</td>{columns.map(([key, , show]) => <td key={key}>{show(row[key] as number)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </section>
  )
}

// ── Listen: the pages as a sound file, read as they are or talked over by two voices ──
export function ListenMaker({ here }: { here: Place }) {
  const [span, setSpan] = usePref('audio-pages', 1)
  const [kind, setKind] = usePref<'read' | 'talk'>('audio-kind', 'talk')
  const [step, setStep] = useState('')
  const [made, setMade] = useState<{ url: string; blob: Blob; lines: import('../lib/audiobook').Line[] } | null>(null)
  const stop = useRef(false)
  const places = useMemo(() => {
    const [, what, number] = here.place.match(/^(page|section|slide)=(\d+)/) ?? []
    return what ? Array.from({ length: span }, (_, i) => `${what}=${Number(number) + i}`) : [here.place]
  }, [here.place, span])
  const make = async () => {
    stop.current = false
    setMade(null)
    setStep('Preparing…')
    try {
      const { conversationLines, readingLines, record } = await import('../lib/audiobook')
      const { lines, language } = kind === 'talk' ? await conversationLines(here.book, places) : await readingLines(here.book, places)
      if (!lines.length) { setStep('There is no text here to read.'); return }
      const blob = await record(lines, language, setStep, () => stop.current)
      if (!blob) { setStep(''); return }
      setMade({ url: URL.createObjectURL(blob), blob, lines })
      setStep('')
    } catch {
      setStep('The voice could not be fetched. It needs the internet the first time.')
    }
  }
  const save = async () => {
    if (!made) return
    const { saveFileAs } = await import('../lib/platform')
    await saveFileAs(`${baseName(here.book)}, ${placeName(places[0])}${places.length > 1 ? ` to ${placeName(places.at(-1)!)}` : ''}.mp3`, new Uint8Array(await made.blob.arrayBuffer()))
  }
  return (
    <section>
      <p className="menu-note">Made with a natural voice on your device, to listen to anywhere: on a walk, on the bus. The first time, the voices are fetched (about 60 MB each).</p>
      <label className="menu-row">What
        <select value={span} onChange={e => setSpan(Number(e.target.value))}>
          {[1, 3, 5, 10, 20].map(n => <option key={n} value={n}>{n === 1 ? 'This page' : `This page and the ${n - 1} after`}</option>)}
        </select>
      </label>
      <label className="menu-row">How
        <select value={kind} onChange={e => setKind(e.target.value as 'read' | 'talk')}>
          <option value="talk">Two voices talk it over</option>
          <option value="read">Read as it is</option>
        </select>
      </label>
      <div className="teach-buttons">
        {step && !step.startsWith('The') ? <button className="soft" onClick={() => { stop.current = true }}>Stop</button> : <button className="primary" onClick={() => void make()}>Make the sound</button>}
        {step && <span className="menu-note">{step}</span>}
      </div>
      {made && <>
        <audio className="listen-player" controls src={made.url} />
        <button className="soft" onClick={() => void save()}>Save as MP3</button>
        {kind === 'talk' && <div className="talk">{made.lines.map((line, i) => <p key={i} className={line.voice ? 'talk-answer' : 'talk-ask'}>{line.text}</p>)}</div>}
      </>}
    </section>
  )
}
