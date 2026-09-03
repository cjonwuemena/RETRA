// Talks to the optional local engine (see local-engine/) if it's running.
// That's a plain Node process (not a browser sandbox), running native
// whisper.cpp — roughly 100x faster than the in-browser WebAssembly
// fallback. Entirely optional: everything still works without it.
const LOCAL_ENGINE_URL = 'http://localhost:5174';

async function isAvailable() {
  try {
    const res = await fetch(`${LOCAL_ENGINE_URL}/health`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

async function transcribe(blob, modelId) {
  const res = await fetch(`${LOCAL_ENGINE_URL}/transcribe?model=${encodeURIComponent(modelId)}`, {
    method: 'POST',
    body: blob,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Local engine error (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return { segments: data.segments, fullText: data.fullText, generatedAt: Date.now() };
}

window.LocalEngine = { isAvailable, transcribe };
