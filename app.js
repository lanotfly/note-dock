const state = {
  notes: [],
  currentId: null,
};

const noteListEl = document.getElementById('noteList');
const emptyStateEl = document.getElementById('emptyState');
const editorContainerEl = document.getElementById('editorContainer');
const titleInputEl = document.getElementById('titleInput');
const contentEditableEl = document.getElementById('contentEditable');
const saveStatusEl = document.getElementById('saveStatus');
const sidebarEl = document.getElementById('sidebar');
const sidebarResizerEl = document.getElementById('sidebarResizer');
const styleSelect = document.getElementById('styleSelect');
const listSelect = document.getElementById('listSelect');
const editorBodyEl = document.getElementById('editorBody');
const foldGutterEl = document.getElementById('foldGutter');

// Whether this page is the full-page tab (?mode=tab) or the side panel.
// Computed up front since both the layout CSS (bottom note list in the
// panel vs. left sidebar in the tab) and the resize/collapse logic below
// branch on it.
const isFullPageTab = new URLSearchParams(window.location.search).get('mode') === 'tab';
document.body.classList.toggle('tab-mode', isFullPageTab);

// Tells background.js "the side panel is open in this window" by writing
// a timestamp to storage every ~1.5s while this page is visible (cleared
// as soon as it's hidden or torn down, and going stale within seconds
// even if that cleanup never runs, e.g. the panel is destroyed outright).
// Only the manual-toggle mode for Vivaldi's toolbar icon reads it (see
// background.js), but writing it is cheap and harmless everywhere else.
// Not a runtime.connect port: an idle port doesn't keep the MV3 service
// worker alive, so the state it carried was lost whenever the worker was
// killed; storage writes also wake and refresh the worker via onChanged.
if (
  !isFullPageTab &&
  chrome.windows && typeof chrome.windows.getCurrent === 'function' &&
  chrome.storage
) {
  (async () => {
    let win;
    try {
      win = await chrome.windows.getCurrent();
    } catch {
      return; // best-effort: without it only the toolbar-icon toggle-closed is lost
    }
    const key = `panelOpen:${win.id}`;
    let area = chrome.storage.session || chrome.storage.local;
    let closing = false;
    const beat = () => {
      if (closing || document.visibilityState !== 'visible') return;
      area.set({ [key]: Date.now() }).catch(() => {
        if (area !== chrome.storage.local) area = chrome.storage.local; // session area not writable from here
      });
    };
    const clear = () => area.remove(key).catch(() => {});
    beat();
    setInterval(beat, 1000);
    document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? beat() : clear()));
    window.addEventListener('pagehide', clear);

    // The toolbar icon's "close" request (see background.js). Vivaldi
    // ignores sidePanel.close() and setOptions({enabled:false}) for an
    // already-open panel, but does close it when the panel page itself
    // calls window.close(). The heartbeat is cleared first (and beating
    // stopped) because window.close() tears the page down before any
    // pagehide cleanup can run, which would otherwise leave the panel
    // looking "open" for a few more seconds — long enough for the very
    // next click to be mistaken for another close.
    if (chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (!msg || msg.type !== 'closeSidePanel' || msg.windowId !== win.id) return;
        closing = true;
        clear().finally(() => window.close());
      });
    }
  })();
}

// Routes the same fetch()-shaped calls the server version of this app makes
// to the local NotesStore (chrome.storage.local) instead, so every other
// function below is byte-for-byte identical to web/app.js.
async function api(path, opts) {
  const method = (opts && opts.method) || 'GET';
  const body = opts && opts.body ? JSON.parse(opts.body) : null;

  if (path === '/api/notes' && method === 'GET') return NotesStore.list();
  if (path === '/api/notes' && method === 'POST') return NotesStore.create(body);

  const match = path.match(/^\/api\/notes\/([^/]+)$/);
  if (match) {
    const id = match[1];
    if (method === 'GET') {
      const note = await NotesStore.get(id);
      if (!note) throw new Error('note not found');
      return note;
    }
    if (method === 'PUT') {
      const note = await NotesStore.update(id, body);
      if (!note) throw new Error('note not found');
      return note;
    }
    if (method === 'DELETE') {
      const ok = await NotesStore.remove(id);
      if (!ok) throw new Error('note not found');
      return null;
    }
  }
  throw new Error(`unknown request: ${method} ${path}`);
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function setSaveStatus(text) {
  saveStatusEl.textContent = text;
}

function renderList() {
  noteListEl.innerHTML = '';
  for (const note of state.notes) {
    const li = document.createElement('li');
    li.className = 'note-item' + (note.id === state.currentId ? ' active' : '');
    li.dataset.id = String(note.id);

    const title = document.createElement('span');
    title.className = 'note-title';
    title.textContent = note.title || 'Untitled note';

    const time = document.createElement('span');
    time.className = 'note-time';
    time.textContent = formatTime(note.updated_at);

    const del = document.createElement('button');
    del.className = 'note-delete';
    del.textContent = '✕';
    del.title = 'Delete note';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNote(note.id);
    });

    li.appendChild(title);
    li.appendChild(time);
    li.appendChild(del);
    li.addEventListener('click', () => selectNote(note.id));
    noteListEl.appendChild(li);
  }
}

// Shown the first time there are no notes at all, so a brand-new user sees
// a working example (in particular the bullet list, since that's the one
// formatting feature autoformat-triggers rather than a toolbar click) instead
// of a blank page.
const WELCOME_NOTE = {
  title: 'Welcome to Note Dock',
  content:
    '<p>This is an example note with a basic bullet list:</p>' +
    '<ul>' +
    '<li>Click + to start a new note</li>' +
    '<li>Type "* " or "- " at the start of a line for an instant bullet</li>' +
    '<li>Select text and use the toolbar above for bold, colors, and highlights</li>' +
    '</ul>',
};

async function loadNotes() {
  state.notes = await api('/api/notes');
  if (state.notes.length === 0) {
    state.notes = [
      await api('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(WELCOME_NOTE),
      }),
    ];
  }
  renderList();
  if (state.notes.length > 0) {
    await selectNote(state.notes[0].id); // notes are sorted by updated_at desc
  }
}

async function selectNote(id) {
  if (state.currentId !== id) await flushPendingSave();
  const note = await api(`/api/notes/${id}`);
  state.currentId = id;
  emptyStateEl.hidden = true;
  editorContainerEl.hidden = false;
  titleInputEl.value = note.title;
  contentEditableEl.innerHTML = note.content || '';
  setSaveStatus('');
  renderList();
  renderFoldGutter();
}

async function createNote() {
  const note = await api('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '', content: '' }),
  });
  state.notes.unshift(note);
  await selectNote(note.id);
  titleInputEl.focus();
}

async function deleteNote(id) {
  if (!confirm('Delete this note?')) return;
  await api(`/api/notes/${id}`, { method: 'DELETE' });
  state.notes = state.notes.filter((n) => n.id !== id);
  if (state.currentId === id) {
    clearTimeout(saveTimer);
    saveTimer = null;
    state.currentId = null;
    editorContainerEl.hidden = true;
    emptyStateEl.hidden = false;
  }
  renderList();
}

let saveTimer = null;
function scheduleSave() {
  setSaveStatus('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveCurrentNote();
  }, 600);
}

async function saveCurrentNote() {
  if (state.currentId == null) return;
  const id = state.currentId;
  const title = titleInputEl.value;
  const content = contentEditableEl.innerHTML;
  const updated = await api(`/api/notes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content }),
  });
  if (state.currentId !== id) return; // switched notes while saving
  const idx = state.notes.findIndex((n) => n.id === updated.id);
  if (idx >= 0) {
    state.notes[idx] = { ...state.notes[idx], title: updated.title, updated_at: updated.updated_at };
  }
  state.notes.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  renderList();
  setSaveStatus('Saved ' + new Date().toLocaleTimeString([], { hour12: false }));
}

// Runs any pending debounced save immediately, while the editor still
// shows the note it belongs to. Switching notes, reloading from storage,
// or the page being hidden/closed would otherwise replace or destroy the
// editor first, silently dropping the last fraction of a second of edits.
async function flushPendingSave() {
  if (saveTimer == null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    await saveCurrentNote();
  } catch {
    // The note may have been deleted in another view; nothing to save.
  }
}

document.getElementById('newNoteBtn').addEventListener('click', () => {
  createNote().catch((err) => alert(err.message));
});

titleInputEl.addEventListener('input', scheduleSave);
contentEditableEl.addEventListener('input', () => {
  scheduleSave();
  scheduleRenderFoldGutter();
});

document.querySelectorAll('.toolbar button[data-cmd]').forEach((btn) => {
  btn.addEventListener('click', () => {
    contentEditableEl.focus();
    document.execCommand(btn.dataset.cmd, false, btn.dataset.value || null);
    scheduleSave();
    updateToolbarState();
  });
});

styleSelect.addEventListener('change', () => {
  contentEditableEl.focus();
  document.execCommand('formatBlock', false, styleSelect.value);
  scheduleSave();
  scheduleRenderFoldGutter();
});

// --- Collapsible headings (fold a heading's section, like Box Notes) ---

// Deferred to the next tick so it never runs synchronously inside an
// execCommand-triggered 'input' event, which would otherwise corrupt the
// browser's own in-progress selection update for that command.
function scheduleRenderFoldGutter() {
  setTimeout(renderFoldGutter, 0);
}

// Finds the heading (h1/h2/h3) the text caret currently sits in, if any.
function currentHeading() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  let el = sel.anchorNode;
  if (!el || !contentEditableEl.contains(el)) return null;
  el = el.nodeType === Node.TEXT_NODE ? el.parentNode : el;
  while (el && el !== contentEditableEl) {
    if (/^H[1-3]$/.test(el.tagName)) return el;
    el = el.parentNode;
  }
  return null;
}

function renderFoldGutter() {
  foldGutterEl.innerHTML = '';
  const heading = currentHeading();
  if (!heading) return;

  const folded = heading.dataset.folded === 'true';
  const bodyRect = editorBodyEl.getBoundingClientRect();
  const r = heading.getBoundingClientRect();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fold-toggle';
  btn.style.top = r.top - bodyRect.top + r.height / 2 - 9 + 'px';
  btn.textContent = folded ? '▸' : '▾';
  btn.title = folded ? 'Expand section' : 'Collapse section';
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFold(heading);
  });
  foldGutterEl.appendChild(btn);
}

function toggleFold(heading) {
  const collapsing = heading.dataset.folded !== 'true';
  heading.dataset.folded = collapsing ? 'true' : 'false';

  const level = Number(heading.tagName[1]);
  for (let sib = heading.nextElementSibling; sib; sib = sib.nextElementSibling) {
    if (/^H[1-3]$/.test(sib.tagName) && Number(sib.tagName[1]) <= level) break;
    sib.hidden = collapsing;
  }

  renderFoldGutter();
  scheduleSave();
}

window.addEventListener('resize', renderFoldGutter);

listSelect.addEventListener('change', () => {
  contentEditableEl.focus();
  const value = listSelect.value;
  if (value === 'none') {
    if (document.queryCommandState('insertUnorderedList')) document.execCommand('insertUnorderedList');
    if (document.queryCommandState('insertOrderedList')) document.execCommand('insertOrderedList');
  } else {
    document.execCommand(value);
  }
  scheduleSave();
});

// --- Text color (character) and line background color ---

const TEXT_COLORS = [
  { hex: '#202124', label: 'Default' },
  { hex: '#d93025', label: 'Red' },
  { hex: '#e8710a', label: 'Orange' },
  { hex: '#f9ab00', label: 'Yellow' },
  { hex: '#188038', label: 'Green' },
  { hex: '#1967d2', label: 'Blue' },
  { hex: '#8430ce', label: 'Purple' },
  { hex: '#5f6368', label: 'Gray' },
];

const HIGHLIGHT_COLORS = [
  { hex: 'none', label: 'None' },
  { hex: '#fde8b3', label: 'Yellow' },
  { hex: '#bdddc6', label: 'Green' },
  { hex: '#bfd5f5', label: 'Blue' },
  { hex: '#f5c3bf', label: 'Red' },
  { hex: '#ddc3f4', label: 'Purple' },
  { hex: '#fad7b5', label: 'Orange' },
  { hex: '#d4d6d8', label: 'Gray' },
];

function applyForeColor(hex) {
  contentEditableEl.focus();
  document.execCommand('foreColor', false, hex);
  scheduleSave();
}

function applyLineColor(hex) {
  contentEditableEl.focus();
  const sel = window.getSelection();
  if (!sel.rangeCount) return;

  // A specific range of text is selected: highlight just that text,
  // like a highlighter marker, instead of the whole containing line.
  if (!sel.getRangeAt(0).collapsed) {
    document.execCommand('hiliteColor', false, hex === 'none' ? 'transparent' : hex);
    scheduleSave();
    return;
  }

  // No selection, just a caret: highlight the whole current line/item.
  let blockEl = getBlockElement(sel.getRangeAt(0).startContainer);
  if (blockEl === contentEditableEl) {
    document.execCommand('formatBlock', false, 'P');
    const sel2 = window.getSelection();
    if (!sel2.rangeCount) return;
    blockEl = getBlockElement(sel2.getRangeAt(0).startContainer);
  }
  if (blockEl === contentEditableEl) return;
  blockEl.style.backgroundColor = hex === 'none' ? '' : hex;
  scheduleSave();
}

function buildColorMenu(menuEl, colors, onPick) {
  colors.forEach(({ hex, previewHex, label }) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'color-swatch' + (hex === 'none' ? ' none' : '');
    swatch.title = label;
    if (hex !== 'none') swatch.style.background = previewHex || hex;
    // Prevent the button from taking focus on mousedown, which would
    // collapse the contentEditable's text selection before click fires.
    swatch.addEventListener('mousedown', (e) => e.preventDefault());
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      onPick(hex);
      closeAllColorMenus();
    });
    menuEl.appendChild(swatch);
  });
}

function closeAllColorMenus() {
  document.querySelectorAll('.color-menu').forEach((m) => (m.hidden = true));
}

function toggleColorMenu(menuEl) {
  const wasHidden = menuEl.hidden;
  closeAllColorMenus();
  menuEl.hidden = !wasHidden;
  if (menuEl.hidden) return;
  // Anchored at its button, so a wide menu can run off the edge of a narrow panel.
  menuEl.style.left = '0px';
  const overflow = menuEl.getBoundingClientRect().right - (document.documentElement.clientWidth - 8);
  if (overflow > 0) menuEl.style.left = `${-overflow}px`;
}

const colorBtn = document.getElementById('colorBtn');
const colorMenu = document.getElementById('colorMenu');
const textColorGrid = document.getElementById('textColorGrid');
const lineColorGrid = document.getElementById('lineColorGrid');

buildColorMenu(textColorGrid, TEXT_COLORS, applyForeColor);
buildColorMenu(lineColorGrid, HIGHLIGHT_COLORS, applyLineColor);

colorBtn.addEventListener('mousedown', (e) => e.preventDefault());
colorBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleColorMenu(colorMenu);
});
document.addEventListener('click', () => closeAllColorMenus());

// --- Wide mode (folded into the same "A" dropdown as a Layout section) ---

const wideModeCheckbox = document.getElementById('wideModeCheckbox');

function setWide(wide) {
  editorContainerEl.classList.toggle('wide', wide);
  localStorage.setItem('notes.wide', wide ? '1' : '0');
}

// Stopped on the whole row, not just the checkbox, since clicking the
// "Wide mode" label text (rather than the checkbox square itself) starts
// its own separate click event that would otherwise still bubble to the
// document-level listener above and close the menu.
wideModeCheckbox.closest('label').addEventListener('click', (e) => e.stopPropagation());
wideModeCheckbox.addEventListener('change', () => setWide(wideModeCheckbox.checked));

// Defaults to wide unless the user has explicitly turned it off before.
const wideByDefault = localStorage.getItem('notes.wide') !== '0';
wideModeCheckbox.checked = wideByDefault;
setWide(wideByDefault);

// --- Manual panel toggle (for browsers whose toolbar icon can open the
// side panel but not close it again — a known Vivaldi limitation; see
// background.js). Stored in chrome.storage.local, not localStorage, since
// background.js (which actually needs this) can't read localStorage. ---

const manualToggleCheckbox = document.getElementById('manualToggleCheckbox');
manualToggleCheckbox.closest('label').addEventListener('click', (e) => e.stopPropagation());
manualToggleCheckbox.addEventListener('change', () => {
  chrome.storage.local.set({ manualPanelToggle: manualToggleCheckbox.checked });
});
chrome.storage.local.get('manualPanelToggle').then(({ manualPanelToggle }) => {
  manualToggleCheckbox.checked = !!manualPanelToggle;
});

// Reflects the current cursor position's formatting in the toolbar controls,
// like Box Notes showing "Heading 3" or highlighting an active Bold button.
function updateToolbarState() {
  const sel = window.getSelection();
  if (!sel.rangeCount || !contentEditableEl.contains(sel.anchorNode)) return;

  const blockTag = document.queryCommandValue('formatBlock').toUpperCase();
  styleSelect.value = ['H1', 'H2', 'H3'].includes(blockTag) ? blockTag : 'P';

  if (document.queryCommandState('insertUnorderedList')) listSelect.value = 'insertUnorderedList';
  else if (document.queryCommandState('insertOrderedList')) listSelect.value = 'insertOrderedList';
  else listSelect.value = 'none';

  document.querySelectorAll('.toolbar button[data-cmd]').forEach((btn) => {
    btn.classList.toggle('active', document.queryCommandState(btn.dataset.cmd));
  });
}

document.addEventListener('selectionchange', updateToolbarState);
document.addEventListener('selectionchange', scheduleRenderFoldGutter);

// Finds the block containing `node`: the nearest enclosing <li> if inside a
// list (so highlighting/autoformat scope to that specific item, not the
// whole <ul>/<ol>), otherwise the top-level block (direct child of the
// editable, or the editable itself when there's no wrapping block yet).
function getBlockElement(node) {
  let el = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  while (el && el !== contentEditableEl && el.parentNode !== contentEditableEl && el.tagName !== 'LI') {
    el = el.parentNode;
  }
  return el || contentEditableEl;
}

// Markdown-style autoformat: "* " or "- " at the start of a line becomes a
// bullet list; "1. " (any number) becomes a numbered list.
const BULLET_TRIGGERS = ['*', '-'];
const ORDERED_TRIGGER = /^\d+\.$/;

// Converts `blockEl` (now empty, after the trigger text like "* " has been
// deleted) into a <ul>/<ol><li> directly via DOM manipulation, instead of
// document.execCommand('insertUnorderedList'). Chrome has a long-standing
// quirk where that command, run on an empty block, lists the wrong
// (adjacent, non-empty) sibling instead of the current empty one.
function convertBlockToList(blockEl, listTag) {
  const li = document.createElement('li');
  while (blockEl.firstChild) li.appendChild(blockEl.firstChild);
  if (!li.hasChildNodes()) li.appendChild(document.createElement('br'));
  const list = document.createElement(listTag);
  list.appendChild(li);
  if (blockEl === contentEditableEl) {
    blockEl.appendChild(list);
  } else {
    blockEl.replaceWith(list);
  }

  const range = document.createRange();
  range.selectNodeContents(li);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

contentEditableEl.addEventListener('beforeinput', (e) => {
  if (e.inputType !== 'insertText' || e.data !== ' ') return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return;

  const blockEl = getBlockElement(range.startContainer);
  const preRange = document.createRange();
  preRange.selectNodeContents(blockEl);
  preRange.setEnd(range.startContainer, range.startOffset);
  const text = preRange.toString();

  let listTag = null;
  if (BULLET_TRIGGERS.includes(text)) listTag = 'UL';
  else if (ORDERED_TRIGGER.test(text)) listTag = 'OL';
  if (!listTag) return;

  e.preventDefault();
  preRange.deleteContents();
  convertBlockToList(blockEl, listTag);
  scheduleSave();
});

// Finds the nearest <li> ancestor of `node`, if any.
function closestListItem(node) {
  let el = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  while (el && el !== contentEditableEl) {
    if (el.tagName === 'LI') return el;
    el = el.parentNode;
  }
  return null;
}

// Tab/Shift+Tab nests or un-nests the current list item, like Box Notes.
contentEditableEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  if (!closestListItem(sel.getRangeAt(0).startContainer)) return;

  e.preventDefault();
  document.execCommand(e.shiftKey ? 'outdent' : 'indent');
  scheduleSave();
});

// --- Layout: drag the sidebar edge to resize, click it to hide/show ---
//
// In the full-page tab the note list is a left sidebar (drag its right
// edge to change width); in the side panel it's a bottom strip instead
// (drag its top edge to change height) since a left-right split wastes
// space in a panel that's usually only a few hundred pixels wide. Both
// share the same drag/collapse logic below, just measured along a
// different axis and persisted under different keys so the two modes
// remember independent sizes.
const SIZE_STORAGE_KEY = isFullPageTab ? 'notes.sidebarWidth' : 'notes.sidebarPanelHeight';
const COLLAPSED_STORAGE_KEY = isFullPageTab ? 'notes.sidebarCollapsed' : 'notes.sidebarPanelCollapsed';
const MIN_SIDEBAR_SIZE = isFullPageTab ? 180 : 100;
// window.innerHeight-derived, so these are functions recomputed whenever
// actually needed rather than consts frozen at script-parse time: in
// Chrome's real side panel (unlike Vivaldi's, and unlike a plain tab),
// window.innerHeight reads 0 at the moment this script first evaluates —
// the panel's own layout isn't sized yet — so caching a 0-based MAX once
// permanently clamped every drag to 0, no matter how far you dragged.
function maxSidebarSize() {
  if (isFullPageTab) return 480;
  // Panel mode's cap matches the CSS max-height: 80vh on .sidebar (see
  // style.css) so the JS clamp never fights a lower CSS-imposed ceiling.
  // The 200 floor guards against the same zero-height timing issue this
  // whole function exists to avoid.
  return Math.round(Math.max(window.innerHeight, 200) * 0.8);
}
// Panel mode's default is 30% of the panel's height, not a fixed pixel
// value, so it starts out proportional regardless of how tall the panel
// happens to be. Only applies the first time (before any user resize is
// saved to localStorage below).
function defaultSidebarSize() {
  if (isFullPageTab) return 280;
  return Math.round(Math.max(window.innerHeight, 200) * 0.3);
}
const CLICK_DRAG_THRESHOLD = 4;
// In tab mode the resizer sits to the right of the sidebar, so dragging
// right (positive delta) grows it. In panel mode the resizer sits above
// the bottom sidebar instead, so dragging up (negative delta) is what
// should grow it — hence the sign flip here.
const DRAG_SIGN = isFullPageTab ? 1 : -1;

function setSidebarSize(px) {
  document.documentElement.style.setProperty('--sidebar-size', `${px}px`);
}

function currentSidebarExtent() {
  const rect = sidebarEl.getBoundingClientRect();
  return isFullPageTab ? rect.width : rect.height;
}

function setSidebarCollapsed(collapsed) {
  sidebarEl.hidden = collapsed;
  sidebarResizerEl.classList.toggle('collapsed', collapsed);
  localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
}

let dragStartPos = null;
let dragStartSize = null;
let dragMoved = false;

sidebarResizerEl.addEventListener('mousedown', (e) => {
  dragStartPos = isFullPageTab ? e.clientX : e.clientY;
  dragStartSize = sidebarEl.hidden ? MIN_SIDEBAR_SIZE : currentSidebarExtent();
  dragMoved = false;
  document.body.classList.add('resizing-sidebar');
  sidebarResizerEl.classList.add('resizing');
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (dragStartPos === null) return;
  const pos = isFullPageTab ? e.clientX : e.clientY;
  const delta = pos - dragStartPos;
  if (!dragMoved && Math.abs(delta) < CLICK_DRAG_THRESHOLD) return;
  dragMoved = true;
  if (sidebarEl.hidden) setSidebarCollapsed(false);
  const size = Math.min(Math.max(dragStartSize + DRAG_SIGN * delta, MIN_SIDEBAR_SIZE), maxSidebarSize());
  setSidebarSize(size);
});

window.addEventListener('mouseup', () => {
  if (dragStartPos === null) return;
  document.body.classList.remove('resizing-sidebar');
  sidebarResizerEl.classList.remove('resizing');
  if (dragMoved) {
    const size = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-size'), 10);
    localStorage.setItem(SIZE_STORAGE_KEY, String(size));
  } else {
    setSidebarCollapsed(!sidebarEl.hidden);
  }
  dragStartPos = null;
  dragStartSize = null;
});

// Clamped the same way the live drag handler above clamps, so a stale or
// out-of-range persisted value (e.g. "0" from an old bug, or a MAX that
// no longer fits after the window got smaller) can't silently make the
// panel look "stuck" on every future load — it self-heals back into
// range here instead of just reapplying whatever was last saved.
const parsedStoredSize = parseInt(localStorage.getItem(SIZE_STORAGE_KEY), 10);
const storedSize = Number.isFinite(parsedStoredSize) ? parsedStoredSize : defaultSidebarSize();
setSidebarSize(Math.min(Math.max(storedSize, MIN_SIDEBAR_SIZE), maxSidebarSize()));
setSidebarCollapsed(localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1');

// --- Extension-only: switch between the side panel and a full-page tab ---

// The full-page tab is opened with "?mode=tab" appended (see TAB_URL below
// and background.js), so context is a synchronous, unambiguous check of our
// own URL rather than relying on chrome.tabs.getCurrent() — which can throw
// or behave inconsistently inside a side panel, silently preventing the
// click listener below from ever being attached.
const TAB_URL = chrome.runtime.getURL('sidepanel.html?mode=tab');
const displayModeBtn = document.getElementById('displayModeBtn');

displayModeBtn.title = isFullPageTab ? 'Switch to side panel' : 'Open in full page';

// Fetched once at load time, well before any click, so the handler below
// can call chrome.sidePanel.open() as its first synchronous action.
// Chrome requires that call to be the direct, synchronous result of the
// user gesture — awaiting anything (even chrome.tabs.getCurrent()) first
// makes Chrome reject it with "This method must be called during a user
// gesture", which fails silently in real Chrome (caught below, but only
// after everything else already ran).
let cachedTab = null;
if (isFullPageTab) {
  chrome.tabs.getCurrent().then((tab) => { cachedTab = tab; });
}

displayModeBtn.addEventListener('click', async () => {
  try {
    if (isFullPageTab) {
      if (!cachedTab || cachedTab.windowId == null) return;
      chrome.sidePanel.open({ windowId: cachedTab.windowId });

      // Flush any pending debounced autosave now — chrome.tabs.remove()
      // below destroys this tab's JS context, which would otherwise cancel
      // the in-flight setTimeout from scheduleSave() and drop the last edit.
      clearTimeout(saveTimer);
      await saveCurrentNote();

      await chrome.storage.local.set({ displayMode: 'sidepanel' });

      // Return to whichever tab was active before we switched to full-page
      // mode, instead of leaving it to Chrome's own (unpredictable) guess
      // for which tab becomes active once this one is closed.
      const { returnToTabId } = await chrome.storage.local.get('returnToTabId');
      if (returnToTabId != null) {
        try {
          await chrome.tabs.update(returnToTabId, { active: true });
          await chrome.storage.local.remove('returnToTabId');
        } catch {
          // The remembered tab no longer exists; fall through to the default.
        }
      }

      chrome.tabs.remove(cachedTab.id);
    } else {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.storage.local.set({
        displayMode: 'tab',
        returnToTabId: activeTab ? activeTab.id : null,
      });
      await chrome.tabs.create({ url: TAB_URL });
    }
  } catch (err) {
    alert(err.message);
  }
});

loadNotes().catch((err) => alert(err.message));

// The side panel and the full-page tab are separate page instances, each
// with their own in-memory copy of `state`; edits made in one go stale in
// the other until it's reloaded. Refresh whenever this page becomes visible
// again (e.g. switching back from full-page mode), per Chrome's own
// recommended pattern for side panels reacting to visibility changes.
async function refreshFromStorage() {
  await flushPendingSave();
  state.notes = await api('/api/notes');
  if (state.currentId != null && state.notes.some((n) => n.id === state.currentId)) {
    await selectNote(state.currentId);
  } else if (state.notes.length > 0) {
    await selectNote(state.notes[0].id);
  } else {
    renderList();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    refreshFromStorage().catch((err) => console.error(err));
  } else {
    // The panel may be torn down right after this; don't let a pending
    // debounced save die with the page.
    flushPendingSave();
  }
});
