const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const ENGINE_ROOT = path.join(os.homedir(), '.meeting-scribe-engine');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function engineRoot() { return ensureDir(ENGINE_ROOT); }
function engineBinDir() { return ensureDir(path.join(ENGINE_ROOT, 'bin')); }
function engineModelsDir() { return ensureDir(path.join(ENGINE_ROOT, 'models')); }
function tempDir() { return ensureDir(path.join(os.tmpdir(), 'meeting-scribe-engine')); }

module.exports = { engineRoot, engineBinDir, engineModelsDir, tempDir };
