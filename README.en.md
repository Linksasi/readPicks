# ReadPicks

> Look up words while reading · Context-aware understanding · Spaced-repetition vocabulary building (Windows desktop)

[English](README.en.md) | [中文](README.md)

When reading English web pages, papers, or PDFs, select an unfamiliar word and press `Alt+Q` — a floating card shows the phonetic, definitions, and frequency tags. ReadPicks also records **the word together with the sentence you met it in**, then reviews it with the SM-2 spaced-repetition algorithm, turning words you encounter while reading into vocabulary you actually own — a native-like learning loop.

---

## ✨ Features

### 🖱️ Select-and-look-up (UIA direct read, zero clipboard pollution)

- **Global hotkey** `Alt+Q` (customizable in Settings), works in any application
- Prefers **Windows UI Automation** to read the selected text *and its surrounding paragraph* directly — the clipboard is never touched
- Automatic fallback when UIA is unavailable: **simulated Ctrl+C with clipboard snapshot restore** (saves text/HTML/image → copy → read → restore instantly), so your clipboard is always left exactly as it was
- **Auto classification**: a single word or a phrase of ≤5 words → word card; longer text → sentence translation
- **Text cleaning**: strips stray punctuation/quotes from the selection; merges broken lines from PDF copies (hyphen at line end joins directly, otherwise space-joined)
- De-duplicates repeated queries within 3 seconds; the popup window is pre-created, so pressing the hotkey shows instant feedback

### 🧠 Context understanding (the differentiator)

- **Clipboard history recall**: automatically searches sentences copied in the last minute for one containing the queried word and uses it as context — no manual steps needed
- **In-context meaning**: full-sentence translation plus the word's **exact meaning in that sentence** (distinct from the dictionary's general definition)
- **Cloze saved**: the context sentence is stored in fill-in-the-blank form `{{c1::word}}`, so review tests recall first
- With an **LLM translation provider** configured, you also get: why it's translated this way, part-of-speech/collocation/grammar usage, and other words in the sentence worth learning

### 🗂️ Word card UI

- Word + phonetic + 🇬🇧 British / 🇺🇸 American pronunciation (Youdao online TTS)
- Frequency & exam tags from ECDICT (`cet4` `cet6`, 考研/IELTS/TOEFL, etc.)
- **Query history**: collapsible timeline of every past query with its context and sentence translation
- **My notes**: record usage or memory hooks per word
- **Recent queries** quick access, 📌 pin the floating card, `Esc` to close

### 📚 Vocabulary book & SM-2 review

- Every query is stored automatically: word / phonetic / definition / context / sentence translation / first & last seen / query count
- **SM-2 spaced repetition** (the same algorithm Anki uses); tray menu "Today's Review" shows cards for self-grading: **Forgot / Fuzzy / Known**
- Vocabulary management: total & due counts, delete words

### 🗃️ Anki export

One click from Settings exports a tab-separated `.txt` (UTF-8, with `#separator:tab` / `#deck` / `#tags` headers) that Anki imports directly.

### 📖 Offline dictionary (ECDICT)

- **760,000 entries**: phonetics, definitions, word frequency, exam tags
- **One-click download** from Settings (~216 MB, resumable) or **install from a local zip** (handy when the network is slow — download in a browser, then import)
- **Instant offline lookup** once installed; built-in **lemma inflection handling** (`gave` → `give`)
- No dictionary installed? Online translation covers the gap automatically

### 🌐 Multiple translation providers

| Provider | Notes |
|---|---|
| **MyMemory** (default) | Free, no configuration needed, fine for daily use |
| **Youdao Zhiyun** | Needs appKey/appSecret from the Youdao console |
| **Baidu Translate** | Needs appId/key from the Baidu open platform |
| **DeepL** | Needs apiKey; supports free and paid endpoints |
| **LLM (OpenAI-compatible)** | DeepSeek, Qwen, etc.; custom baseUrl/model/**system prompt**; adds "in-context meaning + why + usage + other words worth learning" |
| Dictionary only | Fully offline, no online translation |

All translations are cached for **10 minutes** to avoid repeated requests.

### 🎛️ More

- **Copy-to-popup** (optional): copy anything with Ctrl+C and the popup appears automatically
- Tray-resident, single-instance lock; automatic data migration from the legacy `tran-en` data directory

---

## 🚀 Quick start

### Option 1: Run from source (dev / personal use)

```bash
# 1. Install dependencies (if the Electron download is slow, set the mirror first — see FAQ)
npm install

# 2. Start the app (stays resident in the system tray)
npm start
```

### Option 2: Build an installer

```bash
npx electron-builder --win nsis      # installer
npx electron-builder --win portable  # portable green build
```

### First-run walkthrough

1. Open Settings (tray icon → right-click → Settings)
2. **Dictionary**: download the ECDICT offline dictionary (~216 MB), or skip — online translation works without it
3. **Translation**: MyMemory works out of the box; for per-word context explanations, configure an LLM (e.g. DeepSeek)
4. Open any English page, select a word, press `Alt+Q`

---

## 📖 Usage guide

| Action | How |
|---|---|
| **Look up a word/phrase** | Select text → press `Alt+Q` |
| **Look up with context** | Copy a sentence **containing the word** with Ctrl+C (within 1 minute) → select the word → press `Alt+Q`; context appears automatically |
| **Translate a sentence** | Select the whole sentence → press `Alt+Q` (auto sentence translation, PDF line breaks cleaned) |
| **Hear pronunciation** | Click 🇬🇧 / 🇺🇸 on the word card |
| **Review** | Tray → "Today's Review" → self-grade Forgot / Fuzzy / Known |
| **Export to Anki** | Settings → Vocabulary → Export Anki |
| **Take notes** | Word card → "My Notes" → save |
| **Pin / close** | 📌 pins the card; `Esc` or ✕ closes it |

> 💡 Tip: when you meet an unfamiliar word, copy the **whole sentence** first, then look up the word — over time this builds a personal corpus of words in their real contexts.

---

## ⚙️ Settings reference

| Setting | Description | Default |
|---|---|---|
| Global hotkey | Triggers lookup in any app | `Alt+Q` |
| Copy-to-popup | Watch the clipboard and pop up on copy | Off |
| Default provider | mymemory / youdao / baidu / deepl / llm / dictionary only | `mymemory` |
| LLM Base URL | OpenAI-compatible endpoint | `https://api.deepseek.com/v1` |
| LLM model | Model name | `deepseek-chat` |
| LLM system prompt | Controls the returned JSON structure; customizable | Built-in default |

**Provider sign-up links**: Youdao [ai.youdao.com](https://ai.youdao.com) · Baidu [fanyi-api.baidu.com](https://fanyi-api.baidu.com) · DeepL [deepl.com/pro-api](https://www.deepl.com/pro-api)

---

## 💾 Data & storage

Data directory is fixed at `%APPDATA%/readpicks/`:

```
%APPDATA%/readpicks/
├── words.db                vocabulary + query history (SQLite, WAL mode)
├── config.json             app configuration (hotkey / providers / toggles)
├── clipboard-history.json  clipboard history (source for context recall)
├── ecdict/
│   └── ecdict.db           ECDICT offline dictionary (~216 MB, read-only)
└── uia.ps1                 UIA selection script (generated at runtime)
```

**words.db — two tables**:

- `words` — vocabulary: `word` (PK), `phonetic`, `definition`, `first_seen`, `last_seen`, `query_count`, `note`, plus SM-2 state columns `efactor` / `interval` / `repetitions` / `due_date`
- `queries` — query history: per-query `context` (original sentence), `context_cloze` (cloze), `sentence_translation`, `word_in_sentence` (in-context meaning), `source`, timestamp

> Legacy installations used a `tran-en` directory; it is migrated automatically on first launch (rename or copy), no manual action needed.

---

## 🔧 Architecture

```
Selected text ──hotkey──▶ Grab (UIA direct read → clipboard snapshot fallback)
                              │
                              ▼
                   Clean + classify (word / phrase / sentence)
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
        Word card: ECDICT dict          Sentence: online
        + clipboard-history recall       translation
        + sentence translation (in-context meaning)
        + optional LLM explanation
              │
              ▼
        Auto-store words + queries ──▶ floating card
              │
              ▼
        SM-2 review (tray) ◀──▶ Anki export
```

Key design decisions:

- **Resident PowerShell command channel**: text grabbing and Ctrl+C simulation run through one long-lived PowerShell process (with a `__DONE__` marker protocol for output), avoiding the 400ms+ process-spawn cost per keystroke; `uia.ps1` must be UTF-8 with BOM (PowerShell 5.1)
- **Electron 37 + better-sqlite3 + supermemo**: no other native modules; better-sqlite3 is synchronous, WAL mode keeps reads/writes fast
- Single-instance lock; tray-resident with all windows hidden

The full design doc (including a survey of similar tools and the trade-offs made) lives in [PLAN.md](PLAN.md).

---

## 🛠️ Development

**Requirements**: Windows 10/11 · Node.js 18+ · npm

```bash
npm install          # installs deps (postinstall rebuilds better-sqlite3)
npm start            # run in dev
```

**Tests** (⚠️ run with `npx electron`, not `node` — better-sqlite3 is built against the Electron ABI):

```bash
npx electron scripts/smoke-test.js   # core logic: db / SM-2 / Anki export / context recall / translation
npx electron scripts/gui-test.js     # GUI end-to-end: IPC / rendering / persistence
npx electron scripts/uia-test.js     # UIA grabbing + resident PowerShell channel
npx electron scripts/dl-test.js      # ECDICT download + lookup verification
npx electron scripts/perf-test.js    # performance benchmark
```

**Build**:

```bash
npx electron-builder --win nsis      # installer
npx electron-builder --win portable  # portable build
```

### FAQ

**Q: Electron downloads slowly during `npm install` / build?**
Use the npmmirror in China:

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

And for building:
`ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`

**Q: The hotkey does nothing?**
Another app may be holding `Alt+Q` — change it in Settings. UIA grabbing can fail on some legacy apps; the clipboard fallback kicks in automatically.

---

## 📄 License

[MIT](LICENSE) © 2026 Linksasi
