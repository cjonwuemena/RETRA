# Meeting Scribe

A local, private meeting recorder and transcriber. Records your microphone and
(optionally) your system audio, then transcribes the recording entirely on
your own machine — no account, no cloud upload, no subscription, no bot
joining your call.

## Why this instead of Otter.ai

- **$0, forever.** No API keys, no per-minute billing, no subscription tier.
- **Fully local.** Recording and transcription both happen on your machine.
  The only network request is a one-time download of the transcription
  model (cached by the browser afterward — works fully offline from then on).
- **No bot in the meeting.** Like Otter's desktop app, it captures audio
  straight off your system, so nothing joins the call as a visible
  participant.

## Requirements

- [Node.js](https://nodejs.org) (already installed on this machine)
- Google Chrome or Microsoft Edge (for system-audio capture support)

No `npm install` is needed for the main app — it has zero dependencies. The
transcription engine loads directly from a CDN into the browser tab the
first time you use it. (The optional local engine below has its own small
setup step, since it trades browser sandboxing for real native speed.)

## Running it

```bash
npm start
```

This starts a tiny local server on `http://localhost:5173` and opens it in
your default browser automatically. Leave the terminal window open while you
use the app; closing it stops the server. To stop it manually, press `Ctrl+C`
in that terminal.

## Using it

1. Click **+ New Recording**, pick your microphone, and leave "Also capture
   system audio" checked if you want the other participants' audio too.
2. Click **Start Recording**. If system audio is enabled, Chrome's
   screen-share picker will open — choose **Entire Screen** and check
   **Share system audio**, then click Share.
3. Click **Stop Recording** when the meeting ends.
4. Pick a transcription quality (Base is a good default) and click
   **Transcribe**. The first time you do this for a given quality level, it
   downloads that model (roughly 100–500MB depending on the size you picked)
   — after that, transcription works offline and is instant to start.
5. Read, copy, or download the transcript.

### Much faster transcription (recommended): the local engine

By default, transcription runs entirely in the browser via WebAssembly. This
works everywhere with zero setup, but it's genuinely slow — a 30-minute
meeting can take hours, since browser WASM has no access to your CPU's full
capabilities.

The `local-engine/` folder is an optional helper that fixes this. It's a
small, separate Node process (not a browser sandbox) that runs
[whisper.cpp](https://github.com/ggml-org/whisper.cpp) — native, highly
optimized C++ — instead. In testing, this was **roughly 100x faster** than
the in-browser path for identical audio. Still completely free, still fully
local — nothing about your recordings changes, only how fast transcription
runs.

**Setup (one time):**
```bash
cd local-engine
npm install
npm start
```

Leave that running in its own terminal. The web app automatically detects it
(you'll see "⚡ Local engine detected" on the Transcribe screen) and uses it
instead of the slow in-browser path — no configuration needed. If you close
that terminal, the app just falls back to the in-browser method again.

The first time you transcribe, it downloads the whisper.cpp engine (~8MB)
and your chosen model (~150–500MB) to `~/.meeting-scribe-engine` — a one-time
cost, cached for every future meeting.

This works whether you're running the main app via `npm start` locally or
using the hosted GitHub Pages version — the web page talks to this local
helper over `localhost`, which browsers allow even from an HTTPS page.

### Saving real files automatically

By default, recordings and transcripts only live in the browser's local
storage — use **Download recording** / **Download transcript** on a meeting
to save a copy to disk manually.

To have every meeting saved as real files automatically instead, use the
**"Choose folder…"** control near the bottom of the sidebar. Pick (or create)
a folder — e.g. `Documents\Meeting Scribe` — and grant access once. From then
on, every recording gets its own subfolder there (named by date and title)
containing `audio.webm` and, once transcribed, `transcript.txt` and
`transcript.json`. This uses Chrome's File System Access API, so it only
works in Chrome/Edge, and Chrome may occasionally ask you to re-approve
access to that folder (the sidebar will show a **Reconnect** button when
that happens).

## Hosting it on the web (GitHub Pages)

The app's files live in `docs/`, which GitHub Pages can serve directly —
nothing server-side is needed, since all recording/transcription still
happens in each visitor's own browser.

**One-time setup:**
1. On GitHub, go to this repo → **Settings** → **Pages**.
2. Under "Build and deployment", set **Source** to "Deploy from a branch".
3. Set **Branch** to `main` and the folder to `/docs`, then **Save**.
4. After a minute or two, GitHub will show the live URL — something like
   `https://cjonwuemena.github.io/RETRA/`.

From then on, every `git push` to `main` updates the live site automatically.

**What's different from running it locally:**
- It's public — anyone with the link can open and use it. Each visitor gets
  their own fully independent copy (their own browser storage, their own
  disk-save folder if they connect one) — you never see their recordings and
  they never see yours, since nothing is stored on a server.
- GitHub Pages can't set the `Cross-Origin-Opener-Policy` /
  `Cross-Origin-Embedder-Policy` headers `server.js` sets locally, so
  transcription runs single-threaded there — it still works, just somewhat
  slower than running it locally via `npm start`.
- HTTPS is automatic (GitHub Pages provides it), which is required anyway —
  microphone and screen capture don't work over plain HTTP.

**Using your own domain instead of `github.io`:** if you want it at, say,
`meetings.giltan.co.uk`, add a `CNAME` record for that subdomain pointing to
`cjonwuemena.github.io` in GoDaddy's DNS settings for `giltan.co.uk`, then
enter that subdomain in the same GitHub Pages settings page. This is
independent of your GoDaddy Airo site — Airo-built sites don't support
custom app code, so this app has to live at its own URL either way.

## Important: recording consent

Nothing about this tool notifies other people on a call that you're
recording — the "share system audio" prompt only appears on your own screen.
Recording a conversation without telling the other participants is illegal in
many places (e.g. many U.S. states and countries require **all** parties'
consent, not just yours). Check the law where you and the other participants
are, and as good practice, just tell people you're recording.

## How it works

- **Recording**: your microphone (`getUserMedia`) and, if enabled, your
  system's audio output (`getDisplayMedia`) are mixed into a single track
  via the Web Audio API and recorded with `MediaRecorder`.
- **Storage**: meetings, recordings, and transcripts are stored in the
  browser's IndexedDB, scoped to whatever URL you're using the app from
  (`http://localhost:5173` when run locally, or its GitHub Pages URL if
  hosted). Clearing that origin's site data in the browser will delete them.
- **Transcription**: runs in-browser via
  [Transformers.js](https://huggingface.co/docs/transformers.js) using a
  WebAssembly build of OpenAI's Whisper model (converted to ONNX by the
  Xenova project). Audio is decoded and resampled client-side and never
  leaves the page.

## Known limitations (v1)

- Recordings are buffered in browser memory until you click Stop, so very
  long meetings (multiple hours) will use a proportionate amount of RAM.
- No speaker labels (who said what) — this was intentionally left out of v1.
- No cross-meeting search — the sidebar lists meetings by title/date only.
- System audio capture requires re-picking "Entire Screen + Share audio" for
  every recording; this is a Chrome/OS requirement, not something the app
  can skip.
- Auto-save to disk (File System Access API) only works in Chrome/Edge, and
  the browser can't reveal the folder's full path (e.g. it'll show
  "Meeting Scribe", not `C:\Users\...\Documents\Meeting Scribe`) — a security
  restriction of the API, not something the app can bypass.
- If you rename a meeting after it's been auto-saved, new files (like the
  transcript) still go to the original folder created for that meeting,
  rather than one matching the new name — this keeps files from a single
  meeting from getting split across two folders.
- The optional local engine (`local-engine/`) currently only supports
  Windows — it downloads a Windows whisper.cpp build and uses PowerShell to
  extract it. Without it, transcription still works everywhere via the
  in-browser path, just much more slowly.
