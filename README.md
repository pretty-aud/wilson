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
| `npm run package` | Build + Electron Forge package (unpacked app in `out/`) |
| `npm run make` | Build + Electron Forge make (Windows installer via Squirrel) |

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
│   │   └── otter_v0.3.1/
│   ├── App.jsx        # Root app component
│   ├── main.jsx       # React entry point
│   └── storage.js     # Storage utilities
├── forge.config.cjs   # Electron Forge config
├── vite.config.js     # Vite config
└── package.json
```

## Troubleshooting

- **`npm` not found**: Make sure Node.js is installed and added to your PATH. On some Windows setups you may need to restart your terminal after installing Node.
- **Build fails with native module errors**: Delete `node_modules` and `package-lock.json`, then run `npm install` again.
- **Electron window is blank**: Run `npm run build` before `npm run electron:start` — the Electron shell serves the built `dist/` folder.
