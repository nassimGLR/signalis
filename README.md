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

The mouse drives everything; the keyboard and a gamepad are full equivalents.

| Action | Mouse | Keyboard | Gamepad |
| --- | --- | --- | --- |
| Walk toward the pointer | Hold left button | WASD / arrow keys | Left stick |
| Go to a spot / use a thing | Click the floor, or click a thing or its white bracket | — | — |
| Run | Shift + any movement, or double-click a destination | Shift (hold, or toggle in Options) | B (hold) |
| Ready weapon | Hold right button | Space | LT |
| Fire | Left button while ready | J | RT |
| Interact / finish | Click it | F (E also works) | A |
| Reload | Forward side button (Mouse 5) | R | RB |
| Use tool | Back side button (Mouse 4) | C | LB |
| Receiver on / off | Middle click | T | View / Select |
| Tune (receiver on) | Wheel | Q / E | D-pad ◂ ▸ |
| Inventory (items, files, map) | — | Tab / I | X |
| Map | — | M / Caps Lock | Y |
| Pause | — | Esc / P | Start |
| Menu confirm / back | Click / right button | Enter, Space, E / Esc, Backspace, Q, Tab | A / B |

- Things within reach get white corner brackets and a verb (TAKE, READ, OPEN…).
  Point at one and click to walk over and use it. A bracket drawn faint with
  footprints means "out of reach — click to walk there".
- Readying locks onto the Hollow under the pointer (or the nearest one when you
  ready with Space or LT). A box closes around it while you hold steady: a
  closed red box hits harder and more often critically. A cross in the box means
  no line of sight. Walking with the keys while ready is slow; the mouse alone
  keeps you planted.
- With the pointer resting, Wren turns her head, then her body and chest lamp,
  toward it. Options can turn this off, set movement to keys only, change when
  the aim cursor shows, run to far points, show the walk path, and make run or
  ready a toggle.
- On touch screens, tap the floor to go and tap a thing to use it; the stick and
  buttons do the rest.

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
node scripts/shot.mjs play   # keyboard playthrough (F interacts, J fires) to the ending
node scripts/shot.mjs mouse  # click-to-go, hold-walk, click-to-use, doors, aim/focus, cursor
node scripts/shot.mjs touch  # phone-sized: tap to go, tap to use
```

Each check prints `PASS …` or `FAIL …`, and the script exits 1 if any fail.
Screenshots go to `shots/`.
