const TAB_URL = chrome.runtime.getURL('sidepanel.html?mode=tab');
const HEARTBEAT_PREFIX = 'panelOpen:';
const HEARTBEAT_FRESH_MS = 2500;

// Remembers the tab the user was on so app.js's "switch back to side panel"
// action can restore it, instead of leaving it to Chrome's own guess for
// which tab becomes active once the full-page Notes tab is closed.
async function focusOrCreatePageTab(previousTabId) {
  const [existing] = await chrome.tabs.query({ url: TAB_URL });
  await chrome.storage.local.set({ returnToTabId: previousTabId });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: TAB_URL });
  }
}

let cachedDisplayMode = 'sidepanel';

// Whether to use the manual open/close toggle below instead of the
// browser's native openPanelOnActionClick. Chrome's native toggle works;
// Vivaldi's toolbar icon only ever opens the panel through it and never
// closes it on a second click. Vivaldi can't be detected from code — on
// Vivaldi 8.2 the user agent, the Client Hints brand list, and the
// window/chrome/navigator keys all look exactly like Chrome — so this is a
// user preference (the "Manual panel toggle" checkbox in app.js).
let useManualToggle = false;

const canClose = typeof chrome.sidePanel.close === 'function';

// While the preference is side-panel mode, the browser itself owns the
// icon click: openPanelOnActionClick makes clicking the action button
// toggle the panel natively. Only used when useManualToggle is off.
function applyPanelBehavior(displayMode) {
  if (useManualToggle) {
    // Must be explicitly forced off, not just skipped: once this was ever
    // set true, the browser persists it across reloads until something
    // explicitly changes it — so onClicked below would otherwise never
    // fire at all while this preference is on.
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
    return;
  }
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: displayMode !== 'tab' }).catch(() => {});
}
applyPanelBehavior(cachedDisplayMode);

// Manual-toggle mode only: whether a window's side panel is currently
// open, inferred from a heartbeat the panel page writes to storage (see
// app.js) while it's visible. This deliberately isn't a runtime.connect
// port + in-memory Set: an idle port doesn't keep an MV3 service worker
// alive ("Opening a port no longer resets the timers" — Chrome 114+), so
// the worker gets killed after ~30s idle, wiping the Set and dropping the
// port, after which every click would look like "panel is closed → open
// it". Heartbeat writes fire storage.onChanged in this worker, which both
// keeps the mirror below current and resets the idle timer while the
// panel is open; once it closes the beats stop and the entry goes stale.
const panelLastSeen = new Map(); // windowId -> timestamp of last heartbeat
function noteHeartbeat(key, value) {
  if (!key.startsWith(HEARTBEAT_PREFIX)) return;
  const windowId = Number(key.slice(HEARTBEAT_PREFIX.length));
  if (value === undefined) panelLastSeen.delete(windowId);
  else panelLastSeen.set(windowId, value);
}
function isPanelOpen(windowId) {
  const seen = panelLastSeen.get(windowId);
  return seen !== undefined && Date.now() - seen < HEARTBEAT_FRESH_MS;
}
for (const area of [chrome.storage.session, chrome.storage.local]) {
  if (!area) continue;
  area.get(null).then((all) => {
    for (const [key, value] of Object.entries(all)) noteHeartbeat(key, value);
  }).catch(() => {});
}

chrome.storage.local.get(['displayMode', 'manualPanelToggle']).then(({ displayMode, manualPanelToggle }) => {
  if (displayMode) cachedDisplayMode = displayMode;
  useManualToggle = !!manualPanelToggle;
  applyPanelBehavior(cachedDisplayMode);
});

chrome.storage.onChanged.addListener((changes, area) => {
  for (const [key, change] of Object.entries(changes)) noteHeartbeat(key, change.newValue);
  if (area !== 'local') return;
  if (changes.displayMode) cachedDisplayMode = changes.displayMode.newValue;
  if (changes.manualPanelToggle) useManualToggle = !!changes.manualPanelToggle.newValue;
  if (changes.displayMode || changes.manualPanelToggle) applyPanelBehavior(cachedDisplayMode);
});

// Closing is done two ways at once, because no single one works everywhere
// (verified by driving the real toolbar button of a real Vivaldi 8.2 with
// trusted clicks):
//  - sidePanel.close(): the real API (Chrome 141+). In Vivaldi it exists
//    and even resolves successfully, but silently does nothing.
//  - asking the panel page to window.close() itself: the only thing that
//    actually closes Vivaldi's panel. (setOptions({enabled:false}), the
//    other obvious candidate, also does nothing to an already-open panel
//    there, so it is deliberately not used.)
// Both are harmless where they don't apply.
function closePanel(tab) {
  if (canClose) chrome.sidePanel.close({ windowId: tab.windowId }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'closeSidePanel', windowId: tab.windowId })
    .catch(() => {}); // nobody listening = the panel isn't actually open there
}

function openPanel(tab) {
  // open() must be the direct, synchronous result of the click — nothing
  // may be awaited before it, or the browser rejects it ("This method must
  // be called during a user gesture") — so this never chains via .then().
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
}

// Only fires when the preference is tab mode, when manual-toggle mode is
// on (see applyPanelBehavior above), or in the brief window right after
// the service worker wakes before that function's async call has
// resolved — in which case opening the side panel directly here is the
// correct fallback anyway.
chrome.action.onClicked.addListener((tab) => {
  if (cachedDisplayMode === 'tab') {
    focusOrCreatePageTab(tab.id);
    return;
  }
  if (useManualToggle && isPanelOpen(tab.windowId)) closePanel(tab);
  else openPanel(tab);
});
