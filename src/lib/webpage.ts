import { webFetch } from './net'

// A page on the web taken in as something to read: Mozilla's Readability (the engine of Firefox's Reader View)
// keeps the article and drops menus, adverts and the rest; Turndown writes the article as Markdown. The result is
// a .md file with the article's title as its name, opened like any book: highlights, quotes, notes beside it.
export async function articleFrom(address: string): Promise<File> {
  const url = new URL(/^https?:\/\//i.test(address.trim()) ? address.trim() : `https://${address.trim()}`)
  const answer = await webFetch(url.href, { headers: { Accept: 'text/html,application/xhtml+xml' } })
  if (!answer.ok) throw new Error(`The page answered ${answer.status}.`)
  const html = await answer.text()
  const page = new DOMParser().parseFromString(html, 'text/html')
  // Links and pictures are made whole, so they still work once the page is read away from its site.
  const base = page.createElement('base')
  base.href = url.href
  page.head.prepend(base)
  page.querySelectorAll<HTMLAnchorElement | HTMLImageElement>('a[href], img[src]').forEach(element => {
    const attribute = element instanceof HTMLAnchorElement ? 'href' : 'src'
    try { element.setAttribute(attribute, new URL(element.getAttribute(attribute)!, url).href) } catch { /* left as it was */ }
  })
  const [{ Readability }, { default: TurndownService }] = await Promise.all([import('@mozilla/readability'), import('turndown')])
  const article = new Readability(page).parse()
  if (!article?.content) throw new Error('No article could be found on that page.')
  const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' })
  const body = turndown.turndown(article.content)
  // "How it works | Science Site": the site's name after a bar or dash is left off.
  const named = (article.title || url.hostname).split(/ [|·•–—-] /)[0].trim() || url.hostname
  const title = named.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
  const header = [`# ${named}`, [article.byline, article.siteName, url.href].filter(Boolean).join(' · ')].join('\n\n')
  return new File([`${header}\n\n${body}\n`], `${title}.md`, { type: 'text/markdown' })
}
