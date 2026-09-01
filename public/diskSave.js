// Optional auto-save to a real folder on disk, via the File System Access API
// (Chrome/Edge only). Without this, meetings only ever live in the browser's
// IndexedDB — this lets the app write actual files next to your other
// documents, once you grant it a folder.
const SETTING_KEY = 'recordingsFolderHandle';

function isSupported() {
  return 'showDirectoryPicker' in window;
}

function slugify(title, createdAt) {
  const d = new Date(createdAt);
  const pad = (n) => String(n).padStart(2, '0');
  const datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
  const safeTitle = (title || 'Untitled meeting')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .trim()
    .slice(0, 60) || 'Untitled meeting';
  return `${datePart} - ${safeTitle}`;
}

async function pickFolder() {
  const handle = await window.showDirectoryPicker({ id: 'meeting-scribe-recordings', mode: 'readwrite' });
  await DB.setSetting(SETTING_KEY, handle);
  return handle;
}

async function disconnectFolder() {
  await DB.setSetting(SETTING_KEY, null);
}

async function getSavedHandle() {
  return DB.getSetting(SETTING_KEY);
}

// Checks (without prompting) whether we can currently write to the saved folder.
async function getStatus() {
  if (!isSupported()) return { connected: false, supported: false };
  const handle = await getSavedHandle();
  if (!handle) return { connected: false, supported: true };
  const permission = await handle.queryPermission({ mode: 'readwrite' });
  return { connected: permission === 'granted', supported: true, name: handle.name, permission };
}

// Must be called directly inside a click handler — re-requesting permission
// only works while the browser still considers the click a "user gesture".
async function reconnect() {
  const handle = await getSavedHandle();
  if (!handle) return false;
  const permission = await handle.requestPermission({ mode: 'readwrite' });
  return permission === 'granted';
}

async function writeFile(dirHandle, filename, contents) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(contents);
  await writable.close();
}

// Saves whatever files are provided into the given subfolder of the
// connected root folder. Silently no-ops (returns false) if no folder is
// connected or permission has lapsed — callers fall back to the in-browser
// copy plus the manual Download buttons either way.
async function saveMeetingFiles(folderName, files) {
  const handle = await getSavedHandle();
  if (!handle) return false;
  const permission = await handle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') return false;

  const dirHandle = await handle.getDirectoryHandle(folderName, { create: true });
  for (const file of files) {
    await writeFile(dirHandle, file.name, file.contents);
  }
  return true;
}

window.DiskSave = {
  isSupported,
  slugify,
  pickFolder,
  disconnectFolder,
  getStatus,
  reconnect,
  saveMeetingFiles,
};
