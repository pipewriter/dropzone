// Feed page: infinite scroll, tag filtering, delete
const feedItems = document.getElementById('feed-items');
const loadingEl = document.getElementById('loading');
const emptyState = document.getElementById('empty-state');
const tagFilters = document.getElementById('tag-filters');
const feedTitle = document.getElementById('feed-title');

let cursor = null;
let loading = false;
let hasMore = true;

// Read initial tag from URL like /feed/facebook
const pathTag = window.location.pathname.match(/^\/feed\/(.+)/);
let activeTag = pathTag ? decodeURIComponent(pathTag[1]) : null;

// Load tags
async function loadTags() {
  try {
    const tags = await apiFetch('/api/tags');
    tagFilters.innerHTML = '';

    if (tags.length === 0) return;

    const allPill = document.createElement('button');
    allPill.className = 'tag-pill' + (activeTag === null ? ' active' : '');
    allPill.textContent = 'All';
    allPill.addEventListener('click', () => {
      activeTag = null;
      feedTitle.textContent = 'All drops';
      history.pushState(null, '', '/feed');
      resetAndLoad();
    });
    tagFilters.appendChild(allPill);

    for (const { tag, count } of tags) {
      const pill = document.createElement('button');
      pill.className = 'tag-pill' + (activeTag === tag ? ' active' : '');
      pill.innerHTML = `#${escapeHtml(tag)} <span class="count">${count}</span>`;
      pill.addEventListener('click', () => {
        activeTag = tag;
        feedTitle.textContent = `#${tag}`;
        history.pushState(null, '', '/feed/' + encodeURIComponent(tag));
        resetAndLoad();
      });
      tagFilters.appendChild(pill);
    }
  } catch (err) {
    if (err.message !== 'Unauthorized') console.error('Failed to load tags:', err);
  }
}

// Load items
async function loadItems() {
  if (loading || !hasMore) return;
  loading = true;
  loadingEl.style.display = 'block';

  try {
    let url = `/api/items?limit=20`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    if (activeTag) url += `&tag=${encodeURIComponent(activeTag)}`;

    const data = await apiFetch(url);

    if (data.items.length === 0 && !cursor) {
      emptyState.style.display = 'block';
    }

    for (const item of data.items) {
      const card = renderItem(item);
      feedItems.appendChild(card);
    }

    cursor = data.nextCursor;
    hasMore = !!data.nextCursor;
  } catch (err) {
    if (err.message !== 'Unauthorized') {
      showToast('Error loading items');
    }
  } finally {
    loading = false;
    loadingEl.style.display = 'none';
  }
}

function resetAndLoad() {
  cursor = null;
  hasMore = true;
  feedItems.innerHTML = '';
  emptyState.style.display = 'none';
  loadTags();
  loadItems();
}

// Infinite scroll
window.addEventListener('scroll', () => {
  if (loading || !hasMore) return;
  const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 200;
  if (nearBottom) loadItems();
});

// Delete items (event delegation)
feedItems.addEventListener('click', async e => {
  const btn = e.target.closest('.delete-btn');
  if (!btn) return;

  const id = btn.dataset.id;
  if (!confirm('Delete this drop?')) return;

  try {
    await apiFetch(`/api/items/${id}`, { method: 'DELETE' });
    const card = btn.closest('.item-card');
    card.remove();
    showToast('Deleted');
    loadTags(); // refresh counts
  } catch (err) {
    if (err.message !== 'Unauthorized') {
      showToast('Error deleting item');
    }
  }
});

// Remove a single tag (with confirmation)
feedItems.addEventListener('click', async e => {
  const btn = e.target.closest('.remove-tag-btn');
  if (!btn) return;
  e.stopPropagation();

  const card = btn.closest('.item-card');
  const id = btn.dataset.id;
  const tagToRemove = btn.dataset.tag;

  if (!confirm(`Remove tag "#${tagToRemove}"?`)) return;

  const currentTags = Array.from(card.querySelectorAll('.tag-with-remove'))
    .map(el => el.dataset.tag);
  const newTags = currentTags.filter(t => t !== tagToRemove);

  try {
    const updated = await apiFetch(`/api/items/${id}/tags`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: newTags }),
    });
    const newCard = renderItem(updated);
    card.replaceWith(newCard);
    showToast(`Removed #${tagToRemove}`);
    loadTags();
  } catch (err) {
    if (err.message !== 'Unauthorized') showToast('Error removing tag');
  }
});

// Add tags (keeps existing ones)
feedItems.addEventListener('click', async e => {
  const btn = e.target.closest('.add-tags-btn');
  if (!btn) return;

  const card = btn.closest('.item-card');
  const id = card.dataset.id;

  if (card.querySelector('.item-tag-editor')) return;

  const editor = document.createElement('div');
  editor.className = 'item-tag-editor';
  editor.innerHTML = `
    <input type="text" placeholder="add tags (comma-separated)" />
    <button class="primary">Add</button>
    <button>Cancel</button>
  `;

  const meta = card.querySelector('.item-meta');
  meta.after(editor);

  const input = editor.querySelector('input');
  const saveBtn = editor.querySelectorAll('button')[0];
  const cancelBtn = editor.querySelectorAll('button')[1];

  input.focus();

  async function addTags() {
    const newTags = input.value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    if (!newTags.length) return;

    const currentTags = Array.from(card.querySelectorAll('.tag-with-remove'))
      .map(el => el.dataset.tag);
    // Merge without duplicates
    const merged = [...new Set([...currentTags, ...newTags])];

    try {
      const updated = await apiFetch(`/api/items/${id}/tags`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: merged }),
      });
      const newCard = renderItem(updated);
      card.replaceWith(newCard);
      showToast('Tags added');
      loadTags();
    } catch (err) {
      if (err.message !== 'Unauthorized') showToast('Error adding tags');
    }
  }

  saveBtn.addEventListener('click', addTags);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') addTags();
    if (e.key === 'Escape') editor.remove();
  });
  cancelBtn.addEventListener('click', () => editor.remove());
});

// Init
function onAuthenticated() {
  resetAndLoad();
}

if (activeTag) {
  feedTitle.textContent = `#${activeTag}`;
}

window.addEventListener('popstate', () => {
  const m = window.location.pathname.match(/^\/feed\/(.+)/);
  activeTag = m ? decodeURIComponent(m[1]) : null;
  feedTitle.textContent = activeTag ? `#${activeTag}` : 'All drops';
  resetAndLoad();
});

loadTags();
loadItems();
