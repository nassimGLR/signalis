# LETHE-7

An original, browser-based survival-horror vertical slice in the style of late-90s
top-down sci-fi horror: low-poly models, a low-resolution PSX-style renderer,
ordered dithering and CRT scanlines, a six-slot inventory, quiet rooms, and
corrupted units that get back up.

Everything in it is made from scratch in code. That covers every model, texture,
sound effect, piece of music, map room and line of text. There are no external
assets.

> **Note on scope:** this project is *inspired by* the look and feel of games like
> SIGNALIS, but it is not a copy of any of them. The characters (Wren-3, Overseer
> Mara Ostrov), the setting (Lethe-7 Deep Survey Station), the story, the map and
> all art and audio are original.

## Play

```bash
npm install
npm run build        # writes dist/index.html, a single self-contained file
```

Open `dist/index.html` in a modern browser (Chrome, Firefox, Edge, Safari). No
server is needed. For development with auto-rebuild:

```bash
npm run dev          # http://localhost:8080
```

### Controls

| Action | Keyboard / mouse | Gamepad |
| --- | --- | --- |
| Move | WASD / arrow keys | Left stick / D-pad |
| Run | Shift | B / LB |
| Aim | Right mouse or Space (aim with mouse, or WASD to turn) | LT (right stick aims) |
| Fire | Left click or F while aiming | RT / X |
| Reload | R | Y |
| Interact / confirm | E or Enter | A |
| Inventory (items, files, map) | Tab or I | Select |
| Map | M | RB |
| Pause / back | Esc | Start |

You save at the red **Mnemonic Recorder** terminals in the Quiet Rooms. The
storage trunks in those rooms share their contents.

## The slice

You play custodian unit **WREN-3**, woken from maintenance sleep aboard a survey
station orbiting the gas giant Halcyon IV. The crew has gone quiet. Someone set
your wake timer by hand. The deck holds 14 rooms: cryo bay, corridors, two quiet
rooms, crew quarters, mess hall, security, medical, power relay, observation
deck, archive, and the communications array. Along the way you get two
memory flashbacks, three puzzles (a keypad, a power-bus relay, and a carrier
wave) and one ending. A full run takes about 20–30 minutes.

## How it's built

- **Engine:** [three.js](https://threejs.org) with a custom pipeline
  (`src/engine/renderer.js`):
  - the scene renders into a ~270-line render target with nearest filtering
  - vertices snap to the low-res grid (PSX "wobble")
  - a CRT composite pass adds colour grading, 4×4 Bayer dithering and
    quantisation, scanlines, barrel distortion, chromatic fringe, grain,
    signal-tear glitches, and damage and memory tints
- **Cutaway walls:** walls between the camera and the player drop to stubs in
  the vertex shader, so the top-down camera never loses sight of you.
- **Textures:** painted procedurally onto tiny canvases (`src/engine/textures.js`).
- **Characters:** articulated box-rigs with procedural walk, aim, reload, hurt
  and death animation (`src/engine/characters.js`).
- **Audio:** synthesised live with WebAudio (`src/engine/audio.js`): hull drone,
  radio static that rises near enemies, footsteps per floor type, gunfire, door
  servos, enemy voices, and a small generative score for the quiet rooms.
- **UI art:** item icons and flashback illustrations drawn with canvas
  primitives and dithered to small palettes (`src/ui/art.js`).

```
src/
  engine/   renderer, textures, characters, audio, input
  game/     map data, world builder, props, player, enemies, items, story, game loop
  ui/       HUD, menus, inventory/map/files, puzzles, memory screens, CSS
scripts/
  build.mjs   esbuild bundle → single-file dist/index.html
  shot.mjs    headless Playwright smoke test / screenshots
```

## Testing

```bash
node scripts/shot.mjs full   # tours every room, opens inventory/files/map
node scripts/shot.mjs play   # scripted playthrough from wake-up to ending
```

Screenshots go to `shots/`.
