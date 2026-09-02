(() => {
  const content = document.getElementById('content');
  const meetingListEl = document.getElementById('meeting-list');
  const folderStatusEl = document.getElementById('folder-status');

  const prefs = {
    get modelId() { return localStorage.getItem('modelId') || 'base.en'; },
    set modelId(v) { localStorage.setItem('modelId', v); },
    get micId() { return localStorage.getItem('micId') || ''; },
    set micId(v) { localStorage.setItem('micId', v); },
    get systemAudio() { return localStorage.getItem('systemAudio') !== 'false'; },
    set systemAudio(v) { localStorage.setItem('systemAudio', String(v)); },
  };

  let selectedMeetingId = null;

  // Recording state — only meaningful while actively recording.
  const rec = {
    active: false,
    meetingId: null,
    micStream: null,
    sysStream: null,
    audioCtx: null,
    dest: null,
    analyser: null,
    recorder: null,
    chunks: [],
    startedAt: null,
    timerHandle: null,
    levelRAF: null,
  };

  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
  }

  function fmtTimestamp(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function fmtWhen(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' +
      d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // MediaRecorder writes WebM files with no duration metadata at all, which
  // is why the <audio> seek bar only ever lets you scrub the first few
  // seconds it can quickly estimate — the player has no idea how long the
  // file actually is. This patches the correct duration into the file.
  async function fixRecordingDuration(blob, durationMs) {
    try {
      const fixWebmDuration = (await import('https://cdn.jsdelivr.net/npm/fix-webm-duration@1/+esm')).default;
      return await fixWebmDuration(blob, durationMs, { logger: false });
    } catch {
      return blob; // Seeking may be limited, but the recording itself is unaffected.
    }
  }

  // Recordings made before the duration fix (or if it silently failed) are
  // patched retroactively here, using the wall-clock duration we already
  // recorded separately — that value was never affected by the broken file
  // metadata, so no guessing is needed.
  async function getSeekableAudioUrl(meeting) {
    let blob = await DB.getAudioBlob(meeting.id);
    if (!blob) return null;
    if (!meeting.durationFixed) {
      blob = await fixRecordingDuration(blob, (meeting.durationSec || 0) * 1000);
      await DB.saveAudioBlob(meeting.id, blob);
      await DB.updateMeeting(meeting.id, { durationFixed: true });
    }
    return URL.createObjectURL(blob);
  }

  // ---------------------------------------------------------------------
  // Sidebar
  // ---------------------------------------------------------------------

  async function refreshSidebar() {
    const meetings = await DB.listMeetings();
    meetingListEl.innerHTML = '';
    for (const m of meetings) {
      const item = document.createElement('div');
      item.className = 'meeting-item' + (m.id === selectedMeetingId ? ' active' : '');
      item.innerHTML = `
        <div class="title">${escapeHtml(m.title)}</div>
        <div class="meta">
          <span class="status-dot ${m.status}"></span>
          <span>${fmtWhen(m.createdAt)}</span>
          ${m.durationSec ? `<span>· ${fmtDuration(m.durationSec)}</span>` : ''}
        </div>`;
      item.addEventListener('click', () => selectMeeting(m.id));
      meetingListEl.appendChild(item);
    }
  }

  async function selectMeeting(id) {
    if (rec.active) return; // don't navigate away mid-recording
    selectedMeetingId = id;
    await refreshSidebar();
    const meeting = await DB.getMeeting(id);
    renderMeetingPanel(meeting);
  }

  // ---------------------------------------------------------------------
  // Disk save (File System Access API) — optional, auto-saves real files
  // ---------------------------------------------------------------------

  async function refreshFolderStatus() {
    const status = await DiskSave.getStatus();

    if (!status.supported) {
      folderStatusEl.innerHTML = `<p class="folder-sub">Auto-save to disk isn't supported in this browser — use the Download buttons on each meeting instead.</p>`;
      return;
    }

    if (!status.name) {
      folderStatusEl.innerHTML = `
        <div class="folder-line">📁 Not saving to disk</div>
        <p class="folder-sub">Meetings currently only live in this browser. Connect a folder to have recordings and transcripts saved as real files automatically.</p>
        <div class="folder-actions"><button id="connect-folder-btn" class="link-btn">Choose folder…</button></div>`;
      document.getElementById('connect-folder-btn').addEventListener('click', async () => {
        try {
          await DiskSave.pickFolder();
        } catch {
          /* user cancelled the picker */
        }
        refreshFolderStatus();
      });
      return;
    }

    if (status.connected) {
      folderStatusEl.innerHTML = `
        <div class="folder-line">📁 Saving to: <b>${escapeHtml(status.name)}</b></div>
        <p class="folder-sub">Each meeting gets its own subfolder there with the recording and transcript.</p>
        <div class="folder-actions"><button id="disconnect-folder-btn" class="link-btn muted">Disconnect</button></div>`;
      document.getElementById('disconnect-folder-btn').addEventListener('click', async () => {
        await DiskSave.disconnectFolder();
        refreshFolderStatus();
      });
      return;
    }

    folderStatusEl.innerHTML = `
      <div class="folder-line">📁 ${escapeHtml(status.name)} (access needed)</div>
      <p class="folder-sub">The browser needs you to re-approve access to this folder.</p>
      <div class="folder-actions">
        <button id="reconnect-folder-btn" class="link-btn">Reconnect</button>
        <button id="disconnect-folder-btn" class="link-btn muted">Disconnect</button>
      </div>`;
    document.getElementById('reconnect-folder-btn').addEventListener('click', async () => {
      await DiskSave.reconnect().catch(() => false);
      refreshFolderStatus();
    });
    document.getElementById('disconnect-folder-btn').addEventListener('click', async () => {
      await DiskSave.disconnectFolder();
      refreshFolderStatus();
    });
  }

  // ---------------------------------------------------------------------
  // New recording setup panel
  // ---------------------------------------------------------------------

  async function renderSetupPanel() {
    selectedMeetingId = null;
    await refreshSidebar();

    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const mics = devices.filter((d) => d.kind === 'audioinput');

    content.innerHTML = `
      <div class="panel">
        <h1 class="title-field" style="border:none">New recording</h1>
        <p class="subtle">Records your microphone and, optionally, system audio — so both sides of the call get captured. Everything stays on this machine.</p>
        <div class="card">
          <div class="field">
            <label>Meeting title</label>
            <input type="text" id="setup-title" placeholder="e.g. Weekly sync" />
          </div>
          <div class="field">
            <label>Microphone</label>
            <select id="setup-mic">
              ${mics.map((d, i) => `<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.label || `Microphone ${i + 1}`)}</option>`).join('')}
            </select>
          </div>
          <div class="field checkbox-row">
            <input type="checkbox" id="setup-system-audio" ${prefs.systemAudio ? 'checked' : ''} />
            <label style="margin:0;text-transform:none;font-weight:500;color:var(--text)" for="setup-system-audio">Also capture system audio (other participants' voices)</label>
          </div>
          <p class="hint" id="system-audio-hint">${prefs.systemAudio ? "When the screen-share picker opens, choose <b>Entire Screen</b> and check <b>Share system audio</b>." : ''}</p>
          <button id="setup-start-btn" class="btn btn-primary btn-block" style="margin-top:14px">Start Recording</button>
        </div>
      </div>`;

    const micSelect = document.getElementById('setup-mic');
    if (prefs.micId && [...micSelect.options].some((o) => o.value === prefs.micId)) {
      micSelect.value = prefs.micId;
    }

    const sysCheckbox = document.getElementById('setup-system-audio');
    sysCheckbox.addEventListener('change', () => {
      document.getElementById('system-audio-hint').innerHTML = sysCheckbox.checked
        ? "When the screen-share picker opens, choose <b>Entire Screen</b> and check <b>Share system audio</b>."
        : '';
    });

    document.getElementById('setup-start-btn').addEventListener('click', async () => {
      const title = document.getElementById('setup-title').value;
      prefs.micId = micSelect.value;
      prefs.systemAudio = sysCheckbox.checked;
      try {
        await startRecording(title, micSelect.value, prefs.systemAudio);
      } catch (err) {
        alert(`Couldn't start recording: ${err.message || err}`);
      }
    });
  }

  // ---------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------

  async function startRecording(title, micDeviceId, includeSystemAudio) {
    rec.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: micDeviceId ? { exact: micDeviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    rec.sysStream = null;
    if (includeSystemAudio) {
      try {
        rec.sysStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        rec.sysStream.getVideoTracks().forEach((t) => t.stop());
        if (rec.sysStream.getAudioTracks().length === 0) {
          rec.sysStream = null; // user picked a source without "share audio" checked
        }
      } catch {
        rec.sysStream = null; // user cancelled the picker — fall back to mic-only
      }
    }

    rec.audioCtx = new AudioContext();
    rec.dest = rec.audioCtx.createMediaStreamDestination();
    const micSource = rec.audioCtx.createMediaStreamSource(rec.micStream);
    micSource.connect(rec.dest);
    if (rec.sysStream) {
      rec.audioCtx.createMediaStreamSource(rec.sysStream).connect(rec.dest);
    }

    rec.analyser = rec.audioCtx.createAnalyser();
    rec.analyser.fftSize = 256;
    micSource.connect(rec.analyser);

    const meetingId = `meeting-${Date.now()}`;
    await DB.addMeeting({
      id: meetingId,
      title: title?.trim() || 'Untitled meeting',
      createdAt: Date.now(),
      status: 'recording',
      durationSec: 0,
      systemAudioCaptured: Boolean(rec.sysStream),
    });
    rec.meetingId = meetingId;
    rec.chunks = [];

    rec.recorder = new MediaRecorder(rec.dest.stream, { mimeType: 'audio/webm;codecs=opus' });
    rec.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) rec.chunks.push(e.data);
    };
    rec.recorder.start(1000);

    rec.active = true;
    rec.startedAt = Date.now();
    renderRecordingPanel(Boolean(rec.sysStream), includeSystemAudio);
    await refreshSidebar();

    rec.timerHandle = setInterval(updateTimerDisplay, 500);
    tickLevelMeter();
  }

  function updateTimerDisplay() {
    const el = document.getElementById('rec-timer');
    if (el) el.textContent = fmtDuration((Date.now() - rec.startedAt) / 1000);
  }

  function tickLevelMeter() {
    const bars = document.querySelectorAll('.level-bar');
    if (!bars.length || !rec.analyser) return;
    const data = new Uint8Array(rec.analyser.frequencyBinCount);
    rec.analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    bars.forEach((bar, i) => {
      const wobble = Math.sin(Date.now() / 120 + i) * 6;
      const h = Math.max(4, Math.min(32, (avg / 255) * 32 + wobble * (avg > 10 ? 1 : 0)));
      bar.style.height = `${h}px`;
    });
    rec.levelRAF = requestAnimationFrame(tickLevelMeter);
  }

  function renderRecordingPanel(gotSystemAudio, wantedSystemAudio) {
    content.innerHTML = `
      <div class="panel">
        <h1 class="title-field" style="border:none">Recording…</h1>
        ${wantedSystemAudio && !gotSystemAudio
          ? '<p class="hint" style="color:var(--danger);margin-bottom:16px">System audio wasn\'t captured (picker was cancelled, or "Share audio" wasn\'t checked) — recording microphone only.</p>'
          : ''}
        <div class="card">
          <div class="recording-indicator">
            <span class="rec-dot"></span>
            <span id="rec-timer" class="timer">00:00</span>
          </div>
          <div class="level-meter">
            ${Array.from({ length: 24 }).map(() => '<div class="level-bar"></div>').join('')}
          </div>
          <button id="stop-btn" class="btn btn-danger btn-block">Stop Recording</button>
        </div>
      </div>`;
    document.getElementById('stop-btn').addEventListener('click', stopRecording);
  }

  async function stopRecording() {
    const stopBtn = document.getElementById('stop-btn');
    if (stopBtn) { stopBtn.disabled = true; stopBtn.textContent = 'Stopping…'; }

    const stopped = new Promise((resolve) => { rec.recorder.onstop = resolve; });
    rec.recorder.stop();
    await stopped;

    const durationSec = (Date.now() - rec.startedAt) / 1000;
    const rawBlob = new Blob(rec.chunks, { type: 'audio/webm' });
    const blob = await fixRecordingDuration(rawBlob, durationSec * 1000);

    rec.micStream.getTracks().forEach((t) => t.stop());
    rec.sysStream?.getTracks().forEach((t) => t.stop());
    await rec.audioCtx.close();
    clearInterval(rec.timerHandle);
    cancelAnimationFrame(rec.levelRAF);

    const meetingId = rec.meetingId;
    rec.active = false;
    rec.meetingId = null;
    rec.chunks = [];

    await DB.saveAudioBlob(meetingId, blob);
    let updated = await DB.updateMeeting(meetingId, { status: 'recorded', durationSec, sizeBytes: blob.size });

    // Auto-save to disk if a folder is connected. The subfolder name is
    // fixed at this point so later renames don't split files across folders.
    const diskFolderName = DiskSave.slugify(updated.title, updated.createdAt);
    const savedToDisk = await DiskSave.saveMeetingFiles(diskFolderName, [
      { name: 'audio.webm', contents: blob },
    ]).catch(() => false);
    if (savedToDisk) {
      updated = await DB.updateMeeting(meetingId, { diskFolderName, savedToDisk: true });
    }

    await selectMeeting(meetingId);
  }

  // ---------------------------------------------------------------------
  // Meeting panel (recorded / transcribing / done / error)
  // ---------------------------------------------------------------------

  function renderMeetingPanel(meeting) {
    if (!meeting) { renderSetupPanel(); return; }
    if (meeting.status === 'done') renderTranscript(meeting);
    else if (meeting.status === 'transcribing') renderTranscribingPlaceholder(meeting);
    else renderReadyToTranscribe(meeting);
  }

  function renderTranscribingPlaceholder(meeting) {
    // Reached only if the user navigates back to this meeting while a
    // transcription started from this same tab is still running. (Any
    // "transcribing" meeting found when the app first loads gets swept to
    // "error" automatically — see resetStuckTranscriptions — since closing
    // or reloading the tab always kills the in-progress work.)
    content.innerHTML = `
      <div class="panel">
        ${titleHeader(meeting)}
        <div class="card">
          <div class="spinner"></div>
          <p class="progress-label">Transcription in progress — this will update automatically when it finishes.</p>
        </div>
        <div class="btn-row">
          <button id="cancel-btn" class="btn btn-secondary">Cancel</button>
        </div>
      </div>`;
    wireTitleInput(meeting);
    document.getElementById('cancel-btn').addEventListener('click', async () => {
      await DB.updateMeeting(meeting.id, { status: 'recorded' });
      selectMeeting(meeting.id);
    });
  }

  // Any meeting still marked "transcribing" when the app starts was
  // interrupted by a tab close, reload, or crash — actual transcription
  // can't survive that, so the status would otherwise be stuck forever
  // with no way to retry it.
  async function resetStuckTranscriptions() {
    const meetings = await DB.listMeetings();
    for (const m of meetings) {
      if (m.status === 'transcribing') {
        await DB.updateMeeting(m.id, { status: 'error', error: 'Interrupted — the browser tab was closed or reloaded while transcribing. Try again.' });
      }
    }
  }

  function titleHeader(meeting) {
    return `
      <input type="text" id="title-input" class="title-field" value="${escapeHtml(meeting.title)}" />
      <p class="subtle">${fmtWhen(meeting.createdAt)} · ${fmtDuration(meeting.durationSec || 0)}${meeting.systemAudioCaptured === false ? ' · mic only' : ''}${meeting.savedToDisk ? ` · saved to disk (${escapeHtml(meeting.diskFolderName)})` : ''}</p>`;
  }

  function wireTitleInput(meeting) {
    const input = document.getElementById('title-input');
    input.addEventListener('change', async () => {
      await DB.updateMeeting(meeting.id, { title: input.value.trim() || 'Untitled meeting' });
      await refreshSidebar();
    });
  }

  function wireDeleteButton(meeting) {
    document.getElementById('delete-btn').addEventListener('click', async () => {
      if (!confirm('Delete this meeting and its recording? This cannot be undone.')) return;
      await DB.deleteMeeting(meeting.id);
      renderSetupPanel();
    });
  }

  async function renderReadyToTranscribe(meeting) {
    const models = ASR.listModels();
    const audioUrl = await getSeekableAudioUrl(meeting);

    content.innerHTML = `
      <div class="panel">
        ${titleHeader(meeting)}
        ${meeting.status === 'error' ? `<div class="error-box">Transcription failed: ${escapeHtml(meeting.error || 'unknown error')}</div>` : ''}
        ${audioUrl ? `<audio class="player" controls src="${audioUrl}"></audio>` : ''}
        <div class="card">
          <div class="field">
            <label>Transcription quality</label>
            <select id="model-select">
              ${models.map((m) => `<option value="${m.id}" ${m.id === prefs.modelId ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
            </select>
            <p class="hint">Runs fully in this browser tab — nothing is uploaded. The model downloads once (a couple hundred MB) and is cached for every future meeting.</p>
          </div>
          <button id="transcribe-btn" class="btn btn-primary btn-block">Transcribe</button>
        </div>
        <div class="btn-row">
          <button id="download-audio-btn" class="btn btn-secondary">Download recording</button>
          <button id="delete-btn" class="btn btn-danger">Delete meeting</button>
        </div>
      </div>`;

    wireTitleInput(meeting);
    wireDeleteButton(meeting);

    document.getElementById('download-audio-btn').addEventListener('click', async () => {
      const blob = await DB.getAudioBlob(meeting.id);
      if (blob) downloadBlob(blob, `${meeting.title}.webm`);
    });

    document.getElementById('transcribe-btn').addEventListener('click', () => {
      prefs.modelId = document.getElementById('model-select').value;
      runTranscription(meeting.id, prefs.modelId);
    });
  }

  async function runTranscription(meetingId, modelId) {
    await DB.updateMeeting(meetingId, { status: 'transcribing' });

    content.innerHTML = `
      <div class="panel">
        <h1 class="title-field" style="border:none">Transcribing…</h1>
        <div class="card">
          <div class="spinner"></div>
          <div id="progress-area"><p class="progress-label">Preparing…</p></div>
        </div>
      </div>`;

    const progressArea = document.getElementById('progress-area');
    const filesSeen = new Map();

    function renderProgress() {
      const rows = [...filesSeen.values()].map((f) => {
        const pct = f.total ? Math.round((f.loaded / f.total) * 100) : (f.done ? 100 : 0);
        return `<p class="progress-label">${escapeHtml(f.name)} — ${pct}%</p>
          <div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div>`;
      });
      progressArea.innerHTML = rows.length ? rows.join('') : '<p class="progress-label">Transcribing your meeting…</p>';
    }

    const onModelProgress = (p) => {
      if (!p || !p.file) {
        progressArea.innerHTML = '<p class="progress-label">Transcribing your meeting…</p>';
        return;
      }
      filesSeen.set(p.file, {
        name: p.file,
        loaded: p.loaded,
        total: p.total,
        done: p.status === 'done',
      });
      renderProgress();
    };

    try {
      const audioBlob = await DB.getAudioBlob(meetingId);
      const transcript = await ASR.transcribeBlob(audioBlob, modelId, { onModelProgress });
      await DB.saveTranscript(meetingId, transcript);
      const updated = await DB.updateMeeting(meetingId, { status: 'done' });

      if (updated.diskFolderName) {
        await DiskSave.saveMeetingFiles(updated.diskFolderName, [
          { name: 'transcript.txt', contents: transcript.fullText },
          { name: 'transcript.json', contents: JSON.stringify(transcript, null, 2) },
        ]).catch(() => false);
      }

      await refreshSidebar();
      if (selectedMeetingId === meetingId) {
        renderTranscript(await DB.getMeeting(meetingId));
      }
    } catch (err) {
      await DB.updateMeeting(meetingId, { status: 'error', error: String(err?.message || err) });
      await refreshSidebar();
      if (selectedMeetingId === meetingId) {
        renderMeetingPanel(await DB.getMeeting(meetingId));
      }
    }
  }

  async function renderTranscript(meeting) {
    const transcript = await DB.getTranscript(meeting.id);
    const segments = transcript?.segments || [];
    const audioUrl = await getSeekableAudioUrl(meeting);

    content.innerHTML = `
      <div class="panel">
        ${titleHeader(meeting)}
        ${audioUrl ? `<audio class="player" controls src="${audioUrl}"></audio>` : ''}
        <div class="card transcript">
          ${segments.length
            ? segments.map((s) => `<div class="segment"><div class="ts">${fmtTimestamp(s.start)}</div><div class="text">${escapeHtml(s.text)}</div></div>`).join('')
            : '<p class="subtle">No speech was detected in this recording.</p>'}
        </div>
        <div class="btn-row">
          <button id="copy-btn" class="btn btn-secondary">Copy transcript</button>
          <button id="download-transcript-btn" class="btn btn-secondary">Download transcript</button>
          <button id="download-audio-btn" class="btn btn-secondary">Download recording</button>
          <button id="delete-btn" class="btn btn-danger">Delete meeting</button>
        </div>
      </div>`;

    wireTitleInput(meeting);
    wireDeleteButton(meeting);

    document.getElementById('copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(transcript?.fullText || '');
    });
    document.getElementById('download-transcript-btn').addEventListener('click', () => {
      downloadBlob(new Blob([transcript?.fullText || ''], { type: 'text/plain' }), `${meeting.title}.txt`);
    });
    document.getElementById('download-audio-btn').addEventListener('click', async () => {
      const blob = await DB.getAudioBlob(meeting.id);
      if (blob) downloadBlob(blob, `${meeting.title}.webm`);
    });
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  document.getElementById('new-meeting-btn').addEventListener('click', renderSetupPanel);

  resetStuckTranscriptions().then(renderSetupPanel);
  refreshFolderStatus();
})();
