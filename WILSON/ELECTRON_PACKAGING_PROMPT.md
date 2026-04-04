Package my WILSON v0.4.3 app as a standalone Windows .exe using Electron. The project is at:

```
C:\Users\Audrey\Documents\My_Work\Dev_Work\Claude_Work\WILSON_v0.4.3
```

npm path on this machine: `export PATH="/c/Program Files/nodejs:$PATH"`

## What the app is

A Vite 6 + React 19 + Tailwind CSS 4 single-page app. No router — page switching is state-driven in `App.jsx`. It has a startup animation with audio (Web Audio API in `PasswordScreen.jsx`), uses IndexedDB for project storage (`src/storage.js`), localStorage for settings/API key/password, `window.showDirectoryPicker` for export folder selection, and makes direct `fetch()` calls to `https://api.anthropic.com/v1/messages` with the header `anthropic-dangerous-direct-browser-access: true`.

## What I need you to do

Wrap this existing web app in Electron so it builds into a distributable `.exe`. This will be shared via GitHub for internal testing with a small group at work.

## Critical rules

1. **Do NOT modify any `.jsx` files.** Zero changes to React components, layouts, styling, or UI behavior. The renderer must run the exact same code.
2. The only existing files you may edit are `package.json` and `vite.config.js`.
3. All browser APIs must continue working: localStorage, IndexedDB, Web Audio API, `window.showDirectoryPicker`, `fetch()`.
4. Use the **Vite build output + Electron** pattern: Vite builds the React app into `dist/` (already works via `npm run build`), Electron main process loads `dist/index.html`.

## Architecture decisions

- Use **Electron Forge** with `@electron-forge/maker-squirrel` for Windows packaging.
- In `electron/main.js`, use a **local HTTP server** (Node `http` module) to serve the `dist/` folder on `127.0.0.1` with a random port (port `0`). Do NOT use `win.loadFile()` with `file://` protocol — `file://` breaks `showDirectoryPicker` (requires secure context) and may cause CORS issues with the Anthropic API fetch calls. Loading from `http://127.0.0.1` gives a secure context and avoids all of these issues.
- `nodeIntegration: false`, `contextIsolation: true` — the React app does not need Node.js access.
- `autoHideMenuBar: true` for a clean look.
- Window: 1400x900 default, 1024x700 minimum.
- Icon: `public/logo.png` exists. Convert it to `public/logo.ico` (256x256) for the Squirrel installer if possible, otherwise skip the `.ico` and use defaults.
- `vite.config.js`: add `base: './'` for relative asset paths. Do not change anything else (port, plugins, define, build settings).

## File structure to create

```
WILSON_v0.4.3/
├── electron/
│   └── main.js          ← Electron main process (local HTTP server + BrowserWindow)
├── forge.config.js      ← Electron Forge config
├── .gitignore           ← node_modules/, dist/, out/, *.exe
├── package.json         ← Add "main" field, Electron scripts, Electron devDeps
├── vite.config.js       ← Add base: './' only
├── src/                 ← DO NOT MODIFY
├── public/              ← DO NOT MODIFY (except adding logo.ico if converting)
└── index.html           ← DO NOT MODIFY
```

## package.json changes

Add these to the existing file (keep all current deps/devDeps/scripts):

```json
{
  "main": "electron/main.js",
  "scripts": {
    "electron:dev": "npm run build && electron .",
    "electron:start": "electron .",
    "package": "npm run build && electron-forge package",
    "make": "npm run build && electron-forge make"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "@electron-forge/cli": "^7.0.0",
    "@electron-forge/maker-squirrel": "^7.0.0"
  }
}
```

## Anthropic API calls

The app fetches `https://api.anthropic.com/v1/messages` directly from the renderer with `anthropic-dangerous-direct-browser-access: true`. Since we're loading from `http://127.0.0.1`, CORS should work the same as a browser. If API calls fail with CORS errors, add `session.defaultSession.webRequest.onHeadersReceived` in main.js to inject `access-control-allow-origin: *` and `access-control-allow-headers: *` response headers. Only add this workaround if needed — test without it first.

## showDirectoryPicker

The app conditionally renders the folder picker button only when `window.showDirectoryPicker` exists. Loading from `http://127.0.0.1` (secure context) should make this API available. If it doesn't work for some reason, the app gracefully falls back to browser download dialogs — nothing breaks.

## After implementation

1. Run `npm run build` to verify Vite build still works
2. Run `npm run electron:start` to test the app in Electron
3. Verify: startup animation + audio chime plays, password entry works, settings save API key, file upload works, AI generation calls succeed, slide visualizer renders, exports work, project manager persists data
4. Run `npm run make` to produce the distributable `.exe`
5. Tell me where the output `.exe` is located

## GitHub distribution

The repo should be cloneable. Testers can either:
- Clone + `npm install` + `npm run make` to build locally
- Or I can upload the `.exe` as a GitHub Release asset for direct download

Create a `.gitignore` with: `node_modules/`, `dist/`, `out/`, `*.exe`
