# 🎯 Focus Assistant — Chrome Extension MVP

An **intentional browsing assistant** that keeps you aligned with your goal while working online. Built as a Manifest V3 Chrome Extension with a React popup.

---

## Directory Structure

```
Focus/
├── assets/               # Extension icons (16×16, 48×48, 128×128 PNGs)
├── background/
│   └── background.js     # Service worker — listens for tab events
├── content/
│   └── content.js        # Injected into every page — floating goal bar
├── dist/                 # Webpack build output (auto-generated, do not edit)
├── popup/
│   ├── App.jsx           # React root component
│   ├── index.html        # Popup HTML shell
│   ├── index.js          # React entry point
│   └── style.css         # Popup styles
├── .babelrc              # Babel config for JSX transpilation
├── manifest.json         # Chrome Extension Manifest V3
├── package.json          # Node dependencies & build scripts
├── webpack.config.js     # Webpack bundler config
└── README.md
```

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Build the popup bundle
```bash
# One-time production build
npm run build

# Or watch mode during development
npm run dev
```

### 3. Load into Chrome
1. Open `chrome://extensions`
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this `Focus/` folder
5. Pin the extension and click the icon to open the popup

---

## MVP Features

| Feature | Status |
|---|---|
| React popup with goal input | ✅ |
| Start Session / End Session buttons | ✅ |
| Floating goal bar on every page | ✅ |
| Tab activation / update logging | ✅ |
| Goal persistence (chrome.storage) | 🔜 |
| AI goal-alignment check | 🔜 |
| Distraction nudges | 🔜 |
| Session summary | 🔜 |

---

## Scaling for Future Features

- **AI Integration** → Add an `api/` folder; call from `background.js` with `fetch()`
- **Nudges** → Send `chrome.tabs.sendMessage` from background; handle in `content.js`
- **Session Summary** → Add a `summary/` page and register it as a Chrome extension page
- **Options UI** → Add `options/` folder and register in `manifest.json` under `"options_page"`

---

## Permissions Used

| Permission | Reason |
|---|---|
| `activeTab` | Read the currently active tab's URL |
| `storage` | Persist session goal across tabs |
| `scripting` | Programmatically inject scripts if needed |

---

## Tech Stack

- **Chrome Manifest V3** — modern extension platform
- **React 18** — popup UI
- **Webpack 5 + Babel** — JSX bundling
- **Vanilla JS** — content and background scripts (no framework overhead)
