const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static');
const { tempDir } = require('./paths');

const SEGMENT_RE = /^\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)$/;

function timestampToSeconds(ts) {
  const [h, m, sMs] = ts.split(':');
  const [s, ms] = sMs.split('.');
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-y',
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      outputPath,
    ]);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

function runWhisper({ exePath, modelPath, wavPath, outBase }) {
  return new Promise((resolve, reject) => {
    const proc = spawn(exePath, [
      '-m', modelPath,
      '-f', wavPath,
      '-of', outBase,
      '-otxt',
    ], { cwd: path.dirname(outBase) });

    const segments = [];
    let buffer = '';
    let stderrTail = '';

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const match = SEGMENT_RE.exec(line.trim());
        if (match) {
          segments.push({
            start: timestampToSeconds(match[1]),
            end: timestampToSeconds(match[2]),
            text: match[3].trim(),
          });
        }
      }
    });

    proc.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(segments);
      else reject(new Error(`whisper-cli exited with code ${code}\n${stderrTail}`));
    });
  });
}

// Full pipeline: raw webm bytes -> wav -> whisper.cpp -> {segments, fullText}.
// Cleans up all temp files itself, win or lose.
async function transcribeAudioBuffer(audioBuffer, { exePath, modelPath }) {
  const workDir = tempDir();
  const id = `job-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const webmPath = path.join(workDir, `${id}.webm`);
  const wavPath = path.join(workDir, `${id}.wav`);
  const outBase = path.join(workDir, id);

  fs.writeFileSync(webmPath, audioBuffer);
  try {
    await convertToWav(webmPath, wavPath);
    const segments = await runWhisper({ exePath, modelPath, wavPath, outBase });
    const fullText = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
    return { segments, fullText };
  } finally {
    for (const f of [webmPath, wavPath, `${outBase}.txt`]) {
      fs.rmSync(f, { force: true });
    }
  }
}

module.exports = { transcribeAudioBuffer };
