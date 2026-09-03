// Optional local helper for Meeting Scribe. Runs entirely on plain Node (no
// Electron - that's specifically what triggered the Windows Application
// Control block on the desktop-app attempt). Manages a native whisper.cpp
// binary + model and exposes a small local HTTP API the web app calls
// automatically when this is running, for roughly 100x faster transcription
// than the in-browser WebAssembly fallback.
const http = require('node:http');
const { ensureEngineReady, MODELS } = require('./whisperEngine');
const { transcribeAudioBuffer } = require('./transcribe');

const PORT = 5174;

function setCorsHeaders(res, origin) {
  // Bound to 127.0.0.1 only, so the only thing that can reach this at all is
  // something already running on this machine - open CORS here is safe.
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res) => {
  setCorsHeaders(res, req.headers.origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/transcribe') {
    const modelId = url.searchParams.get('model') || 'base.en';
    if (!MODELS[modelId]) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unknown model: ${modelId}` }));
      return;
    }

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        const audioBuffer = Buffer.concat(chunks);
        console.log(`[transcribe] received ${(audioBuffer.length / 1024 / 1024).toFixed(1)}MB, model=${modelId}`);

        const { exePath, modelPath } = await ensureEngineReady(modelId, (p) => {
          if (p.totalBytes) {
            console.log(`[engine setup] ${p.stage}: ${Math.round((p.receivedBytes / p.totalBytes) * 100)}%`);
          }
        });

        const t0 = Date.now();
        const result = await transcribeAudioBuffer(audioBuffer, { exePath, modelPath });
        console.log(`[transcribe] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error('[transcribe] error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err?.message || err) }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Meeting Scribe local engine running at http://localhost:${PORT}`);
  console.log('Leave this running - the web app will automatically use it for much faster transcription.');
  console.log('Press Ctrl+C to stop.');
});
