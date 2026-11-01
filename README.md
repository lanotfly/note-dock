# Note Dock

A simple rich text notes app for Chrome — with headings, formatting, and colored highlights — that lives in the side panel or expands to a full page.

Notes is a simple, Box Notes-style rich-text note-taking app that lives in your browser. Write and format notes with headings, bold/italic/underline/strikethrough, text and highlight colors, and nested bulleted or numbered lists — right in Chrome's side panel, or expand to a full page when you need more room. New notes are automatically named by date. Everything is saved locally on your device; no account, no sync, no data collection.

**Chrome Web Store:** [Note Dock](https://chromewebstore.google.com/detail/note-dock/dbgjehcdacpfpcjkionbeellbomogedi) (extension ID `dbgjehcdacpfpcjkionbeellbomogedi`)

## Features

- Rich text editing: headings (with fold/unfold), bold, italic, underline, strikethrough
- Text color and highlight color pickers
- Nested bulleted and numbered lists
- Runs in Chrome's side panel, or opens as a full-page tab (and switches back cleanly)
- Resizable, hideable sidebar with a note list; new notes are auto-named by date (`YY-MMDD`, numbered on collision)
- Autosave to `chrome.storage.local`
- Optional manual panel toggle for browsers where a second toolbar click doesn't close the side panel (e.g. Vivaldi)

## Install for development (load unpacked)

1. Clone or download this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select this repository's root folder (the one containing `manifest.json`).
4. Pin **Note Dock** and click its toolbar icon to open the side panel.

## File layout

| File | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3 definition: icons, service worker, side panel, permissions |
| `background.js` | Service worker: toolbar-click behaviour, side panel ↔ full-page tab switching |
| `sidepanel.html` | The app's single page (used for both the side panel and the full-page view) |
| `app.js` | UI and editor logic: note list, formatting, colors, folding, sidebar sizing |
| `storage.js` | `NotesStore` — local notes store backed by `chrome.storage.local` |
| `style.css` | All styling |
| `icons/` | Toolbar / store icons (16, 48, 128 px) |

## Permissions

- `storage` / `unlimitedStorage` — save notes locally on the device
- `sidePanel` — run in Chrome's side panel
- `tabs` — find/focus the full-page Notes tab and return to the previous tab

No data leaves the device; the extension makes no network requests.

## Releasing a new version

1. Bump `version` in `manifest.json`.
2. Zip the repository root's extension files (`manifest.json`, `*.js`, `*.css`, `*.html`, `icons/`).
3. Upload the zip in the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole).

## Provenance

This repository was created on 2026-10-29 by recovering the source from the published Chrome Web Store package of v1.1.3 (the `.crx` as served by the store). The code is the original, unminified source. Only the two store-injected artifacts were removed to turn the package back into a maintainable source tree:

- the `_metadata/` folder (store-generated content hashes), and
- the `update_url` field in `manifest.json` (added by the store at publish time).

Everything else is byte-for-byte identical to the published v1.1.3 package.
