# Ask your own AI about a book

Ask questions about the book you are reading in a chat beside it. The AI reads the book itself, searches it, and says which pages it used. It uses **the AI subscription you already have**: no API key, nothing extra to pay.

| Your plan | The AI's app Sidepage uses |
| --- | --- |
| Claude Pro or Max | Claude Code |
| ChatGPT Plus, Pro or Team | Codex |
| A Google account | Gemini CLI |

Ask AI works in the Sidepage app on **Windows, Mac and Linux**. It is not offered on phones, tablets or in the browser version, because it runs the AI's own app on your computer.

## Set up (once)

### Claude

1. Install **Claude Code**. In a terminal (PowerShell on Windows, Terminal on a Mac):
   - Windows: `irm https://claude.ai/install.ps1 | iex`
   - Mac and Linux: `curl -fsSL https://claude.ai/install.sh | bash`

   Full instructions: [claude.com/product/claude-code](https://claude.com/product/claude-code).
2. Start Sidepage (or restart it if it was open) and open a book.
3. Click **Ask AI** in the top bar.
4. If the panel shows **Sign in with your Claude account**, click it. Your browser opens; sign in with the account that has your Claude subscription and allow access. Back in Sidepage, the panel shows **✓ Signed in**.

### ChatGPT (Codex)

1. Install Codex: `npm install -g @openai/codex` in a terminal (needs [Node.js](https://nodejs.org)). Full instructions: [developers.openai.com/codex/cli](https://developers.openai.com/codex/cli).
2. In Sidepage, open **Ask AI**. If it shows **Sign in with your ChatGPT (Codex) account**, click it and sign in in the browser.

### Gemini

1. Install Gemini CLI: `npm install -g @google/gemini-cli`. Full instructions: [github.com/google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli).
2. Run `gemini` once in a terminal and sign in with your Google account.
3. In Sidepage, open **Ask AI**.

When several are installed, choose which one at the top of the Ask AI panel.

## Ask

1. Open the book and go to the page you are asking about.
2. Click **Ask AI** in the top bar.
3. Type your question and press <kbd>Enter</kbd>. For a new line, press <kbd>Shift</kbd> <kbd>Enter</kbd>.
   Or tap a ready question: **Explain this page simply**, **Sum up this part in five points**, **Quiz me on this page**, **What should I remember from this?**

The panel shows what the AI is doing (**Searching the book for "Péclet"…**, **Reading the book…**), then the answer as it is written. Formulas, lists and tables are shown properly. Answers name the pages they come from, such as (p. 17).

The AI knows which page you are on, so "explain this page" just works. Ask follow up questions: it remembers the conversation. Click **New chat** to start over. Each book keeps its own conversation while Sidepage is open.

To stop an answer, click **■** in the question box.

## Use an answer

Under each answer:

- **Add to notes** puts the answer in your notes.
- **Copy** copies it.

## Any kind of file

The AI reads PDFs, e-books, Word documents, slides, text and web pages from their text. For scanned pages, pictures, comics and DjVu, it is also given the file itself and a picture of the page you are looking at, so it can see what is there.

## Privacy: what the AI can see and do

- The AI reads only the book's folder of notes on your computer (in **Documents/Sidepage/the book's name**): the book's text, the book itself when it can read it, the picture of your current page, and your notes for that book.
- It can **read and search** these files, nothing else. It cannot run programs, change files, or look elsewhere on your computer.
- What you ask, and the parts of the book the AI reads to answer, go to the AI's company (Anthropic, OpenAI or Google) under your account, as they do when you use their own apps. Do not ask about anything you would not put into their app.

## Troubleshooting

| You see | Do this |
| --- | --- |
| **Ask AI with your subscription** and a list of apps | None of the AI apps is installed, or Sidepage cannot find it. Install one as above, then click **Check again** |
| **Sign in with your … account** | Click it and sign in in the browser |
| **Open a book first** | Ask AI answers about a book: open one |
| An error about login or credentials | Sign in again: in a terminal run `claude auth login` (or `codex login`, or `gemini`) |
| A limit or usage message | Your plan's usage limit is reached. It resets after a while; see your AI provider's site |
| No answer, or very slow | Long books take longer the first time. Check your internet connection |
| There is no Ask AI button | You are on a phone, a tablet or the browser version. Use the Sidepage app on a computer |
