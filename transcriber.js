// Async transcription queue for audio items.
// Spawns transcribe.py (faster-whisper, fully local) one job at a time —
// whisper is CPU-heavy, so jobs are serialized rather than run concurrently.
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const db = require('./db');

const PYTHON = process.env.WHISPER_PYTHON
  || path.join(os.homedir(), '.local', 'whisper-env', 'bin', 'python');
const SCRIPT = path.join(__dirname, 'transcribe.py');
const uploadsDir = path.join(__dirname, 'uploads');

const queue = [];
let running = false;
let available = null; // lazily checked

function isAvailable() {
  if (available === null) {
    available = fs.existsSync(PYTHON);
    if (!available) {
      console.warn(`Transcription disabled: python not found at ${PYTHON} (set WHISPER_PYTHON to override)`);
    }
  }
  return available;
}

function enqueue(itemId, filename) {
  if (!isAvailable()) return;
  db.setTranscriptStatus(itemId, 'pending');
  queue.push({ itemId, filename });
  processNext();
}

function processNext() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;

  const filePath = path.join(uploadsDir, job.filename);
  const proc = spawn(PYTHON, [SCRIPT, filePath]);
  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', d => { stdout += d; });
  proc.stderr.on('data', d => { stderr += d; });

  proc.on('error', err => {
    console.error(`Transcription spawn error for ${job.itemId}:`, err.message);
    db.setTranscript(job.itemId, null, 'error');
    running = false;
    processNext();
  });

  proc.on('close', code => {
    try {
      if (code === 0) {
        const result = JSON.parse(stdout);
        db.setTranscript(job.itemId, result.text || '', 'done');
        console.log(`Transcribed ${job.itemId} [${result.language}]: ${(result.text || '').slice(0, 80)}`);
      } else {
        console.error(`Transcription failed for ${job.itemId} (exit ${code}):`, stderr.slice(-500));
        db.setTranscript(job.itemId, null, 'error');
      }
    } catch (err) {
      console.error(`Transcription result error for ${job.itemId}:`, err.message);
      db.setTranscript(job.itemId, null, 'error');
    }
    running = false;
    processNext();
  });
}

// On startup, re-queue audio items that were interrupted mid-transcription
// by a restart, so they don't sit in 'pending' forever.
function resumePending() {
  if (!isAvailable()) return;
  const items = db.getPendingTranscriptions();
  if (!items.length) return;
  console.log(`Queueing ${items.length} audio item(s) for transcription`);
  for (const item of items) {
    enqueue(item.id, item.filename);
  }
}

module.exports = { enqueue, resumePending };
