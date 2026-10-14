import { useEffect, useState } from 'react'
import { Copy, NotebookPen, Quote } from 'lucide-react'
import { Menu } from '../ui'
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
  return (await get<BookFacts>(key(book))) ?? { title: baseName(book), authors: [], kind: 'book' }
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

// The reader's Cite menu: the open book in each style, to copy or to put in the notes.
export function CiteMenu({ book }: { book: string }) {
  const [facts, setFacts] = useState<BookFacts | null>(null)
  const [copied, setCopied] = useState('')
  const [editing, setEditing] = useState(false)
  // Read again each time the menu opens: the details are kept a moment after the book opens, or edited.
  const [opened, setOpened] = useState(0)
  useEffect(() => { void factsOf(book).then(setFacts) }, [book, opened])
  const change = (part: Partial<BookFacts>) => {
    if (!facts) return
    const next = { ...facts, ...part }
    setFacts(next)
    void keepFacts(book, next)
  }
  return (
    <Menu quiet icon={Quote} label="Cite" hint="This book as a reference: APA, MLA, Chicago or BibTeX">
      {() => facts && <div className="cite" ref={() => { if (!opened) setOpened(Date.now()) }}>
        <button className="menu-item stay" onClick={() => setEditing(!editing)}>{editing ? 'Done with the details' : 'Edit the details (title, authors, year, publisher)'}</button>
        {editing && <div className="cite-edit">
          <label>Title<input value={facts.title} onChange={e => change({ title: e.target.value })} /></label>
          <label>Authors, one per line<textarea rows={3} value={facts.authors.join('\n')} onChange={e => change({ authors: e.target.value.split('\n') })} /></label>
          <label>Year<input value={facts.year ?? ''} inputMode="numeric" onChange={e => change({ year: e.target.value })} /></label>
          <label>Publisher<input value={facts.publisher ?? ''} onChange={e => change({ publisher: e.target.value })} /></label>
        </div>}
        {STYLES.map(style => {
          const text = cite(facts, style)
          return (
            <div key={style} className="cite-style">
              <p className="menu-head">{style}</p>
              <pre>{text.replace(/\*/g, '')}</pre>
              <div className="menu-line">
                <button className="menu-item stay" onClick={() => void navigator.clipboard?.writeText(text.replace(/\*/g, '')).then(() => setCopied(style))}><Copy size={14} aria-hidden /> {copied === style ? 'Copied' : 'Copy'}</button>
                {style !== 'BibTeX' && <button className="menu-item" onClick={() => sendQuote({ text: text.replace(/\*/g, ''), source: `${style} reference` })}><NotebookPen size={14} aria-hidden /> Into my notes</button>}
              </div>
            </div>
          )
        })}
        {!facts.authors.filter(Boolean).length && !editing && <p className="menu-note">This file does not name its author: add it under “Edit the details”.</p>}
      </div>}
    </Menu>
  )
}
