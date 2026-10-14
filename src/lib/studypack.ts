import { marked } from 'marked'
import { baseName, loadNote, loadNoteFile } from './platform'
import { asTime, progressOf, spentOn, type Highlight } from './reading'
import { allCards } from './review'
import { glossaryOf, termsOf } from './insight'
import { placeName } from './library'
import { factsOf, cite } from '../viewers/Cite'
import { pictureCardsOf } from '../notes/PictureCards'

// A study pack: everything kept about one book, laid out as one document to read, print or keep: what the book
// is, your notes with their pictures, your highlights and comments, a glossary of its terms, and your cards as
// questions with the answers after them. Made on the device; saved as a web page that prints well.

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const asDataUrl = (blob: Blob) => new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob) })

export async function studyPack(book: string): Promise<string> {
  const notebook = baseName(book)
  const facts = await factsOf(book)
  const notes = (await loadNote(notebook, 'notes.md')) ?? ''
  const highlights: Highlight[] = JSON.parse((await loadNote(notebook, 'highlights.json')) ?? '[]')
  const cards = (await allCards()).filter(card => card.book === book && !card.picture && card.back)
  const pictureSets = await pictureCardsOf(notebook)
  const terms = await termsOf(book).catch(() => [])
  const glossary = terms.length ? await glossaryOf(book, terms, 30).catch(() => []) : []

  // The notes: links into the book become plain page references, sound stamps drop away, and the pictures kept
  // beside the note go inside the document.
  const pictures = new Map<string, string>()
  for (const name of new Set([...notes.matchAll(/\]\(((?:clip|picture)-[\w.-]+)/g)].map(match => match[1]))) {
    const blob = await loadNoteFile(notebook, name)
    if (blob) pictures.set(name, await asDataUrl(blob))
  }
  const cleaned = notes
    .replace(/\[▸ [\d:]+\]\(#sidepage-sound[^)]*\)\s?/g, '')
    .replace(/\[([^\]]*)\]\(#sidepage-open\?[^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\(#sidepage-note\?[^)]*\)/g, '$1')
    .replace(/\]\(((?:clip|picture)-[\w.-]+)/g, (whole, name: string) => (pictures.has(name) ? `](${pictures.get(name)}` : whole))
  // The note's own headings sit under the pack's "My notes", two steps down.
  const notesHtml = cleaned.trim()
    ? (await marked.parse(cleaned)).replace(/<(\/?)h([1-6])\b/g, (_, close: string, level: string) => `<${close}h${Math.min(6, Number(level) + 2)}`)
    : '<p class="none">No written notes yet.</p>'

  const cardPictures = await Promise.all(pictureSets.map(async set => {
    const blob = await loadNoteFile(notebook, set.file)
    return blob ? { set, url: await asDataUrl(blob) } : null
  }))

  const read = Math.round(progressOf(book) * 100)
  const spent = Math.round(spentOn(book))
  const section = (title: string, body: string) => (body ? `<section><h2>${title}</h2>${body}</section>` : '')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(facts.title)}: study pack</title>
<style>
  :root { color-scheme: light; }
  body { font: 11.5pt/1.6 Georgia, 'Times New Roman', serif; color: #1c1d21; max-width: 46em; margin: 0 auto; padding: 2.5em 1.4em 4em; }
  h1, h2, h3, h4, .meta, th, .label { font-family: system-ui, 'Segoe UI', sans-serif; }
  h1 { font-size: 26pt; line-height: 1.15; margin: 0 0 .2em; letter-spacing: -.01em; }
  h2 { font-size: 15pt; margin: 2.2em 0 .8em; padding-bottom: .3em; border-bottom: 2px solid #1c1d21; break-after: avoid; }
  section { break-inside: auto; }
  .meta { color: #555; font-size: 10pt; }
  .cover { padding-bottom: 1.2em; border-bottom: 1px solid #ccc; }
  .contents { font-family: system-ui, sans-serif; font-size: 10.5pt; columns: 2; padding-left: 1.2em; }
  blockquote { margin: 1em 0; padding: .1em 1em; border-left: 3px solid #bbb; color: #333; }
  img { max-width: 100%; border-radius: 4px; }
  table { border-collapse: collapse; width: 100%; font-size: 10.5pt; }
  td, th { border: 1px solid #bbb; padding: 5px 8px; vertical-align: top; text-align: left; }
  th { background: #f2f2f2; }
  .mark { margin: 0 0 .9em; padding: .2em 0 .2em .9em; border-left: 4px solid; break-inside: avoid; }
  .mark .comment { display: block; margin-top: .3em; font-style: italic; color: #444; }
  .label { font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: .06em; }
  .card { margin: 0 0 1em; break-inside: avoid; }
  .card .q { font-weight: bold; }
  .card .a { margin-top: .2em; padding-left: 1em; color: #333; }
  .answers .card .q { font-weight: normal; }
  .pictures { position: relative; display: inline-block; margin: .5em 0 1em; }
  .pictures span { position: absolute; display: grid; place-items: center; color: #fff; background: #4e5058; border: 2px solid #fff; border-radius: 4px; font: bold 9pt system-ui, sans-serif; }
  .none { color: #777; font-style: italic; }
  @media print { body { padding: 0; } a { color: inherit; text-decoration: none; } h2 { break-before: auto; } }
</style></head><body>
<header class="cover">
  <p class="label">Study pack</p>
  <h1>${escape(facts.title)}</h1>
  <p class="meta">${[facts.authors.filter(Boolean).join(', '), facts.year, facts.publisher].filter((part): part is string => !!part).map(escape).join(' · ')}</p>
  <p class="meta">${read}% read${spent ? ` · ${asTime(spent)} spent with it` : ''} · made ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} with Sidepage</p>
  <p class="meta">Reference (APA): ${escape(cite(facts, 'APA').replace(/\*/g, ''))}</p>
</header>
<ol class="contents">
  <li>My notes</li>${highlights.length ? '<li>Highlights</li>' : ''}${glossary.length ? '<li>Glossary</li>' : ''}${terms.length ? '<li>Key terms and where they are</li>' : ''}${cards.length || cardPictures.some(Boolean) ? '<li>Questions</li><li>Answers</li>' : ''}
</ol>
${section('My notes', notesHtml)}
${section('Highlights', highlights.map(mark => `<div class="mark" style="border-color:${escape(mark.color ?? '#ffd84d')}">${escape(mark.text.replace(/\s+/g, ' '))}${mark.note?.trim() ? `<span class="comment">${escape(mark.note)}</span>` : ''}</div>`).join(''))}
${section('Glossary', glossary.length ? `<table><tr><th>Term</th><th>What it is</th><th>Where</th></tr>${glossary.map(entry => `<tr><td><b>${escape(entry.term)}</b></td><td>${escape(entry.meaning)}</td><td>${escape(placeName(entry.place))}</td></tr>`).join('')}</table>` : '')}
${section('Key terms and where they are', terms.length ? `<table><tr><th>Term</th><th>Times</th><th>Thickest at</th></tr>${terms.map(term => `<tr><td>${escape(term.term)}</td><td>${term.count}</td><td>${term.places.slice(0, 5).map(found => escape(placeName(found.place))).join(', ')}</td></tr>`).join('')}</table>` : '')}
${section('Questions', [
    ...cards.map((card, i) => `<div class="card"><div class="q">${i + 1}. ${escape(card.front)}</div></div>`),
    ...cardPictures.flatMap(found => (found ? [`<div class="card"><div class="q">Name each numbered part.</div><div class="pictures"><img src="${found.url}" alt="">${found.set.boxes.map((box, i) => `<span style="left:${box.x * 100}%;top:${box.y * 100}%;width:${box.w * 100}%;height:${box.h * 100}%">${i + 1}</span>`).join('')}</div></div>`] : [])),
  ].join(''))}
${section('Answers', `<div class="answers">${[
    ...cards.map((card, i) => `<div class="card"><div class="q">${i + 1}. ${escape(card.back)}</div></div>`),
    ...cardPictures.flatMap(found => (found ? [`<div class="card"><div class="q">${found.set.boxes.map((box, i) => `${i + 1}. ${escape(box.label || '(not named)')}`).join(' · ')}</div></div>`] : [])),
  ].join('')}</div>`)}
</body></html>`
}
