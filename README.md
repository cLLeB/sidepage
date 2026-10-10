# Sidepage

Read on one side, think on the other. Sidepage opens a book, a document or a slide deck and puts your
notes, drawings and mind maps right beside it.

Sidepage builds almost nothing itself. It is a thin shell that joins existing open-source projects:

| Part | Project | Licence |
| --- | --- | --- |
| EPUB, MOBI, AZW3, FB2, CBZ reader | [foliate-js](https://github.com/johnfactotum/foliate-js) | MIT |
| PDF reader | [PDF.js](https://github.com/mozilla/pdf.js) | Apache-2.0 |
| Word documents | [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) | Apache-2.0 |
| PowerPoint slides | [PptxViewJS](https://github.com/gptsci/pptxviewjs) | MIT |
| Page-turn effect | [StPageFlip](https://github.com/Nodlik/StPageFlip) | MIT |
| Written notes (Markdown) | [Milkdown Crepe](https://github.com/Milkdown/milkdown) | MIT |
| Drawing and handwriting canvas | [Excalidraw](https://github.com/excalidraw/excalidraw) | MIT |
| Mind maps | [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) | MIT |
| Side-by-side panels and tabs | [Dockview](https://github.com/mathuo/dockview) | MIT |
| Desktop shell (optional) | [Tauri](https://github.com/tauri-apps/tauri) | MIT / Apache-2.0 |

## What it does

- Opens PDF, EPUB, MOBI, AZW/AZW3, FB2, CBZ, DOCX, PPTX, TXT, Markdown and HTML.
- Three kinds of notes per book: written notes, a free canvas, and a mind map. Open any of them beside the book,
  drag the tabs to rearrange.
- Paper styles for notes: blank, lined (exercise book), grid and dots.
- "Flip pages" turns PDFs and slide decks into a book you leaf through.
- "Quote to notes" copies the selected passage into your notes with its source.
- Notes are plain files (`notes.md`, `canvas.excalidraw`, `mindmap.json`) in one folder per book.

## Run it

```
npm install
npm run dev
```

On Windows, `Sidepage.cmd` builds the app once and opens it in its own window (through Microsoft Edge).

`src-tauri` holds a Tauri shell for a small native build (`npm run tauri build`). It needs the Rust toolchain.
