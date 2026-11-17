# Echo Salvager — Night Shift 07

**The dark only exists when you listen. The things inside listen back.**

An original sonar-stealth salvage game for desktop browsers. Every visual is drawn using Canvas and the optional sound is synthesized locally. There are no runtime network calls, external assets, accounts or dependencies.

## Play

Open `game/index.html` in Chrome, or run a local static server:

```sh
python3 -m http.server 8000 --directory game
```

Then visit `http://127.0.0.1:8000`. The game works offline. No install or build step is required to play.

## Mission

Recover the three power cores in the abandoned transit vault, then reach the lift. Sonar reveals nearby corridors, pickups, and Wardens, but the Wardens follow the sound. Throw a decoy to pull them away. Pale-green relay stations restore all five sonar charges. You have three recovery attempts.

## Controls

- **WASD** or **arrow keys** — move (hold to continue)
- **Space** — send a sonar pulse
- **F**, then click a previously revealed open tile — throw a decoy
- **P** — pause or resume
- Sidebar buttons — sonar, decoy, pause, and optional sound

The lift remains locked until all three cores are recovered. At extraction, see time, hits and a three-star clean-run rating. Best time is stored locally in this browser only.

## Build the submission artifact

The official make.fun bounty uses Node.js 22.18 or later:

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts
```

This copies the playable static files and real screenshots into `out/` and generates `out/dossier.json` with the official unmodified `vendor/makefun-game.ts` library. `game/game.js` is the browser-executable game code; `game/logic-source.ts` is its identical editable source. The four screenshots are real browser captures. The project includes no third-party art, fonts or audio.

## License

Original game code and art: MIT License. The official vendored make.fun game dossier helper is included unchanged for the competition.
