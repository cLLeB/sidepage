# Ask an AI about a book

Ask questions about the book you are reading in a chat beside it. The AI searches the book, reads the pages it needs, and says which pages it used. There are two ways to connect an AI:

| Way | Where it works | What it costs |
| --- | --- | --- |
| [**With a key**](#with-a-key) from the AI's service | Everywhere: phones, tablets, computers and the browser version | Free with a Gemini key from Google; Claude and ChatGPT keys are paid by use |
| [**With the AI's app**](#with-the-ai-s-app-on-a-computer), signed in with your subscription | The Sidepage app on Windows, Mac and Linux | Nothing extra: it uses the Claude, ChatGPT or Google plan you already have |

## With a key

### Get a free Gemini key (the easiest)

1. In Sidepage, click **Ask AI** (on a phone, in the bottom bar). The panel shows **Connect an AI**.
2. Keep **Google Gemini** chosen and tap **Get a free key from Google**. Google AI Studio opens in your browser.
3. Sign in with your Google account, then click **Create API key**. Copy the key it shows.
4. Back in Sidepage, paste it into **Key** and tap **Connect**.

That is all: ask your first question. The free plan has daily limits that are plenty for studying; when one is reached, Sidepage says so and you can ask again later.

### Claude or ChatGPT

Choose **Anthropic Claude** or **OpenAI ChatGPT**, tap **Get a key from …**, create a key on their site and paste it. Their keys are paid by use (a question about a book usually costs a fraction of a cent), separately from a Claude Pro or ChatGPT Plus subscription. On a computer, the [AI's app](#with-the-ai-s-app-on-a-computer) uses your subscription instead.

### Another service, or an AI on your own computer

**Another service** connects any service that speaks the OpenAI format, by its address:

| Service | Address | Model, for example |
| --- | --- | --- |
| OpenRouter (many models, some free) | `https://openrouter.ai/api/v1` | `google/gemini-flash-latest` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Ollama on your computer | `http://localhost:11434/v1` | `llama3.2` |
| LM Studio on your computer | `http://localhost:1234/v1` | the model loaded in LM Studio |

An AI running on your own computer needs no key and sends nothing over the internet. To use it from a phone or tablet on the same Wi-Fi, use the computer's address instead of `localhost` (for example `http://192.168.1.20:11434/v1`) and let Ollama accept connections from the network (set `OLLAMA_HOST=0.0.0.0`).

### Change or forget the key

At the top of the Ask AI panel, tap **Change**. There you can choose another service, or tap **Forget the key** to remove it from this device.

The **Model** field can be left as it is: Sidepage picks a good one. To use another model of the same service, type its name there.

## With the AI's app on a computer

On Windows, Mac and Linux, Sidepage can also ask through the AI's own app, signed in with **the subscription you already have**: no key, nothing extra to pay.

| Your plan | The AI's app Sidepage uses |
| --- | --- |
| Claude Pro or Max | Claude Code |
| ChatGPT Plus, Pro or Team | Codex |
| A Google account | Gemini CLI |

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

When several are installed, choose which one at the top of the Ask AI panel. To switch between the AI's app and a key, click **Use a key** or **Use the AI app** at the top of the panel.

## Ask

1. Open the book and go to the page you are asking about.
2. Click **Ask AI** in the top bar (on a phone, in the bottom bar).
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

The AI reads PDFs, e-books, Word documents, slides, text and web pages from their text. For scanned pages, pictures, comics and DjVu, it is also given a picture of the page you are looking at, so it can see what is there (and, with the AI's app on a computer, the file itself).

## Privacy: what the AI can see and do

- The AI can only **read and search the open book and your notes on it**. It cannot change anything, run programs, or look at your other books or files.
- What you ask, the page you are on, and the parts of the book the AI reads to answer go to the AI's company (Google, Anthropic, OpenAI, or the service you connected), as they do when you use their own apps. When a page has no text (a scan, a comic), a picture of it is sent too. Do not ask about anything you would not put into their app.
- A key is kept on this device only, and is sent only to the service it belongs to. Google's free plan may use what is sent to improve its products; its paid plan, and Claude and ChatGPT keys, do not.
- An AI on your own computer (Ollama, LM Studio) keeps everything on your computer.

## Troubleshooting

| You see | Do this |
| --- | --- |
| **The service did not accept the key** | The key was copied incompletely, or deleted on the service's site. Tap **Change**, paste it again, or create a new one |
| **The usage limit of this key is reached** | The free plan's limit for the minute or the day is reached. Wait a little, or check your plan on the service's site |
| **The service does not know that model** | Tap **Change** and empty the **Model** field, or check the model's name on the service's site |
| **The service could not be reached** | Check your internet connection. For an AI on your own computer, check it is running and the address is right |
| **Ask AI with your subscription** and a list of apps | On a computer, none of the AI apps is installed, or Sidepage cannot find it. Install one as above and click **Check again**, or click **Or connect an AI with a key** |
| **Sign in with your … account** | Click it and sign in in the browser |
| **Open a book first** | Ask AI answers about a book: open one |
| An error about login or credentials | Sign in again: in a terminal run `claude auth login` (or `codex login`, or `gemini`) |
| A limit or usage message | Your plan's usage limit is reached. It resets after a while; see your AI provider's site |
| No answer, or very slow | Long books take longer the first time. Check your internet connection |
