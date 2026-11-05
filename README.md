# Train Simulator

A realistic 3D train-driving simulator for **macOS and Windows** (Electron + Three.js).
Drive a modern electric multiple unit on a timetable: stop precisely at platforms, obey colour-light
signals and speed limits, handle gradients, tunnels, viaducts and bad weather, and keep passengers comfortable.

## Run

```bash
npm install
npm start
```

Requires Node 20+. The renderer needs WebGL2 (any GPU from the last decade).

## Build installers

```bash
npm run dist:mac   # .dmg + .zip (Apple Silicon and Intel) – run on a Mac
npm run dist:win   # NSIS installer + portable .exe – run on Windows
```

Or let GitHub Actions do it: push a `v*` tag (or run the **Build desktop apps** workflow) and download the
artifacts. Builds are unsigned: on macOS right-click → **Open** the first time; on Windows choose
**More info → Run anyway** in SmartScreen.

## Features

- **Physics**: force-balance dynamics (power-limited traction, Davis resistance, gradients, curve resistance,
  adhesion and wheelslip, lagged air brake, rollback), fixed 120 Hz step, fully unit-tested.
- **Routes**: three procedurally generated lines (coastal, valley, alpine) with real grade limits,
  speed limits derived from curve geometry, temporary restrictions, tunnels and viaducts, station towns.
- **Rules**: colour-light signals with a dispatcher, AWS warnings, TPWS train-stop, overspeed protection (ATP),
  door interlocks, platform stopping accuracy, timetable punctuality, comfort scoring, optional alerter.
- **Graphics**: streamed LOD terrain, forests, catenary, stations with passengers, day/night cycle, rain/snow/fog,
  headlights, bloom and eye adaptation, three cameras (cab, follow, lineside), three quality presets.
- **Audio**: entirely synthesised – inverter whine, rolling noise, rail clatter, brake squeal and hiss, horn,
  warning tones, door chimes, tunnel reverb, optional station announcements.
- **UI**: instrument cluster with permitted-speed arc and braking target, route-ahead strip, live timetable
  delta, contextual hints, pause/help/results screens, persistent best scores and settings.

## Controls

| Key | Action |
|---|---|
| `W` / `S` (or `↑` / `↓`) | Raise / lower the master controller; below zero it is the brake. `Shift` = faster |
| Mouse wheel · drag the lever | Move the controller directly |
| `X` · `Z` | Neutral · full service brake |
| `Space` | Emergency brake (hold until stopped, then `E` to reset) |
| `E` / `Enter` | Acknowledge AWS warning / reset brakes |
| `T` | Open / close doors (stopped at the platform) |
| `H` | Horn |
| `C` · `1` `2` `3` | Camera: cab · follow · lineside |
| `P` / `Esc` · `F1` · `F` · `M` · `F3` | Pause · help · fullscreen · mute · debug |
| Gamepad | Left stick / triggers = controller, A ack, X doors, B horn, Y camera, LB+RB emergency |

### Driving a station stop

1. Brake so the **front of the train stops on the yellow marker** (within 3 m scores 100 %).
2. `T` to open the doors; wait for boarding; `T` to close.
3. The starter signal stays red until the departure time. When it clears, apply power.

**Signals**: green = clear · yellow = next signal is red (acknowledge the warning with `E`) · red = stop.
Passing a red signal, or exceeding a limit by 15 km/h, applies the emergency brake and costs points.

## Development

```text
src/sim/      physics, route generator, rules engine (pure JS, no DOM)   ← unit tested
src/render/   Three.js scene: terrain, track, structures, sky, train, cab, view
src/audio/    synthesised audio engine
src/ui/       HUD, screens, input, cab-glass overlay, storage
src/vendor/   three.js (vendored; regenerate with `npm run vendor`)
main.cjs      Electron main process (serves the app over app://)
tools/        e2e.mjs (Playwright UI test), shot.mjs (screenshot harness), vendor.mjs
```

```bash
npm test          # 65 tests: physics, routes, rules, hints, fuzzing; a bot completes every route in every weather
npm run test:e2e  # real-click UI test in headless Chromium (needs Playwright)
```

Headless smoke test of the actual Electron app:

```bash
TRAIN_SIM_SELFTEST=/tmp/shot.png xvfb-run -a npx electron . --no-sandbox
```
