# Sidepage

Read on one side, think on the other. Sidepage opens a book, a document or a slide deck and puts your
notes, drawings and mind maps right beside it.

Sidepage builds almost nothing itself. It is a thin shell that joins existing open-source projects:

| Part | Project | Licence |
| --- | --- | --- |
| EPUB, MOBI, AZW3, FB2, CBZ reader | [foliate-js](https://github.com/johnfactotum/foliate-js) | MIT |
| PDF reader | [PDF.js](https://github.com/mozilla/pdf.js) | Apache-2.0 |
| DjVu books | [DjVu.js](https://github.com/RussCoder/djvujs) (vendored in `public/djvu`) | GPL-2.0 |
| Word documents | [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) | Apache-2.0 |
| PowerPoint slides | [PptxViewJS](https://github.com/gptsci/pptxviewjs) | MIT |
| Page-turn effect | [StPageFlip](https://github.com/Nodlik/StPageFlip) | MIT |
| Written notes (Markdown) | [Milkdown Crepe](https://github.com/Milkdown/milkdown) | MIT |
| Drawing and handwriting canvas | [Excalidraw](https://github.com/excalidraw/excalidraw) | MIT |
| Graph of linked notebooks | [force-graph](https://github.com/vasturiano/force-graph) | MIT |
| Mind maps | [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) | MIT |
| Side-by-side panels and tabs | [Dockview](https://github.com/mathuo/dockview) | MIT |
| Comic archives (CBR, CB7, CBT) | [libarchive.js](https://github.com/nika-begiashvili/libarchivejs) | MIT |
| Word 97–2003 (.doc) | [@file-viewer/doc](https://www.npmjs.com/package/@file-viewer/doc) | MIT |
| PowerPoint 97–2003 (.ppt) | [react-pptx](https://www.npmjs.com/package/@extend-ai/react-pptx) | MIT |
| RTF documents | [rtf.js](https://github.com/tbluemel/rtf.js) | MIT |
| OpenDocument text | [odf-kit](https://www.npmjs.com/package/odf-kit) | Apache-2.0 |
| Installable web app, offline | [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa) | MIT |
| Desktop shell | [Tauri](https://github.com/tauri-apps/tauri) | MIT / Apache-2.0 |

## What it does

- Opens PDF, EPUB, MOBI, AZW/AZW3, FB2, DJVU, CBZ, CBR, CB7, CBT, DOCX, DOC, RTF, ODT, PPTX, PPT, TXT, Markdown and HTML.
- Three kinds of notes per book: written notes, a paged canvas, and a mind map. Open any of them beside the
  book and drag the tabs to rearrange.
- Paper styles for notes: blank, lined (exercise book), grid and dots.
- "Flip" turns PDFs, slide decks, DjVu books and your canvas notebook into a book you leaf through, with a paper
  curl as each page turns. EPUB, MOBI and FB2 text curls the same way: Sidepage lays the chapter out in page-wide
  columns and hands the pages to StPageFlip (this part is Sidepage's own, in `src/viewers/CurlBook.tsx`).
  The choice is remembered, and no scrollbars are shown anywhere.
- Search inside a book or PDF; each match leads to its place.
- Light, sepia and dark themes for the whole workspace.
- Link one book's notes to another's, see which notes link back ("Linked from"), and view all of it as a graph.
- Highlight and draw on PDF pages, and save a copy with the marks in it.
- "Quote" copies the selected passage into your notes with its source.
- The source line under each quote is a link: click it to travel back to that exact place in the book. Quoted
  passages stay highlighted in EPUB-family books, and clicking a highlight shows the note that quotes it.
- **One file for everything**: "Save as one file" writes a `.sidepage` file holding the book and all its notes,
  drawings, mind map, highlights and reading position. Open it on any device to get the whole thing back.
- The home screen lists the books you opened recently.
- Reopens each book where you left off.
- Notes are plain files (`notes.md`, `canvas.excalidraw`, `mindmap.json`) in one folder per book.

## Where it runs

- **Windows, macOS, Linux**: `npm run tauri build` makes a small native app (about 7 MB installer on Windows).
  Notes are saved under `Documents/Sidepage`. Needs the Rust toolchain to build.
- **Phones, tablets, iPads, Chromebooks**: the same app is an installable web app. Host the `dist` folder on any
  HTTPS site (`.github/workflows/pages.yml` publishes it to GitHub Pages), open it and choose "Install" or
  "Add to Home Screen". It works offline afterwards. The layout stacks on upright tablets and becomes one tab
  strip on phones.
- **Any browser**: `npm run dev`, or `Sidepage.cmd` on Windows to open the built app in its own window.

## Develop

```
npm install
npm run dev
```

`node scripts/verify-desktop.mjs <path to sidepage.exe> [book]` starts the built desktop app and checks that
every sample format opens (it reads the samples from the dev server, so keep `npm run dev` running).

## Not there yet

CHM. Old `.doc` and `.ppt` files open as static pages: unusual layouts, charts and effects may be simplified.

## Licence

Sidepage's own glue code is GPL-3.0-or-later. Each bundled project keeps its own licence, listed above.