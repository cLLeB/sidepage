import { useEffect, useState } from 'react'
import { Copy, NotebookPen, Quote } from 'lucide-react'
import { baseName, sendQuote, shelf } from '../lib/platform'

// What a book says about itself (its title, authors, year, publisher), kept when it is opened, so it can be cited.
export type BookFacts = { title: string; authors: string[]; year?: string; publisher?: string; pages?: number; kind: 'book' | 'document' }
const key = (book: string) => `facts:${book}`

export async function keepFacts(book: string, facts: Partial<BookFacts>) {
  const { set } = await import('idb-keyval')
  const clean = (text: unknown) => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '')
  const authors = (facts.authors ?? []).map(clean).filter(Boolean)
  // (Kept tidy; the menu holds the untidy version while it is being typed.)
  await set(key(book), {
    // Office programs fill the title in with their own name ("Présentation PowerPoint", "Microsoft Word - …");
    // then the file's own name says more.
    title: (/^(pr[ée]sentation powerpoint|powerpoint presentation|untitled|document\d*|slide \d+)$/i.test(clean(facts.title)) || /\.(docx?|pptx?|odt|rtf)$/i.test(clean(facts.title)) ? '' : clean(facts.title).replace(/^Microsoft (Word|PowerPoint) - /i, '')) || baseName(book),
    authors,
    year: clean(facts.year).match(/\d{4}/)?.[0],
    publisher: clean(facts.publisher) || undefined,
    pages: facts.pages,
    kind: facts.kind ?? 'book',
  } satisfies BookFacts)
}
export async function factsOf(book: string): Promise<BookFacts> {
  const { get } = await import('idb-keyval')
  const found = (await get<BookFacts>(key(book))) ?? { title: baseName(book), authors: [], kind: 'book' }
  return /[\\/]/.test(found.title) ? { ...found, title: baseName(found.title) } : found
}

// "Mary Ann Smith" → family name and initials, the way citation styles want them.
const split = (name: string) => {
  if (name.includes(',')) { const [family, given] = name.split(','); return { family: family.trim(), given: (given ?? '').trim() } }
  const parts = name.trim().split(/\s+/)
  return { family: parts.pop() ?? name, given: parts.join(' ') }
}
const initials = (given: string) => given.split(/[\s-]+/).filter(Boolean).map(part => `${part[0]}.`).join(' ')
const list = (names: string[], last: string) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')}${names.length > 2 ? ',' : ''} ${last} ${names.at(-1)}`)

export const STYLES = ['APA', 'MLA', 'Chicago', 'BibTeX'] as const
export type Style = (typeof STYLES)[number]
export function cite(facts: BookFacts, style: Style): string {
  const people = facts.authors.map(split)
  const year = facts.year ?? 'n.d.'
  const pub = facts.publisher ? `${facts.publisher}.` : ''
  if (style === 'APA') {
    const who = list(people.map(p => `${p.family}${p.given ? `, ${initials(p.given)}` : ''}`), '&')
    // With no author, the title takes the author's place.
    return (who ? `${who} (${year}). *${facts.title}*. ${pub}` : `*${facts.title}*. (${year}). ${pub}`).trim()
  }
  if (style === 'MLA') {
    const who = people.length === 0 ? '' : people.length === 1 ? `${people[0].family}${people[0].given ? `, ${people[0].given}` : ''}. `
      : people.length === 2 ? `${people[0].family}, ${people[0].given}, and ${people[1].given} ${people[1].family}. ` : `${people[0].family}, ${people[0].given}, et al. `
    return `${who}*${facts.title}*. ${facts.publisher ? `${facts.publisher}, ` : ''}${facts.year ?? ''}.`.replace(/, \.$/, '.').replace(/\. \.$/, '.')
  }
  if (style === 'Chicago') {
    const who = people.length ? `${list(people.map((p, i) => (i === 0 ? `${p.family}${p.given ? `, ${p.given}` : ''}` : `${p.given} ${p.family}`)), 'and')}. ` : ''
    return `${who}*${facts.title}*. ${facts.publisher ? `${facts.publisher}, ` : ''}${year}.`.replace(/\.\.$/, '.')
  }
  const id = `${(people[0]?.family ?? facts.title.split(/\s+/)[0]).toLowerCase().replace(/[^\p{L}\d]/gu, '')}${facts.year ?? ''}`
  return [
    `@${facts.kind === 'book' ? 'book' : 'misc'}{${id},`,
    facts.authors.length ? `  author = {${facts.authors.join(' and ')}},` : '',
    `  title = {${facts.title}},`,
    facts.publisher ? `  publisher = {${facts.publisher}},` : '',
    facts.year ? `  year = {${facts.year}},` : '',
    '}',
  ].filter(Boolean).join('\n')
}

// Every book in the library, cited in one style, one after another (a bibliography, or a .bib file).
export async function bibliography(style: Style) {
  const all = await Promise.all((await shelf()).map(async book => cite(await factsOf(book.name), style)))
  return (style === 'BibTeX' ? all : all.sort((a, b) => a.localeCompare(b))).join('\n\n')
}

// ── Citing: the open book as a reference, a page of it in the text of an essay, or a passage with its source ──
export type CiteAsk = { book: string; place?: string; passage?: string }
export const openCite = (ask: CiteAsk) => window.dispatchEvent(new CustomEvent('sidepage:cite', { detail: ask }))

// How a page is cited inside the text of an essay, in each style.
function inText(facts: BookFacts, style: Style, page?: string) {
  const family = facts.authors.filter(Boolean).map(name => split(name).family)
  const who = family.length === 0 ? `“${facts.title}”` : family.length === 1 ? family[0] : family.length === 2 ? `${family[0]} ${style === 'APA' ? '&' : 'and'} ${family[1]}` : `${family[0]} et al.`
  const year = facts.year ?? 'n.d.'
  if (style === 'APA') return `(${who}, ${year}${page ? `, p. ${page}` : ''})`
  if (style === 'MLA') return `(${who}${page ? ` ${page}` : ''})`
  return `(${who} ${year}${page ? `, ${page}` : ''})`
}

export function CiteDialog() {
  const [ask, setAsk] = useState<CiteAsk | null>(null)
  const [facts, setFacts] = useState<BookFacts | null>(null)
  const [style, setStyle] = useState<Style>('APA')
  const [copied, setCopied] = useState('')
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    const open = (e: Event) => { setAsk((e as CustomEvent<CiteAsk>).detail); setCopied(''); setEditing(false) }
    window.addEventListener('sidepage:cite', open)
    return () => window.removeEventListener('sidepage:cite', open)
  }, [])
  useEffect(() => { if (ask) void factsOf(ask.book).then(setFacts) }, [ask])
  if (!ask || !facts) return null
  const change = (part: Partial<BookFacts>) => {
    const next = { ...facts, ...part }
    setFacts(next)
    void keepFacts(ask.book, next)
  }
  const page = ask.place?.match(/^(?:page|slide)=(\d+)/)?.[1]
  const reference = cite(facts, style).replace(/\*/g, '')
  const citation = style === 'BibTeX' ? '' : inText(facts, style, page)
  const passage = ask.passage?.trim()
  const copy = (what: string, text: string) => void navigator.clipboard?.writeText(text).then(() => setCopied(what))
  const row = (what: string, text: string, toNotes = true) => (
    <div className="cite-style">
      <p className="menu-head">{what}</p>
      <pre>{text}</pre>
      <div className="menu-line">
        <button className="menu-item" onClick={() => copy(what, text)}><Copy size={14} aria-hidden /> {copied === what ? 'Copied' : 'Copy'}</button>
        {toNotes && <button className="menu-item" onClick={() => { sendQuote({ text, source: '' }); setAsk(null) }}><NotebookPen size={14} aria-hidden /> Into my notes</button>}
      </div>
    </div>
  )
  return (
    <div className="palette-shade" onClick={() => setAsk(null)}>
      <div className="palette lookup cite" role="dialog" aria-label="Cite" onClick={e => e.stopPropagation()}>
        <h2><Quote size={20} aria-hidden /> Cite {facts.title}</h2>
        <div className="chips" role="group" aria-label="Style">
          {STYLES.map(name => <button key={name} className={name === style ? 'chip on' : 'chip'} onClick={() => setStyle(name)}>{name}</button>)}
        </div>
        <div className="palette-list">
          {row(style === 'BibTeX' ? 'BibTeX entry' : 'In the list of references', reference, style !== 'BibTeX')}
          {citation && row(page ? `In your text, for this page (${page})` : 'In your text', citation)}
          {passage && citation && row('The selected passage, with its source', `“${passage.replace(/\s+/g, ' ')}” ${citation}`)}
          {!passage && style !== 'BibTeX' && <p className="menu-note">Select a passage first to get it back quoted with its source.</p>}
          <button className="menu-item" onClick={() => setEditing(!editing)}>{editing ? 'Done with the details' : 'Edit the details (title, authors, year, publisher)'}</button>
          {editing && <div className="cite-edit">
            <label>Title<input value={facts.title} onChange={e => change({ title: e.target.value })} /></label>
            <label>Authors, one per line<textarea rows={3} value={facts.authors.join('\n')} onChange={e => change({ authors: e.target.value.split('\n') })} /></label>
            <label>Year<input value={facts.year ?? ''} inputMode="numeric" onChange={e => change({ year: e.target.value })} /></label>
            <label>Publisher<input value={facts.publisher ?? ''} onChange={e => change({ publisher: e.target.value })} /></label>
          </div>}
          {!facts.authors.filter(Boolean).length && !editing && <p className="menu-note">This file does not name its author: add it under “Edit the details”.</p>}
        </div>
        <div className="lookup-actions"><button className="primary" onClick={() => setAsk(null)}>Done</button></div>
      </div>
    </div>
  )
}
