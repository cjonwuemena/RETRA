const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

// Downloads a URL to disk, reporting progress via onProgress({receivedBytes, totalBytes}).
async function downloadFile(url, destPath, onProgress) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status} ${res.statusText}) for ${url}`);
  }

  const totalBytes = Number(res.headers.get('content-length')) || 0;
  let receivedBytes = 0;

  const nodeStream = Readable.fromWeb(res.body);
  nodeStream.on('data', (chunk) => {
    receivedBytes += chunk.length;
    if (onProgress) onProgress({ receivedBytes, totalBytes });
  });

  const tmpPath = `${destPath}.download`;
  await pipeline(nodeStream, fs.createWriteStream(tmpPath));
  fs.renameSync(tmpPath, destPath);
}

module.exports = { downloadFile };
