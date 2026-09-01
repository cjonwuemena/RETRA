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

No `npm install` is needed — the app has zero dependencies. The transcription
engine loads directly from a CDN into the browser tab the first time you use it.

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
5. Read, copy, or download the transcript. Recordings and transcripts are
   kept in the browser's local storage for this page — use **Download
   recording** / **Download transcript** to save real files to disk.

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
  browser's IndexedDB, scoped to `http://localhost:5173`. Clearing that
  origin's site data in the browser will delete them.
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
