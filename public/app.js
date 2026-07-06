// Shared utilities, auth flow, item rendering

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: 'same-origin',
  });

  if (res.status === 401) {
    showLogin();
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// Auth / Login overlay
function showLogin() {
  if (document.querySelector('.login-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'login-overlay';
  overlay.innerHTML = `
    <div class="login-box">
      <h2>Dropzone</h2>
      <input type="password" id="login-token" placeholder="Enter token" autocomplete="off" />
      <div class="login-error" id="login-error">Invalid token</div>
      <button class="primary" id="login-btn">Login</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#login-token');
  const btn = overlay.querySelector('#login-btn');
  const error = overlay.querySelector('#login-error');

  input.focus();

  async function doLogin() {
    btn.disabled = true;
    error.style.display = 'none';
    try {
      await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: input.value }),
      }).then(r => {
        if (!r.ok) throw new Error('Invalid token');
        return r.json();
      });
      overlay.remove();
      if (typeof onAuthenticated === 'function') onAuthenticated();
    } catch {
      error.style.display = 'block';
      btn.disabled = false;
      input.focus();
    }
  }

  btn.addEventListener('click', doLogin);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
}

// Item rendering
function renderItem(item) {
  const card = document.createElement('div');
  card.className = 'item-card';
  card.dataset.id = item.id;

  let mediaHtml = '';
  if (item.filename) {
    const fileUrl = `/api/files/${item.id}/${item.filename}`;
    if (item.type === 'image') {
      mediaHtml = `<div class="item-media"><img src="${fileUrl}" alt="" loading="lazy" /></div>`;
    } else if (item.type === 'video') {
      mediaHtml = `<div class="item-media"><video src="${fileUrl}" controls preload="metadata"></video></div>`;
    } else if (item.type === 'audio') {
      mediaHtml = `<div class="item-media"><audio src="${fileUrl}" controls preload="metadata"></audio></div>`;
    } else {
      mediaHtml = `<a class="item-file-link" href="${fileUrl}" target="_blank">${escapeHtml(item.filename)} (${formatSize(item.file_size)})</a>`;
    }
  }

  let transcriptHtml = '';
  if (item.type === 'audio') {
    if (item.transcript_status === 'pending') {
      transcriptHtml = `<div class="item-transcript pending">Transcribing&hellip;</div>`;
    } else if (item.transcript_status === 'done' && item.transcript) {
      transcriptHtml = `<div class="item-transcript">${escapeHtml(item.transcript)}</div>`;
    } else if (item.transcript_status === 'error') {
      transcriptHtml = `<div class="item-transcript error">Transcription failed</div>`;
    }
  }

  const bodyHtml = item.body ? `<div class="item-body">${escapeHtml(item.body)}</div>` : '';

  const tagSpans = (item.tags || []).map(t =>
    `<span class="tag-with-remove" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}<button class="remove-tag-btn" data-id="${item.id}" data-tag="${escapeHtml(t)}" title="Remove tag">&times;</button></span>`
  ).join('');
  const tagsHtml = `<div class="item-tags">${tagSpans}<button class="add-tags-btn" data-id="${item.id}">+ tag</button></div>`;

  card.innerHTML = `
    ${mediaHtml}
    ${transcriptHtml}
    ${bodyHtml}
    <div class="item-meta">
      <div>
        ${tagsHtml}
        <span class="item-time">${timeAgo(item.created_at)}</span>
      </div>
      <button class="danger delete-btn" data-id="${item.id}" title="Delete">&#x2715;</button>
    </div>
  `;

  if (item.type === 'audio' && item.transcript_status === 'pending') {
    pollTranscript(card, item.id);
  }

  return card;
}

// Poll a pending transcription and swap in the finished card
function pollTranscript(card, id) {
  setTimeout(async () => {
    if (!card.isConnected) return; // card was removed or replaced
    try {
      const item = await apiFetch(`/api/items/${id}`);
      if (item.transcript_status === 'pending') return pollTranscript(card, id);
      card.replaceWith(renderItem(item));
    } catch (err) {
      if (err.message !== 'Unauthorized') pollTranscript(card, id);
    }
  }, 3000);
}

// Utilities
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function timeAgo(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr + 'Z').getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return new Date(dateStr).toLocaleDateString();
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}
