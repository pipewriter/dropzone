// Capture page logic
const bodyInput = document.getElementById('body-input');
const fileInput = document.getElementById('file-input');
const dropzone = document.getElementById('dropzone');
const previewContainer = document.getElementById('file-preview-container');
const tagsInput = document.getElementById('tags-input');
const submitBtn = document.getElementById('submit-btn');
const clearBtn = document.getElementById('clear-btn');

let selectedFile = null;

// Drag & drop
dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', e => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files.length) {
    setFile(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) {
    setFile(fileInput.files[0]);
  }
});

// Paste support
document.addEventListener('paste', e => {
  if (e.target === bodyInput) {
    // Allow normal text paste in textarea
    if (!e.clipboardData.files.length) return;
  }
  if (e.clipboardData.files.length) {
    e.preventDefault();
    setFile(e.clipboardData.files[0]);
  }
});

function setFile(file) {
  selectedFile = file;
  showPreview(file);
}

function showPreview(file) {
  previewContainer.innerHTML = '';

  const preview = document.createElement('div');
  preview.className = 'file-preview';

  let mediaEl = '';
  if (file.type.startsWith('image/')) {
    const url = URL.createObjectURL(file);
    mediaEl = `<img src="${url}" alt="" />`;
  } else if (file.type.startsWith('video/')) {
    const url = URL.createObjectURL(file);
    mediaEl = `<video src="${url}" muted></video>`;
  } else if (file.type.startsWith('audio/')) {
    const url = URL.createObjectURL(file);
    mediaEl = `<audio src="${url}" controls></audio>`;
  }

  const isAudio = file.type.startsWith('audio/');
  preview.innerHTML = `
    ${isAudio ? '' : mediaEl}
    <div class="file-info">
      <div class="file-name">${escapeHtml(file.name)}</div>
      <div class="file-size">${formatSize(file.size)}</div>
      ${isAudio ? mediaEl : ''}
    </div>
    <button class="remove-file" title="Remove file">&times;</button>
  `;

  preview.querySelector('.remove-file').addEventListener('click', () => {
    selectedFile = null;
    previewContainer.innerHTML = '';
    fileInput.value = '';
  });

  previewContainer.appendChild(preview);
}

// --- Audio recording ---
const recordBtn = document.getElementById('record-btn');
const recordTimer = document.getElementById('record-timer');
const recordLabel = recordBtn.querySelector('.record-label');

let mediaRecorder = null;
let recordingChunks = [];
let recordingStart = null;
let timerInterval = null;

recordBtn.addEventListener('click', async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.addEventListener('dataavailable', e => {
      if (e.data.size > 0) recordingChunks.push(e.data);
    });

    mediaRecorder.addEventListener('stop', () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(timerInterval);
      recordTimer.textContent = '';
      recordBtn.classList.remove('recording');
      recordLabel.textContent = 'Record';

      const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType });
      const ext = mediaRecorder.mimeType.includes('webm') ? 'webm'
        : mediaRecorder.mimeType.includes('ogg') ? 'ogg'
        : mediaRecorder.mimeType.includes('mp4') ? 'm4a' : 'audio';
      const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: mediaRecorder.mimeType });
      setFile(file);
    });

    mediaRecorder.start();
    recordingStart = Date.now();
    recordBtn.classList.add('recording');
    recordLabel.textContent = 'Stop';
    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);
  } catch (err) {
    showToast('Microphone access denied');
  }
});

function updateTimer() {
  const elapsed = Math.floor((Date.now() - recordingStart) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  recordTimer.textContent = `${m}:${String(s).padStart(2, '0')}`;
}

// Submit
submitBtn.addEventListener('click', submit);

bodyInput.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    submit();
  }
});

async function submit() {
  const body = bodyInput.value.trim();
  const tags = tagsInput.value.trim();

  if (!body && !selectedFile) {
    showToast('Add some text or a file');
    return;
  }

  submitBtn.disabled = true;

  try {
    const formData = new FormData();
    if (body) formData.append('body', body);
    if (tags) formData.append('tags', tags);
    if (selectedFile) formData.append('file', selectedFile);

    await apiFetch('/api/items', {
      method: 'POST',
      body: formData,
    });

    // Reset form
    bodyInput.value = '';
    tagsInput.value = '';
    selectedFile = null;
    previewContainer.innerHTML = '';
    fileInput.value = '';

    showToast('Dropped!');
    bodyInput.focus();
  } catch (err) {
    if (err.message !== 'Unauthorized') {
      showToast('Error: ' + err.message);
    }
  } finally {
    submitBtn.disabled = false;
  }
}

// Clear
clearBtn.addEventListener('click', () => {
  bodyInput.value = '';
  tagsInput.value = '';
  selectedFile = null;
  previewContainer.innerHTML = '';
  fileInput.value = '';
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  bodyInput.focus();
});

// Check auth on load
function onAuthenticated() {
  bodyInput.focus();
}

apiFetch('/api/tags').then(() => {
  bodyInput.focus();
}).catch(() => {});
