# Train Simulator

2D driver-view train simulator for **Windows and macOS** (Electron).

## Run
```bash
npm install
npm start
```

## Build installers
```bash
npm run dist:mac   # .dmg (run on a Mac)
npm run dist:win   # NSIS installer + portable .exe
```

## Controls
| Key | Action |
|---|---|
| W / S (or Up/Down) | Raise / lower power |
| B / V (or Right/Left) | Raise / release service brake |
| Space | Emergency brake (hold until stopped) |
| X | Cut power |
| P / R | Pause / restart |

## Gameplay
Drive 9 km across 4 stations (Central, Riverside, Hillcrest, Harbour). Stop within the
station zone for up to 100 points (4 per metre of error). Overspeeding and missing a
station cost points. Gradients and speed limits are shown on the HUD and dial.

## Layout
- `src/sim.js` – physics, route and scoring (pure JS, unit tested)
- `src/game.js` – canvas rendering and input
- `main.js` – Electron entry
- `test/` – `npm test`

## Roadmap
Signals, timetable/punctuality scoring, curves, multiple routes, sound, gamepad support.
