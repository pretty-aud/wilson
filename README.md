# WILSON

AI-powered creative production & learning platform.

Built with Electron + Vite + React 19 + Tailwind CSS 4.

## Prerequisites

- **Node.js** v20+ (tested on v24) — [download here](https://nodejs.org/)
- **Git** — [download here](https://git-scm.com/downloads)

## Setup (Windows PC)

1. **Clone the repo**

   ```bash
   git clone https://github.com/pretty-aud/wilson.git
   cd wilson/WILSON
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Run in dev mode** (Vite dev server — browser only, no Electron shell)

   ```bash
   npm run dev
   ```

   Opens at `http://localhost:5203`.

4. **Run as Electron app** (builds then launches the desktop window)

   ```bash
   npm run electron:dev
   ```

## Build & Package

| Command | What it does |
|---|---|
| `npm run build` | Vite production build to `dist/` |
| `npm run package` | Build + electron-builder, unpacked (on Windows: the app in `release/win-unpacked/`, no installer) |
| `npm run dist` | Build + electron-builder (the Windows installer users receive, in `release/`) |

## Project Structure

```
WILSON/
├── electron/          # Electron main + preload scripts
├── public/            # Static assets (icons, audio, extensions)
├── src/
│   ├── agent/         # Agent logic
│   ├── components/    # Shared React components
│   ├── data/          # Static data
│   ├── tools/         # Tool modules
│   │   ├── deck-outline-generator_v0.514/
│   │   ├── otter_v0.3.1/
│   │   └── rabbit_v0.1.0/
│   ├── App.jsx        # Root app component
│   ├── main.jsx       # React entry point
│   └── storage.js     # Storage utilities
├── vite.config.js     # Vite config
└── package.json       # Scripts, dependencies and electron-builder's `build` config
```

## Troubleshooting

- **`npm` not found**: Make sure Node.js is installed and added to your PATH. On some Windows setups you may need to restart your terminal after installing Node.
- **Build fails with native module errors**: Delete `node_modules` and `package-lock.json`, then run `npm install` again.
- **Electron window is blank**: Run `npm run build` before `npm run electron:start` — the Electron shell serves the built `dist/` folder.
