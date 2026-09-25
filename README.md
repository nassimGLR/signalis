# LETHE-7

An original, browser-based survival-horror vertical slice in the style of late-90s
top-down sci-fi horror: low-poly models rendered crisp at about 360 lines and
scaled up by whole pixels, a restrained posterised palette, a silent screen, a
six-slot inventory in the unit's own maintenance OS, quiet rooms with a tape
backup deck, and corrupted units that get back up.

Everything in it is made from scratch in code: every model, texture, sound
effect, piece of music, map room and line of text. The only files that are not
code are the embedded fonts, which are SIL Open Font License fonts (see
[Fonts](#fonts)).

> **Note on scope:** this project is *inspired by* the look and feel of games like
> SIGNALIS, but it is not a copy of any of them. The characters (Wren-3, Overseer
> Mara Ostrov, the Hollows), the setting (Lethe-7 Deep Survey Station), the story,
> the map, the interface and all art and audio are original.

## Play

```bash
npm install
npm run build        # writes dist/index.html, a single self-contained file
```

Open `dist/index.html` in a modern browser (Chrome, Firefox, Edge, Safari). No
server or network is needed. For development with auto-rebuild:

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
  `»` after its verb means "out of reach — click to walk there". A click is
  anything shorter than a hold-walk, or a press released within about half a
  second without moving the pointer.
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

### Saving, storage and the map

- **Backup deck.** Each quiet room holds a wall-mounted tape backup deck. Use it
  and choose WRITE BACKUP: the reels turn, the tape spools, and the system log
  reads BACKUP WRITTEN. RESTORE on the title screen (or RESTORE LAST BACKUP
  after a death) picks up from the last backup.
- **Pneumatic locker.** Beside each deck is a pneumatic locker with 24 bays.
  Both lockers share their contents, so what you send down the tube in one quiet
  room is waiting in the other.
- **Sector plans.** A plan terminal in each sector puts that sector's rooms on
  the map (drawn dashed until you enter them). Doors show their state on the
  map only after you have tried them: open, needs an item or code, or sealed.
- **Inventory (L7 Custodian OS).** Six clip points. Drag rounds onto the
  sidearm to load it, drag a part stack onto the same item to merge it, EQUIP
  or stow the weapon, INSPECT anything (drag to turn it, TURN OVER to see the
  back), and DISCARD what you no longer need (key items and memories stay).

### The screen

There is no permanent HUD: no room name, no ammo counter, no objective text.
Pickups and thoughts appear in the text box at the bottom; system events
(FILED, BACKUP WRITTEN, MAP UPDATED) go to a short log at the top left; a title
card names each sector as you enter it; hints appear once. Condition shows in
Wren herself (she limps, clutches her side, slows), in the colour of her collar
lamp, in the drained picture at FAILING and CRITICAL, and in the inventory's
condition readout. The picture glitches only for events: hits, crits, memories,
power, and a Hollow chasing close behind you.

## The slice

You play custodian unit **WREN-3**, woken from maintenance sleep aboard a survey
station orbiting the gas giant Halcyon IV. The crew has gone quiet. Someone
signed your wake order by hand. The deck holds 14 rooms in four sectors: cryo
bay, corridors, two quiet rooms, crew quarters, mess hall, security, medical,
power relay, observation deck, archive, and the communications array. Along the
way you get two memory flashbacks, three puzzles (a keypad, a power-bus relay,
and a carrier wave) and one ending. A full run takes about 20–30 minutes.

## How it's built

- **Engine:** [three.js](https://threejs.org) with a custom pipeline
  (`src/engine/renderer.js`):
  - the scene renders into a low-resolution target (AUTO: about 360 lines) with
    nearest filtering, then scales up by a whole number, letterboxing the rest,
    so every scene pixel is an exact square block
  - one post pass grades it (a light saturation lift that lets signal reds
    through, a mild S-curve, lifted shadows), posterises to about 20 levels with
    a light 4×4 Bayer dither, and adds event effects: row tears, a signal-loss
    sweep, a red split, the drained menu backdrop, the memory tint
  - CRT scanlines and curvature and film grain are still there as options, off
    by default; the PSX vertex wobble comes back only at the lowest resolution
    setting
- **Cutaway walls:** walls between the camera and the player drop to stubs in
  the vertex shader, so the top-down camera never loses sight of you.
- **Textures:** painted procedurally onto tiny canvases (`src/engine/textures.js`),
  including a hand-pixelled 5-row font for signs and screens, with Cyrillic.
- **Characters:** tapered low-poly bodies built from a small geometry kit
  (`src/engine/meshkit.js`), a single rigidly skinned mesh per body, with layered procedural
  animation: planted-foot walk and run, head look, aim, reload, reach, stomp,
  hurt, four condition postures and a death fall (`src/engine/characters.js`).
  The Hollows have their own corrupted designs and a pose for every state.
- **Controls:** mouse-first movement with A* pathing (`src/game/nav.js`),
  hover brackets, the focus box and the state cursor (`src/game/controls.js`,
  `src/ui/cursor.js`).
- **Interface:** the Custodian OS (items, map, files; the receiver tab waits
  for its module), device-face
  puzzles, the locker, and the text box (`src/ui/ui.js`). Items are small 3D
  models (`src/ui/items3d.js`) rendered for the inventory and placed in the
  world as pickups.
- **Audio:** synthesised live with WebAudio (`src/engine/audio.js`): hull drone,
  radio static that rises near enemies, footsteps per floor type, gunfire, door
  relays and latches, tape spool and pneumatic thunks, enemy voices, a
  heartbeat, and a small generative score for the quiet rooms. The world is
  muffled while a menu is open.

```
src/
  engine/   renderer, textures, characters, meshkit, audio, input
  game/     map data, world builder, props, player, controls, nav, enemies,
            items, story, game loop
  ui/       text box, Custodian OS, map/files, puzzles, memory screens,
            item models, cursor overlay, CSS
assets/
  fonts/    embedded OFL fonts, their licence and the subsetting script
scripts/
  build.mjs        esbuild bundle → single-file dist/index.html (fonts inlined)
  shot.mjs         headless Playwright checks and screenshots (see Testing)
  ui-shots.mjs     every interface screen, driven by the mouse
  world-shots.mjs  lighting, post and prop checks per room
  rig-sheet.mjs    pose sheets and numeric checks for the character rigs
```

## Fonts

The interface fonts are embedded in `dist/index.html` as data URIs. All of them
are licensed under the **SIL Open Font License 1.1**; the full licence and the
copyright notices are in `assets/fonts/OFL.txt`, and the build copies that
notice into the output. `assets/fonts/subset.py` rebuilds the subsets from the
upstream Google Fonts files.

- **Sofia Sans Condensed** (labels, headings, dialogue). Its Russian Cyrillic
  letterforms are made the default.
- **L7 Mono** is a renamed subset of **IBM Plex Mono** (numbers, codes, logs).
  "Plex" is a Reserved Font Name, so the modified subset carries its own name.
- **Michroma** (the logo only).
- **L7 Hand** is a renamed subset of **Reenie Beanie** (handwritten notes).

## Testing

```bash
node scripts/shot.mjs basic  # boots, starts a game, checks for errors
node scripts/shot.mjs full   # tours every room, opens inventory/files/map
node scripts/shot.mjs play   # keyboard playthrough (F interacts, J fires) to the ending
node scripts/shot.mjs mouse  # click-to-go, hold-walk, click-to-use, doors, aim/focus, cursor
node scripts/shot.mjs touch  # phone-sized: tap to go, tap to use
node scripts/ui-shots.mjs    # every screen by mouse, at 1280×720 and 412×860
node scripts/world-shots.mjs --native-cam   # per-room luma, post effects, props
node scripts/rig-sheet.mjs   # character pose sheets and rig checks
```

Each check prints `PASS …` or `FAIL …`, and the script exits 1 if any fail.
Screenshots go to `shots/`.
