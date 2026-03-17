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

  let thumb = '';
  if (file.type.startsWith('image/')) {
    const url = URL.createObjectURL(file);
    thumb = `<img src="${url}" alt="" />`;
  } else if (file.type.startsWith('video/')) {
    const url = URL.createObjectURL(file);
    thumb = `<video src="${url}" muted></video>`;
  }

  preview.innerHTML = `
    ${thumb}
    <div class="file-info">
      <div class="file-name">${escapeHtml(file.name)}</div>
      <div class="file-size">${formatSize(file.size)}</div>
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
  bodyInput.focus();
});

// Check auth on load
function onAuthenticated() {
  bodyInput.focus();
}

apiFetch('/api/tags').then(() => {
  bodyInput.focus();
}).catch(() => {});
