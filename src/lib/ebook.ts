import { loadHighlights } from './reading'

// A book's notes and highlights as an e-book (EPUB), to read again on a Kindle, a Kobo or any e-reader app,
// away from the screen. The EPUB itself is put together by epub-gen-memory.
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// `page`: the note as it is shown (its HTML, pictures already inside it as data).
export async function notesAsEbook(notebook: string, page: HTMLElement): Promise<Uint8Array> {
  type Make = (options: object, content: object[]) => Promise<Blob>
  // The browser bundle is a UMD module: its function may come wrapped once more.
  const loaded = await import('epub-gen-memory/bundle') as unknown as { default: Make | { default: Make } }
  const epub = typeof loaded.default === 'function' ? loaded.default : loaded.default.default
  const marks = [...await loadHighlights(notebook, 'book'), ...await loadHighlights(notebook, 'pdf'), ...await loadHighlights(notebook, 'text')]
  const chapters = [{ title: 'My notes', content: page.innerHTML || '<p>(No notes yet.)</p>' }]
  if (marks.length) {
    chapters.push({
      title: 'Highlights',
      content: marks.map(mark => `<blockquote><p>${escape(mark.text)}</p>${mark.note ? `<p><i>${escape(mark.note)}</i></p>` : ''}</blockquote>`).join('\n'),
    })
  }
  const book = await epub({ title: `${notebook}: notes`, author: 'Sidepage', lang: document.documentElement.lang || 'en', tocTitle: 'Contents', ignoreFailedDownloads: true, verbose: false }, chapters)
  return new Uint8Array(await book.arrayBuffer())
}
