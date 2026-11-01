// Local notes store backed by chrome.storage.local, mirroring the behavior
// of the Go server's store.go (same date-title numbering rules) so app.js
// can stay identical to the server version aside from its api() function.
const NotesStore = (() => {
  const KEY = 'notes';

  async function loadAll() {
    const data = await chrome.storage.local.get(KEY);
    return data[KEY] || {};
  }

  async function saveAll(notesById) {
    await chrome.storage.local.set({ [KEY]: notesById });
  }

  function dateBase(d = new Date()) {
    const yy = String(d.getFullYear() % 100).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}-${mm}${dd}`;
  }

  // Picks one past the highest date-title suffix already in use (not just a
  // count), so a freed-up slot from a renamed note can never collide with
  // one still in use. excludeId lets an in-progress update ignore its own
  // (about to be replaced) title.
  function nextDateTitle(notesById, excludeId) {
    const base = dateBase();
    let maxSlot = -1;
    for (const note of Object.values(notesById)) {
      if (note.id === excludeId) continue;
      if (note.title === base) {
        maxSlot = Math.max(maxSlot, 0);
        continue;
      }
      if (note.title.startsWith(base + '-')) {
        const n = Number(note.title.slice(base.length + 1));
        if (Number.isInteger(n)) maxSlot = Math.max(maxSlot, n);
      }
    }
    const next = maxSlot + 1;
    return next === 0 ? base : `${base}-${String(next).padStart(2, '0')}`;
  }

  async function list() {
    const notesById = await loadAll();
    return Object.values(notesById)
      .map(({ id, title, created_at, updated_at }) => ({ id, title, created_at, updated_at }))
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  }

  async function get(id) {
    const notesById = await loadAll();
    return notesById[id] || null;
  }

  async function create({ title, content }) {
    const notesById = await loadAll();
    const trimmed = (title || '').trim() || nextDateTitle(notesById, null);
    const now = new Date().toISOString();
    const note = { id: crypto.randomUUID(), title: trimmed, content: content || '', created_at: now, updated_at: now };
    notesById[note.id] = note;
    await saveAll(notesById);
    return note;
  }

  async function update(id, { title, content }) {
    const notesById = await loadAll();
    const existing = notesById[id];
    if (!existing) return null;
    const trimmed = (title || '').trim() || nextDateTitle(notesById, id);
    const updated = { ...existing, title: trimmed, content: content || '', updated_at: new Date().toISOString() };
    notesById[id] = updated;
    await saveAll(notesById);
    return updated;
  }

  async function remove(id) {
    const notesById = await loadAll();
    if (!notesById[id]) return false;
    delete notesById[id];
    await saveAll(notesById);
    return true;
  }

  return { list, get, create, update, remove };
})();
