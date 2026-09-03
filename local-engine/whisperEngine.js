const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { engineBinDir, engineModelsDir, engineRoot } = require('./paths');
const { downloadFile } = require('./download');

const execFileAsync = promisify(execFile);

// Pinned to a known-good whisper.cpp release with verified Windows CPU binaries.
// GitHub never deletes release assets, so this stays valid indefinitely.
const WHISPER_RELEASE_TAG = 'b4938';
const WHISPER_ZIP_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_RELEASE_TAG}/whisper-bin-x64.zip`;

const MODELS = {
  'tiny.en': {
    file: 'ggml-tiny.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  },
  'base.en': {
    file: 'ggml-base.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  },
  'small.en': {
    file: 'ggml-small.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  },
};

function modelPath(modelId) {
  const model = MODELS[modelId];
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  return path.join(engineModelsDir(), model.file);
}

async function ensureModel(modelId, onProgress) {
  const model = MODELS[modelId];
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  const dest = modelPath(modelId);
  if (fs.existsSync(dest)) return dest;
  await downloadFile(model.url, dest, (p) => onProgress?.({ stage: 'model', ...p }));
  return dest;
}

function findExecutable(rootDir) {
  // whisper-cli.exe is the current CLI; older releases also ship a main.exe
  // that's incompatible with newer model files and fails immediately with no
  // output. Both can exist in the same archive, so search deterministically
  // in preference order rather than taking whichever one a directory listing
  // happens to return first.
  for (const candidate of ['whisper-cli.exe', 'main.exe']) {
    const stack = [rootDir];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name === candidate) return full;
      }
    }
  }
  return null;
}

function psQuote(p) {
  return `'${p.replace(/'/g, "''")}'`;
}

async function ensureBinary(onProgress) {
  const existing = findExecutable(engineBinDir());
  if (existing) return existing;

  const zipPath = path.join(engineRoot(), 'whisper-bin-x64.zip');
  await downloadFile(WHISPER_ZIP_URL, zipPath, (p) => onProgress?.({ stage: 'binary', ...p }));

  onProgress?.({ stage: 'extract', receivedBytes: 0, totalBytes: 0 });
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(engineBinDir())} -Force`,
  ]);
  fs.rmSync(zipPath, { force: true });

  const exePath = findExecutable(engineBinDir());
  if (!exePath) {
    throw new Error('whisper.cpp binary was downloaded but the executable could not be located after extraction.');
  }
  return exePath;
}

// Ensures both the binary and the requested model are present, downloading whatever is missing.
async function ensureEngineReady(modelId, onProgress) {
  const exePath = await ensureBinary(onProgress);
  const modelFile = await ensureModel(modelId, onProgress);
  return { exePath, modelPath: modelFile };
}

module.exports = { MODELS, modelPath, ensureEngineReady };
