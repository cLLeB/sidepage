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
| Page-turn effect | [StPageFlip](https://github.com/Nodlik/StPageFlip) | MIT |
| Written notes (Markdown) | [Milkdown Crepe](https://github.com/Milkdown/milkdown) | MIT |
| Drawing and handwriting canvas | [Excalidraw](https://github.com/excalidraw/excalidraw) | MIT |
| Graph of linked notebooks | [force-graph](https://github.com/vasturiano/force-graph) | MIT |
| Flashcard scheduling | [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | MIT |
| Mind maps | [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) | MIT |
| Icons | [Lucide](https://github.com/lucide-icons/lucide) | ISC |
| Side-by-side panels and tabs | [Dockview](https://github.com/mathuo/dockview) | MIT |
| Comic archives (CBR, CB7, CBT) | [libarchive.js](https://github.com/nika-begiashvili/libarchivejs) | MIT |
| Word 97–2003 (.doc) | [@file-viewer/doc](https://www.npmjs.com/package/@file-viewer/doc) | MIT |
| PowerPoint (.pptx and .ppt) | [react-pptx](https://www.npmjs.com/package/@extend-ai/react-pptx) | MIT |
| RTF documents | [rtf.js](https://github.com/tbluemel/rtf.js) | MIT |
| OpenDocument text | [odf-kit](https://www.npmjs.com/package/odf-kit) | Apache-2.0 |
| Installable web app, offline | [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa) | MIT |
| Desktop shell | [Tauri](https://github.com/tauri-apps/tauri) | MIT / Apache-2.0 |

## What it does

- Opens PDF, EPUB, MOBI, AZW/AZW3, FB2, DJVU, CBZ, CBR, CB7, CBT, DOCX, DOC, RTF, ODT, PPTX, PPT, TXT, Markdown, HTML
  and pictures (JPG, PNG, GIF, WebP). A file with no ending in its name, as phones hand them over, is recognised
  by its contents.
- Shelves of your own: put books on shelves you name ("Semester 1 — Biology"); a book can stand on several.
- Home is a library: the book you were reading on top, your reading time, a twelve-week reading calendar,
  shelves to filter by (favourites, reading, finished, kind of file), and cloth-bound covers for books that
  have none. "Quick notes" is a notebook that belongs to no book.
- Go to anything (Ctrl+K): every action and every book, found by typing a few letters.
- Study timer with a chime, and sounds to work to (rain, the sea, a fire, brown noise) made on the device; an accent colour of your choice; a warmer or dimmer screen; a reading ruler.
- PDFs: fit the width or the whole page, two pages side by side, turn the pages on their side, scroll by
  itself at three speeds, and type a page number to go there. "Look up" gives a selected word's meaning from a
  free online dictionary and can put it in your notes.
- Notes: find and replace, raised and lowered text, symbols, a link to the page the book is open at, paper
  colours and narrow or wide lines, typewriter writing, checklist progress, read the note aloud, and save it as
  a Word document or a web page.
- Flashcards can be saved for Anki; highlights, a canvas page and the mind map can each be saved as a file.
- Reading aloud takes a voice and a pace of your choosing and can stop by itself after a set time. The screen
  can be kept on while a book is open, and Focus takes the whole screen and shows the time.
- Closing a book tells what that sitting came to: time, how far you got, highlights and notes added, cards answered.
- Home shows how long you have spent with each book, roughly how long the rest will take, and one of your own
  highlights each day.
- A PDF remembers the page you jumped from. A picture can be turned and put into your notes. A line in a note
  can be moved, copied or removed. Flashcards can be practised whether due or not; highlights can be searched.
- Study guide: for the page in front of you, the few sentences that carry its weight; the terms the book turns
  on and the pages each is thickest; and the passages in your other books closest to it in subject. Worked out
  on the device from the books' own words (word counts and rarity, no service asked).
- Ask your books: type a question and get the passages across your whole library that best answer it, ranked
  the way search engines rank (BM25), the question's words marked. On the device; no AI service.
- Teach it back: pick a key term, explain it in your own words without looking, and see which of the book's key
  ideas on it you brought in and which it also speaks of, with the passage to check against.
- Timeline: the years a book speaks of, each with its sentence, in order, to jump by or put in your notes.
- The guide also asks: a few questions on the page, each a weighty sentence with a key term taken out to pick
  back; and draws the book's ideas as a map, terms joined when they keep turning up together.
- Every highlight is a card: with a comment, the passage then the comment; without one, the book's weightiest
  term in it is hidden, to be recalled.
- Picture cards: box a diagram on a PDF page, or take a picture, and cover its labels; each covered label is a
  flashcard. Words run over with the marker in a note become hidden-word cards.
- Reading plans: choose a day to finish a book by. Home lists today's reading with each book's mark for the day,
  and a PDF's bar says which page to reach today. Reading ahead lightens the days after.
- Glossary: the guide finds, for each key term, the sentence where the book says what it is, and puts the lot
  in your notes as a table with links to the pages. Running heads and feet (a copyright line on every slide)
  are left out of all of this.
- Study pack: everything kept about a book as one document to read or print: what the book is, your notes
  with their pictures, highlights and comments, the glossary, key terms with their pages, and your cards as
  questions with the answers after them.
- Read text: drag a box over a scanned page or a picture, or take a whole page, and its words go into your
  notes ([Tesseract.js](https://github.com/naptha/tesseract.js), Apache-2.0, fetched from the internet the first
  time). The language is chosen in the More menu.
- Sound beside a note: record a lecture or yourself; each new line you write meanwhile is stamped with its
  moment, and tapping a stamp plays the recording from there. Recordings travel in the one-file bundle and backup.
- Lecture notes: a heading for each page or slide. Turn to a slide (in a deck or a PDF of slides) and the note
  goes to that slide's heading, made the first time; a heading you leave empty is taken away again.
- Notes keep pace with the book: turn to a page of a PDF, or read on in an EPUB, MOBI or FB2, and the note
  moves to what you quoted or clipped from there.
- Three kinds of notes per book: written notes, a paged canvas, and a mind map. Open any of them beside the
  book and drag the tabs to rearrange.
- Paper styles for notes: blank, lined (exercise book), grid and dots. Writing sits on the rules as it does in
  an exercise book, whatever its size or typeface, and a new note is an empty page.
- Writing tools in the note's own bar: bold, italic, underline, strike through, text colour, marker, larger and
  smaller words, typeface (plain, book, handwriting, typewriter), and left / centre / right / full alignment.
  The same bar has undo and redo, turns a line into a heading, a bullet, numbered or check list or a quote,
  inserts a picture from the device, a table, a dividing line, today's date, a ready-made layout or a link to
  another book's notes, shows which looks are on under the cursor, and counts the words.
  The page as a whole has its own typeface, size and ink. All of it is kept inside the Markdown note as small
  pieces of HTML, so the note stays one plain file.
- "Flip" turns PDFs, slide decks, DjVu books and your canvas notebook into a book you leaf through, with a paper
  curl as each page turns. EPUB, MOBI and FB2 text curls the same way: Sidepage lays the chapter out in page-wide
  columns and hands the pages to StPageFlip (this part is Sidepage's own, in `src/viewers/CurlBook.tsx`).
  The choice is remembered, and no scrollbars are shown anywhere.
- Search inside a book or PDF; each match leads to its place.
- Reading comfort: text size, line spacing and typeface for books; zoom for PDFs, with buttons or two fingers.
- Bookmarks in books and PDFs, and a contents menu for both (a PDF's own outline, where it has one).
- Search across the written notes of every book; a result opens the book and shows the line.
- Focus mode hides everything but the page and your notes.
- Highlight passages in four colours and add a comment to each, in books and in PDFs; they are listed in the
  Highlight menu, kept automatically, and drawn again whenever the book is opened.
- Clip: drag a box over part of a PDF page (a figure, a formula) and it goes into your notes as a picture, kept
  as a file beside the note, with a link back to its page.
- Drawings made on a PDF's pages are kept automatically (as a copy of the PDF beside the notes) and are there
  when the PDF is opened again.
- A map of the book runs down the side of a PDF: marks for the pages you highlighted (in their colours), wrote
  about in your notes, or bookmarked, where you are, and today's mark from a reading plan. Tap it to go there.
- "All pages" shows every page of a PDF as a small picture, to jump by eye.
- A clip lands on the Canvas, as a picture to draw around, when the Canvas is the note in front. A quote or a clip
  opens the Notes tab if it was closed.
- Note templates: Cornell notes, question and answer, chapter summary, key terms.
- Keyboard shortcuts: Ctrl+O open, Ctrl+1/2/3 Notes/Canvas/Mind map, Ctrl+. focus, Ctrl+Shift+L layout,
  Ctrl+Shift+D theme.
- One search for everything: the notes of every book and the words of every book you have opened. A result
  opens the book at that page or part.
- Highlights: every highlight from every book in one list, filtered by colour.
- The mind map can grow from the book itself: its key terms as branches, each gathered under the term it keeps
  company with.
- The mind map can grow from a note: its headings and bullet points become branches.
- A note has an outline to jump by, and can be printed.
- Home: favourite books stay in front, books can be ordered by title or progress, and a daily reading goal
  shows how far along you are.
- Back up all notes into one file, and restore them on any device. Nothing already there is overwritten.
- The home screen shows your reading time and lets you search your books; the theme can follow the device.
- Read along: while a PDF or a book is read aloud, the sentence being spoken is lit on the page and kept in view.
- Read aloud: books and PDFs are read page by page with the device's own voices, where it has them.
- Review: flashcards make themselves from your highlights (the passage, then your comment) and from "Q:" / "A:"
  lines in your notes, and come back when [FSRS](https://github.com/open-spaced-repetition/ts-fsrs) says it is time.
- Export notes: a book's notes, highlights and bookmarks as one Markdown file.
- The home screen shows each recent book with its cover and how far you have read.
- Light, sepia and dark themes for the whole workspace. On dark PDF and document pages the text turns
  light-on-dark while photographs keep their real colours, cut out along their own outlines.
- Stylus friendly: touch the canvas or a PDF page with a pencil and the pen tool is picked up for you.
- Cite: the open book as an APA, MLA, Chicago or BibTeX reference, from what the file says about itself; copy it
  or put it in your notes. Go to anything saves a bibliography (.bib) or a reading list of the whole library.
- Translate a selected passage into English, French and ten other languages (by MyMemory, a free online
  service), and put the translation in your notes with the original under it.
- Earlier versions of a note are kept as you write (every ten minutes or so, the last sixty): compare any of
  them with the note now, line by line, and bring one back.
- Mock exam: four-answer questions from the cards of the books you choose, against the clock if you like; the
  score book by book, what you missed with the right answers, and the choice to count it in your reviews.
- Review shows how learning is going: cards known, learning and new, how often you remember, days in a row,
  and how many cards fall due on each of the next fourteen days.
- Type [[ in a note to link to another book's notes, picking it from a list that narrows as you type.
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

Every release at https://github.com/cLLeB/sidepage/releases carries a build for each platform, made by
`.github/workflows/release.yml` when a version tag is pushed:

| Platform | File | Notes |
| --- | --- | --- |
| Windows | `Sidepage_x.y.z_x64-setup.exe` | Not code-signed: Windows asks you to confirm. |
| macOS (Apple silicon and Intel) | `Sidepage_x.y.z_universal.dmg` | Not notarised: right-click the app and choose Open the first time. |
| Linux | `.AppImage` and `.deb` | |
| Android phones, tablets, Chromebooks | `Sidepage_x.y.z_android-test.apk` | A test build signed with a throwaway key; allow installing from your browser or file manager. |
| iPhone, iPad, and any browser | https://clleb.github.io/sidepage/ | Open it and choose Install or Add to Home Screen. Works offline afterwards. An installable iOS app file needs an Apple developer account to sign it, so iOS uses the web app. |

On desktop, notes are saved under `Documents/Sidepage`. In the web app they are kept by the browser, or in a
folder you choose. The layout stacks on upright tablets and becomes one tab strip on phones.

To build the desktop app yourself: `npm run tauri build` (needs the Rust toolchain). `Sidepage.cmd` opens the
built web app in its own window on Windows without compiling anything.

## Develop

```
npm install
npm run dev
```

`node scripts/check-in-edge.mjs <url> <snippet.js>` runs a snippet inside the app in a headless Microsoft Edge,
for checks that need real rendering (page turns, PDF pages).

`node scripts/verify-desktop.mjs <path to sidepage.exe> [book]` starts the built desktop app and checks that
every sample format opens (it reads the samples from the dev server, so keep `npm run dev` running).

## Not there yet

CHM. Old `.doc` and `.ppt` files open as static pages: unusual layouts, charts and effects may be simplified.

## Licence

Sidepage's own glue code is GPL-3.0-or-later. Each bundled project keeps its own licence, listed above.