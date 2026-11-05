# Indian Rail Simulator

A 3D train-driving simulator for **Windows and macOS** (Electron + Three.js), set on real Indian Railways main lines.
Drive a **WAP-7 / WAP-7HS electric** or **WDP-4D diesel** locomotive hauling **LHB or ICF coaches**, stop on the mark,
obey colour-light signals and speed boards, and run to the timetable.

## Run

```bash
npm install
npm start
```

Requires Node 20+. Windows: if PowerShell blocks `npm`, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` or use `npm.cmd`.

## Build installers

```bash
npm run dist:win   # NSIS installer + portable .exe   (run on Windows)
npm run dist:mac   # .dmg + .zip, Apple Silicon + Intel (run on a Mac)
```

or run the **Build desktop apps** GitHub Action. Builds are unsigned (macOS: right-click → Open; Windows: More info → Run anyway).

## Routes (double-track, electrified, left-hand running)

| Route | Length | Stations | Character |
|---|---|---|---|
| **Bengaluru – Mysuru** | 139 km | Bengaluru City, Kengeri, Bidadi, Ramanagara, Channapatna, Maddur, Mandya, Srirangapatna, Mysuru | rolling Deccan plateau, red soil, paddy, coconut palms, Shimsha and Cauvery bridges, 110 km/h |
| **Delhi – Agra** | 188 km | H. Nizamuddin, Faridabad, Palwal, Kosi Kalan, Mathura Jn, Agra Cantt | flat Gangetic plain, mustard fields, dust haze, canal and river bridges, up to 160 km/h |

Pick any **From / To** pair and **Express** or **All-stations** stopping pattern; the timetable for your chosen train is
computed by simulating an ideal driver with the real physics (a 987 t Shatabdi-style rake needs ~2 h 11 min for the
express pattern Bengaluru–Mysuru). Station chainages are the published distances; geometry, terrain and signalling are
procedurally generated and deterministic (not a survey of the real alignment).

## Trains (specifications from published data)

| Consist | Mass | Length | Power | Notes |
|---|---|---|---|---|
| Shatabdi-style: WAP-7 + 16 LHB | 987 t | 407 m | 4.4 MW at rail | 140 km/h |
| Gatimaan-style: WAP-7HS + 10 LHB | 659 t | 262 m | 4.4 MW | 160 km/h |
| Mail/Express: WAP-7 + 20 ICF | 1,283 t | 468 m | 4.4 MW | long braking distances |
| Diesel Express: WDP-4D + 14 ICF | 950 t | 334 m | 2.75 MW | |

WAP-7: 123 t, 20.56 m, 322 kN starting effort. LHB 23.54 m; ICF 21.77 m. Long-train air brakes are slow to apply and
release, adhesion is limited by the locomotive's weight (with automatic sanding), and rain cuts it further.

## Features

- **Physics**: power-limited traction, Davis resistance, gradients, curves, adhesion/wheelslip/sanding, lagged air brake, rollback.
- **Rules**: signals with a dispatcher, AWS warning, TPWS train-stop, overspeed protection, door interlocks, platform stopping accuracy, punctuality and comfort scoring.
- **World**: streamed terrain, regional vegetation (coconut palms, neem), station towns, double track with overhead line on both sides,
  platforms with canopies, footbridges and yellow multilingual name boards (English + Kannada / Hindi), rivers with bridges,
  opposing traffic on the other line, day/night, rain/fog, headlights.
- **Performance**: adaptive resolution (keeps the frame rate by lowering render resolution), GPU auto-detect, cheap
  Lambert shading, instanced rolling stock (a whole rake is ~4 draw calls). *Auto / Low / Medium / High* in the menu.
- **Audio**: fully synthesised (inverter whine, rolling noise, rail clatter, brakes, horn, warnings, passing trains).

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

**Station stop:** stop with the front of the locomotive on the yellow *LOCO STOP* marker → `T` open doors → wait for
boarding → `T` close → wait for the departure time and the starter signal → power up.
**Signals:** green = clear, yellow = next signal is red (acknowledge the warning with `E`), red = stop.

## Development

```text
src/sim/      physics, consists, route generator, timetable planner, rules (pure JS)   ← unit tested
src/render/   Three.js: terrain, track, structures, stock (locos/coaches), traffic, sky, cab, view
src/audio/    synthesised audio     src/ui/  HUD, screens, input, storage     src/vendor/  three.js
main.cjs      Electron main process (app:// protocol)     tools/  e2e.mjs, shot.mjs, bench.js, vendor.mjs
```

```bash
npm test          # 60 tests: physics, routes, timetables, rules, hints, fuzzing; bots drive every consist
npm run test:e2e  # real-click UI test in headless Chromium (needs Playwright)
```

Sources for the specifications: [WAP-7 (Wikipedia)](https://en.wikipedia.org/wiki/Indian_locomotive_class_WAP-7),
[loco-info](https://www.loco-info.com/view.aspx?id=13199), [LHB design notes](https://rskr.irimee.in/sites/default/files/LHB%20Salient%20Features.pdf).
