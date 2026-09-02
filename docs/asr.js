// In-browser, fully local speech-to-text via Transformers.js (WebAssembly/ONNX).
// The model is loaded from Hugging Face's CDN once, then cached by the browser
// and reused offline. No audio or text ever leaves the machine.
const MODEL_IDS = {
  'tiny.en': 'Xenova/whisper-tiny.en',
  'base.en': 'Xenova/whisper-base.en',
  'small.en': 'Xenova/whisper-small.en',
};

const MODEL_LABELS = {
  'tiny.en': 'Tiny (fastest, least accurate)',
  'base.en': 'Base (recommended)',
  'small.en': 'Small (most accurate, slowest)',
};

function listModels() {
  return Object.keys(MODEL_IDS).map((id) => ({ id, label: MODEL_LABELS[id] }));
}

let transformersModule = null;
let cachedPipeline = null;
let cachedModelId = null;

async function getTranscriber(modelId, onProgress) {
  if (cachedPipeline && cachedModelId === modelId) return cachedPipeline;

  if (!transformersModule) {
    // Pinned to v3, not v4: v4 pulls in a newer onnxruntime-web build that fails
    // to load ANY quantized variant of this model (missing-scale error on load),
    // which previously forced us onto unquantized fp32 weights — correct, but
    // roughly 5-10x slower to run, turning real meeting-length recordings into
    // multi-hour transcriptions. v3's older onnxruntime-web loads quantized
    // ("q8") weights correctly, restoring both a smaller download and fast
    // inference. Verified directly against this exact model before switching.
    transformersModule = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/+esm');
  }
  const { pipeline } = transformersModule;

  cachedModelId = modelId;
  cachedPipeline = pipeline('automatic-speech-recognition', MODEL_IDS[modelId], {
    dtype: 'q8',
    progress_callback: onProgress,
  });
  return cachedPipeline;
}

// Decodes any browser-playable audio Blob into Float32 mono PCM at 16kHz,
// the format Whisper models expect.
async function decodeToMono16k(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  await decodeCtx.close();

  const targetRate = 16000;
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded; // OfflineAudioContext auto-resamples and downmixes to the destination's format.
  source.connect(offlineCtx.destination);
  source.start();
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

async function transcribeBlob(blob, modelId, { onModelProgress } = {}) {
  const transcriber = await getTranscriber(modelId, onModelProgress);
  const audioData = await decodeToMono16k(blob);

  const result = await transcriber(audioData, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
  });

  const segments = (result.chunks || [])
    .map((c) => ({
      start: c.timestamp?.[0] ?? 0,
      end: c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0,
      text: (c.text || '').trim(),
    }))
    .filter((s) => s.text.length > 0);

  const fullText = (result.text || segments.map((s) => s.text).join(' ')).replace(/\s+/g, ' ').trim();
  return { segments, fullText, generatedAt: Date.now() };
}

window.ASR = { listModels, transcribeBlob };
