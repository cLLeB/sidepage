import { webFetch } from './net'
import { getPref } from './prefs'

// Scholarly works from OpenAlex, the free and open catalogue of some 250 million papers, books and theses: a work,
// the works it cites, the works that cite it and the works on the same subject, as Connected Papers or
// ResearchRabbit show them. Free papers can be opened straight into Sidepage.
export type Paper = {
  id: string; title: string; year?: number; authors: string[]; venue?: string; cites: number; doi?: string
  pdf?: string; page?: string; abstract?: string; references: string[]; related: string[]
}

const API = 'https://api.openalex.org'
const FIELDS = 'id,title,doi,publication_year,cited_by_count,authorships,primary_location,best_oa_location,referenced_works,related_works,abstract_inverted_index'
type Work = {
  id: string; title?: string; doi?: string; publication_year?: number; cited_by_count?: number
  authorships?: { author: { display_name: string } }[]; primary_location?: { source?: { display_name?: string }; landing_page_url?: string }
  best_oa_location?: { pdf_url?: string; landing_page_url?: string }; referenced_works?: string[]; related_works?: string[]
  abstract_inverted_index?: Record<string, number[]>
}
// OpenAlex keeps abstracts as each word with its places; put back in order they read as written.
const abstractOf = (index?: Record<string, number[]>) => {
  if (!index) return undefined
  const words: string[] = []
  for (const [word, places] of Object.entries(index)) for (const place of places) words[place] = word
  return words.filter(Boolean).join(' ')
}
const short = (id: string) => id.replace('https://openalex.org/', '')
const paperOf = (work: Work): Paper => ({
  id: short(work.id), title: (work.title ?? 'Untitled').replace(/<[^>]+>/g, ''), year: work.publication_year,
  authors: (work.authorships ?? []).map(entry => entry.author.display_name), venue: work.primary_location?.source?.display_name,
  cites: work.cited_by_count ?? 0, doi: work.doi?.replace('https://doi.org/', ''),
  pdf: work.best_oa_location?.pdf_url, page: work.best_oa_location?.landing_page_url ?? work.primary_location?.landing_page_url ?? work.doi,
  abstract: abstractOf(work.abstract_inverted_index), references: (work.referenced_works ?? []).map(short), related: (work.related_works ?? []).map(short),
})

async function ask<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  const key = getPref('openalex-key', '')
  const params = new URLSearchParams(key ? { ...query, api_key: key } : query)
  const answer = await webFetch(`${API}${path}?${params}`)
  if (answer.status === 429) throw new Error('OpenAlex has had enough questions from this network for today. A free key (openalex.org) lifts that.')
  if (!answer.ok) throw new Error(`OpenAlex answered ${answer.status}.`)
  return answer.json() as Promise<T>
}

export async function findPapers(text: string, most = 15): Promise<Paper[]> {
  const doi = text.match(/10\.\d{4,9}\/[^\s"<>]+/)?.[0]?.replace(/[.,;)]+$/, '')
  if (doi) return [await paper(`doi:${doi}`)]
  const { results } = await ask<{ results: Work[] }>('/works', { search: text, 'per-page': String(most), select: FIELDS })
  return results.map(paperOf)
}

export async function paper(id: string): Promise<Paper> {
  return paperOf(await ask<Work>(`/works/${id}`, { select: FIELDS }))
}

// Several works at once, by their ids (fifty at a time, as OpenAlex allows).
async function many(ids: string[]): Promise<Paper[]> {
  const found: Paper[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const { results } = await ask<{ results: Work[] }>('/works', { filter: `openalex:${ids.slice(i, i + 50).join('|')}`, 'per-page': '50', select: FIELDS })
    found.push(...results.map(paperOf))
  }
  return found.sort((a, b) => b.cites - a.cites)
}
export const referencesOf = (work: Paper) => many(work.references.slice(0, 100))
export const relatedTo = (work: Paper) => many(work.related.slice(0, 25))
export async function citingWorks(work: Paper, most = 50): Promise<Paper[]> {
  const { results } = await ask<{ results: Work[] }>('/works', { filter: `cites:${work.id}`, sort: 'cited_by_count:desc', 'per-page': String(most), select: FIELDS })
  return results.map(paperOf)
}

// What the open book is: a DOI printed in its first pages, failing that its first line (usually the title).
export async function guessFromBook(book: string): Promise<string> {
  const { get } = await import('idb-keyval')
  const pages = (await get<{ place: string; text: string }[]>(`text:${book}`)) ?? []
  const start = pages.slice(0, 3).map(page => page.text).join(' ')
  const doi = start.match(/10\.\d{4,9}\/[^\s"<>]+/)?.[0]
  if (doi) return doi.replace(/[.,;)]+$/, '')
  // The title the file itself carries, when it has a real one.
  const facts = await get<{ title?: string }>(`facts:${book}`)
  if (facts?.title && facts.title.split(' ').length >= 3 && !/\.(pdf|docx?)$|^microsoft word/i.test(facts.title)) return facts.title
  // A page number or running head before the title is left off.
  const first = pages[0]?.text.replace(/\s+/g, ' ').trim().replace(/^\d{1,4}\s+/, '').split(/(?<=[a-z])\.\s|\s{2,}/)[0] ?? ''
  return first.split(' ').slice(0, 14).join(' ') || book.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
}

// A free paper, fetched and handed over as a file to open like any book.
export async function paperFile(work: Paper): Promise<File> {
  if (!work.pdf) throw new Error('This paper has no free PDF.')
  const answer = await webFetch(work.pdf)
  if (!answer.ok) throw new Error(`The PDF could not be fetched (${answer.status}).`)
  // Some publishers answer with a browser check instead of the PDF: that is not opened as a book.
  const bytes = await answer.arrayBuffer()
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('not-a-pdf')
  const name = `${work.title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)}.pdf`
  return new File([bytes], name, { type: 'application/pdf' })
}

export const authorsLine = (work: Paper) => work.authors.length > 3 ? `${work.authors.slice(0, 3).join(', ')} et al.` : work.authors.join(', ')
