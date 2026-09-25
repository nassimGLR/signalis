// LETHE-7, Habitation Ring, Deck 2.
// Tile (x, z) covers world [x, x+1] × [z, z+1]. North is -z (top of screen).
// Rooms are inclusive tile rectangles; door tiles sit in the one-tile gap
// between two rooms.

// sector: the station sector a room belongs to (see SECTORS).
// amb: optional per-room fill light [colour, intensity] applied while the
// player is in the room (world.js), on top of the level's ambient.
export const ROOMS = {
  A: { name: 'CRYO-MAINTENANCE', x0: 3, z0: 36, x1: 12, z1: 43, floor: 'plate', wall: 'panel', sector: '01', amb: [0x4a6a70, 0.9] },
  B: { name: 'CORRIDOR W-2', x0: 14, z0: 18, x1: 15, z1: 45, floor: 'grate', wall: 'panel', sector: '01' },
  C: { name: 'QUIET ROOM', x0: 7, z0: 20, x1: 12, z1: 25, floor: 'carpet', wall: 'wood', safe: true, sector: '01', amb: [0x6a5438, 1.2] },
  J: { name: 'POWER RELAY', x0: 4, z0: 28, x1: 12, z1: 33, floor: 'grate', wall: 'concrete', sector: '01' },
  G: { name: 'CENTRAL CONCOURSE', x0: 17, z0: 30, x1: 44, z1: 31, floor: 'plate', wall: 'panel', sector: '02', amb: [0x3a4650, 0.8] },
  D: { name: 'CREW QUARTERS', x0: 18, z0: 22, x1: 26, z1: 28, floor: 'plate', wall: 'panel', sector: '02' },
  H: { name: 'SECURITY', x0: 30, z0: 22, x1: 36, z1: 28, floor: 'concrete', wall: 'concrete', sector: '02' },
  E: { name: 'MESS HALL', x0: 18, z0: 33, x1: 28, z1: 41, floor: 'tile', wall: 'panel', sector: '02' },
  F: { name: 'MEDICAL BAY', x0: 31, z0: 33, x1: 38, z1: 39, floor: 'tile', wall: 'medical', sector: '02', amb: [0x4a6a6c, 0.8] },
  K: { name: 'CORRIDOR E-1', x0: 46, z0: 8, x1: 47, z1: 44, floor: 'grate', wall: 'panel', sector: '03' },
  L: { name: 'OBSERVATION DECK', x0: 49, z0: 16, x1: 60, z1: 22, floor: 'carpetSlate', wall: 'panel', window: true, sector: '03', amb: [0x3a4450, 0.8] },
  I: { name: 'ARCHIVE', x0: 49, z0: 25, x1: 57, z1: 33, floor: 'carpet', wall: 'wood', sector: '03', amb: [0x4a3c30, 0.8] },
  N: { name: 'QUIET ROOM', x0: 49, z0: 36, x1: 54, z1: 40, floor: 'carpet', wall: 'wood', safe: true, sector: '03', amb: [0x6a5438, 1.2] },
  M: { name: 'COMMUNICATIONS ARRAY', x0: 41, z0: 1, x1: 52, z1: 6, floor: 'grate', wall: 'concrete', sector: '04' },
};

// Station sectors: the unit of the map, the plan terminals and the sector
// title cards. Names are ours; the gloss is the Russian stencil beneath.
export const SECTORS = {
  '01': { code: '01', name: 'HABITATION — WEST', gloss: 'ЖИЛОЙ БЛОК — ЗАПАД', rooms: ['A', 'B', 'C', 'J'] },
  '02': { code: '02', name: 'CENTRAL CONCOURSE', gloss: 'ЦЕНТРАЛЬНЫЙ ВЕСТИБЮЛЬ', rooms: ['G', 'D', 'H', 'E', 'F'] },
  '03': { code: '03', name: 'EAST WING', gloss: 'ВОСТОЧНОЕ КРЫЛО', rooms: ['K', 'L', 'I', 'N'] },
  '04': { code: '04', name: 'ARRAY', gloss: 'АНТЕННАЯ РЕШЁТКА', rooms: ['M'] },
};

// lock: null | 'breaker' | 'code' | 'keycard' | 'power' | 'obol'
export const DOORS = [
  { id: 'dAB', x: 13, z: 39, a: 'A', b: 'B', lock: 'breaker', label: 'C-01' },
  { id: 'dCB', x: 13, z: 23, a: 'C', b: 'B', lock: null, label: 'Q-1' },
  { id: 'dJB', x: 13, z: 31, a: 'J', b: 'B', lock: 'code', label: 'PWR' },
  { id: 'dBG', x: 16, z: 30, a: 'B', b: 'G', lock: null, label: 'W-2' },
  { id: 'dDG', x: 22, z: 29, a: 'D', b: 'G', lock: null, label: 'CQ' },
  { id: 'dHG', x: 33, z: 29, a: 'H', b: 'G', lock: 'keycard', label: 'SEC' },
  { id: 'dGE', x: 23, z: 32, a: 'G', b: 'E', lock: null, label: 'MESS' },
  { id: 'dGF', x: 34, z: 32, a: 'G', b: 'F', lock: 'power', label: 'MED' },
  { id: 'dGK', x: 45, z: 30, a: 'G', b: 'K', lock: 'power', label: 'E-1', bulkhead: true },
  { id: 'dKL', x: 48, z: 19, a: 'K', b: 'L', lock: null, label: 'OBS' },
  { id: 'dKI', x: 48, z: 29, a: 'K', b: 'I', lock: null, label: 'ARC' },
  { id: 'dKN', x: 48, z: 38, a: 'K', b: 'N', lock: null, label: 'Q-2' },
  { id: 'dKM', x: 46, z: 7, a: 'K', b: 'M', lock: 'obol', label: 'COMMS', bulkhead: true },
];

// Point lights. power: 'always' | 'emergency' (only before power restored,
// reddish) | 'main' (only after power restored). pulse: Hz; pulseDepth: 0..1
// (default 0.5). Ceiling lights (y ≥ 2) get a lamp housing on the nearest
// north or side wall; there is no ceiling to hang them from.
//
// Lighting rules (plan §7.1): floors must read. Quiet rooms are warm sodium
// (#e9b872) with no red at all. Clinical rooms are pale teal-white.
// Emergency red is for corridors and the pre-power concourse.
export const LIGHTS = [
  // Cryo — cold teal-white over the pods, a red lamp by the dead door
  { room: 'A', x: 6, z: 38.6, color: 0xa6d8dc, i: 2.5, d: 7.5, flicker: 0.04 },
  { room: 'A', x: 10.5, z: 40.2, color: 0xc2e4e6, i: 2.7, d: 8, flicker: 0.02 },
  { room: 'A', x: 12.3, z: 39.2, y: 2.3, color: 0xff2020, i: 1.2, d: 4, pulse: 1.2 },
  // West corridor
  { room: 'B', x: 15, z: 21, color: 0xd8d0b8, i: 2.0, d: 7, flicker: 0.3 },
  { room: 'B', x: 15, z: 28, color: 0xd8d0b8, i: 2.2, d: 7, flicker: 0.02 },
  { room: 'B', x: 15, z: 35, color: 0xd8d0b8, i: 2.0, d: 7, flicker: 0.25 },
  { room: 'B', x: 15, z: 42, color: 0xff3030, i: 1.3, d: 5, pulse: 0.7 },
  // Quiet room — sodium over the backup deck, a bedside lamp, the deck's glow
  { room: 'C', x: 10, z: 21.6, y: 2.3, color: 0xe9b872, i: 3.0, d: 7.5 },
  { room: 'C', x: 8.2, z: 24.8, y: 1.3, color: 0xffd29a, i: 1.1, d: 4.5 },
  { room: 'C', x: 10, z: 21.0, y: 1.3, color: 0x9fe8e0, i: 0.5, d: 2.4 },
  // Relay — red emergency wash with an amber lamp on the relay panel
  { room: 'J', x: 8, z: 30.2, color: 0xff2a1a, i: 2.9, d: 8.5, pulse: 0.35, pulseDepth: 0.3, power: 'emergency' },
  { room: 'J', x: 8.5, z: 29.0, y: 1.5, color: 0xffb060, i: 0.8, d: 3.2, power: 'emergency', flicker: 0.05 },
  { room: 'J', x: 6, z: 30.5, color: 0xcfe6ff, i: 2.4, d: 8, power: 'main' },
  { room: 'J', x: 11, z: 32, color: 0xcfe6ff, i: 1.8, d: 7, power: 'main', flicker: 0.05 },
  // Concourse — before power: separate red emergency pools with neutral gaps
  // (the room's cool grey fill, ROOMS.G.amb) so the laser, blood and door
  // lamps still read between them; a vending glow. After power: four bright
  // white lights, clearly a different room.
  { room: 'G', x: 20, z: 30.9, color: 0xff2a20, i: 2.4, d: 3.4, pulse: 0.3, pulseDepth: 0.3, power: 'emergency' },
  { room: 'G', x: 27.5, z: 30.9, color: 0xff2a20, i: 2.4, d: 3.4, pulse: 0.3, pulseDepth: 0.3, power: 'emergency' },
  { room: 'G', x: 35, z: 30.9, color: 0xff2a20, i: 2.4, d: 3.4, pulse: 0.3, pulseDepth: 0.3, power: 'emergency' },
  { room: 'G', x: 42.5, z: 30.9, color: 0xff2a20, i: 2.2, d: 3.4, pulse: 0.3, pulseDepth: 0.3, power: 'emergency' },
  { room: 'G', x: 18.6, z: 31.1, y: 1.2, color: 0x8fc4cc, i: 0.8, d: 3.5, flicker: 0.1 },
  { room: 'G', x: 20.5, z: 31, color: 0xe4eeee, i: 2.9, d: 8, power: 'main', flicker: 0.02 },
  { room: 'G', x: 27, z: 31, color: 0xe4eeee, i: 2.9, d: 8, power: 'main' },
  { room: 'G', x: 33.5, z: 31, color: 0xe4eeee, i: 2.9, d: 8, power: 'main', flicker: 0.2 },
  { room: 'G', x: 40, z: 31, color: 0xe4eeee, i: 2.9, d: 8, power: 'main' },
  // Crew quarters
  { room: 'D', x: 22, z: 25.5, color: 0xe8c890, i: 2.0, d: 8, flicker: 0.04 },
  { room: 'D', x: 19.5, z: 23.5, y: 1.4, color: 0xffb070, i: 0.8, d: 3 },
  // Security
  { room: 'H', x: 33, z: 23.2, y: 1.3, color: 0x60ff9a, i: 1.4, d: 5 },
  { room: 'H', x: 34, z: 26, color: 0xd0d6d8, i: 1.5, d: 7, flicker: 0.4 },
  // Mess
  { room: 'E', x: 21, z: 36, color: 0xd8d8c8, i: 1.6, d: 7, flicker: 0.1 },
  { room: 'E', x: 26, z: 38, color: 0xd8d8c8, i: 1.4, d: 7, flicker: 0.6 },
  { room: 'E', x: 23, z: 41, color: 0xff3030, i: 0.8, d: 5, pulse: 0.9 },
  // Medical — clinical, pale teal-white
  { room: 'F', x: 34.5, z: 36, color: 0xc8f4f4, i: 2.6, d: 8, power: 'main', flicker: 0.05 },
  { room: 'F', x: 34.5, z: 36, color: 0xff2020, i: 0.8, d: 6, power: 'emergency', pulse: 0.4 },
  // East corridor
  { room: 'K', x: 47, z: 11, color: 0xd8e4e4, i: 1.9, d: 7 },
  { room: 'K', x: 47, z: 19, color: 0xd8e4e4, i: 1.9, d: 7, flicker: 0.3 },
  { room: 'K', x: 47, z: 27, color: 0xff3030, i: 1.4, d: 6, pulse: 0.8 },
  { room: 'K', x: 47, z: 33.5, color: 0xd8e4e4, i: 1.8, d: 7, flicker: 0.1 },
  { room: 'K', x: 47, z: 41, color: 0xd8e4e4, i: 1.6, d: 7, flicker: 0.4 },
  // Observation — planet light falls in along the whole window
  { room: 'L', x: 51.5, z: 17.4, y: 2.0, color: 0xffd8a8, i: 1.7, d: 8 },
  { room: 'L', x: 55.5, z: 17.4, y: 2.0, color: 0xffd8a8, i: 2.4, d: 10 },
  { room: 'L', x: 59.5, z: 17.4, y: 2.0, color: 0xffd8a8, i: 1.7, d: 8 },
  { room: 'L', x: 51, z: 21.5, color: 0x8090a0, i: 0.9, d: 6 },
  // Archive — the reading lamp, a dim ceiling light over the stacks
  { room: 'I', x: 53.5, z: 31, y: 1.3, color: 0xffc080, i: 2.2, d: 6, flicker: 0.03 },
  { room: 'I', x: 52.5, z: 27.4, color: 0xb8a080, i: 1.5, d: 8, flicker: 0.3 },
  // Quiet room 2 — sodium, bedside lamp, deck glow
  { room: 'N', x: 51.5, z: 37.4, y: 2.3, color: 0xe9b872, i: 3.0, d: 7 },
  { room: 'N', x: 53.6, z: 39.6, y: 1.3, color: 0xffd29a, i: 1.0, d: 4 },
  { room: 'N', x: 51.5, z: 37.0, y: 1.3, color: 0x9fe8e0, i: 0.5, d: 2.4 },
  // Comms
  { room: 'M', x: 47, z: 2.2, y: 1.6, color: 0xff2020, i: 2.8, d: 8, pulse: 0.25 },
  { room: 'M', x: 43, z: 5, color: 0x90a0b0, i: 1.45, d: 7, flicker: 0.2 },
  { room: 'M', x: 51, z: 5, color: 0x90a0b0, i: 1.45, d: 7 },
];

// Props: t = type. Positions are world units (tile corners are integers).
// r = rotation in quarter turns (0 = facing south/toward camera).
// Pipes run along the top of the wall whose face line is x/z (props.js), so
// the wall face stays clear for signs, posters and screens.
export const PROPS = [
  // ---------- A: Cryo ----------
  { room: 'A', t: 'cryoPod', x: 4.6, z: 36.7, r: 0 },
  { room: 'A', t: 'cryoPod', x: 6.6, z: 36.7, r: 0 },
  { room: 'A', t: 'cryoPod', x: 8.6, z: 36.7, r: 0 },
  { room: 'A', t: 'cryoPod', x: 10.6, z: 36.7, r: 0, open: true },
  { room: 'A', t: 'pipes', x: 3, z: 36, len: 10, axis: 'x' },
  { room: 'A', t: 'desk', x: 4.6, z: 42.8, r: 0 },
  { room: 'A', t: 'terminal', x: 4.6, z: 42.6, y: 0.78, r: 2, lines: ['CRYO CTL', 'POD 4 OPEN', '>_'], color: [110, 230, 200] },
  { room: 'A', t: 'chair', x: 5.4, z: 42.2, r: 1 },
  { room: 'A', t: 'locker', x: 3.3, z: 39.2, r: 3 },
  { room: 'A', t: 'locker', x: 3.3, z: 40.1, r: 3 },
  { room: 'A', t: 'locker', x: 3.3, z: 41.0, r: 3, open: true },
  { room: 'A', t: 'breaker', x: 12.95, z: 41.2, r: 1 },
  { room: 'A', t: 'crate', x: 12.1, z: 43.1, s: 0.8 },
  { room: 'A', t: 'crate', x: 11.3, z: 43.3, s: 0.6 },
  { room: 'A', t: 'decal', x: 8, z: 40.5, kind: 'oil', s: 2.2 },
  { room: 'A', t: 'sign', x: 8, z: 36.02, y: 2.35, text: 'CRYO-MAINT.', gloss: 'КРИОБЛОК', r: 0 },
  { room: 'A', t: 'poster', x: 12.2, z: 36.02, r: 0, kind: 3 },
  { room: 'A', t: 'hazardFloor', x: 3, z: 38.2, w: 10, d: 0.25 },
  { room: 'A', t: 'cable', x: 5, z: 39, x2: 9.5, z2: 38.2 },

  // ---------- B: West corridor ----------
  { room: 'B', t: 'debris', x: 14.9, z: 18.9 },
  { room: 'B', t: 'crate', x: 14.5, z: 19.8, s: 0.9, rot: 0.4 },
  { room: 'B', t: 'crate', x: 15.4, z: 20.4, s: 0.7, rot: -0.3 },
  { room: 'B', t: 'pipes', x: 14, z: 18, len: 28, axis: 'z' },
  { room: 'B', t: 'poster', x: 15.98, z: 26.5, r: 1, kind: 0 },
  { room: 'B', t: 'poster', x: 15.98, z: 36.5, r: 1, kind: 3 },
  { room: 'B', t: 'body', x: 14.8, z: 44.4, rot: 2.4 },
  { room: 'B', t: 'decal', x: 15, z: 44.2, kind: 'blood', s: 1.8 },
  { room: 'B', t: 'decal', x: 14.8, z: 33, kind: 'oil', s: 1.2 },
  { room: 'B', t: 'sign', x: 15, z: 18.02, y: 2.3, text: 'NO ACCESS', gloss: 'НЕТ ДОСТУПА', r: 0, red: true },

  // ---------- C: Quiet room ----------
  { room: 'C', t: 'backupDeck', x: 10, z: 20.36, r: 0 },
  { room: 'C', t: 'pneumaticLocker', x: 8.2, z: 20.25, r: 0 },
  { room: 'C', t: 'planTerminal', x: 11.95, z: 20.04, r: 0, sector: '01' },
  { room: 'C', t: 'sign', x: 10, z: 20.02, y: 2.35, text: 'QUIET ROOM', gloss: 'КОМНАТА ОТДЫХА', r: 0 },
  { room: 'C', t: 'bed', x: 7.6, z: 23.9, r: 1 },
  { room: 'C', t: 'sideTable', x: 12.3, z: 21, r: 0 },
  { room: 'C', t: 'radio', x: 12.3, z: 21, y: 0.62 },
  { room: 'C', t: 'plant', x: 12.4, z: 25.4 },
  { room: 'C', t: 'rug', x: 10, z: 23.5, w: 3, d: 2, kind: 'warm' },
  { room: 'C', t: 'poster', x: 7.02, z: 22.2, r: 3, kind: 2 },

  // ---------- J: Power relay ----------
  { room: 'J', t: 'transformer', x: 4.8, z: 29.5 },
  { room: 'J', t: 'transformer', x: 4.8, z: 31.5 },
  { room: 'J', t: 'relayPanel', x: 8.5, z: 28.25, r: 0 },
  { room: 'J', t: 'pipes', x: 4, z: 28, len: 9, axis: 'x' },
  { room: 'J', t: 'cable', x: 5.5, z: 30, x2: 8.3, z2: 28.8 },
  { room: 'J', t: 'cable', x: 5.5, z: 32, x2: 8.8, z2: 28.8 },
  { room: 'J', t: 'hazardFloor', x: 6.5, z: 28.6, w: 4, d: 0.25 },
  { room: 'J', t: 'crate', x: 12.2, z: 28.8, s: 0.8 },
  { room: 'J', t: 'sign', x: 8.5, z: 28.02, y: 2.35, text: 'HIGH VOLTAGE', gloss: 'ВЫСОКОЕ НАПРЯЖЕНИЕ', r: 0, red: true },

  // ---------- G: Concourse ----------
  { room: 'G', t: 'vending', x: 18.6, z: 30.35, r: 0 },
  { room: 'G', t: 'bench', x: 27, z: 30.4, r: 0 },
  { room: 'G', t: 'bench', x: 39, z: 30.4, r: 0 },
  { room: 'G', t: 'poster', x: 25, z: 30.02, r: 0, kind: 0 },
  { room: 'G', t: 'poster', x: 30.5, z: 30.02, r: 0, kind: 1 },
  { room: 'G', t: 'poster', x: 37, z: 30.02, r: 0, kind: 4 },
  { room: 'G', t: 'poster', x: 41.5, z: 30.02, r: 0, kind: 2 },
  { room: 'G', t: 'planTerminal', x: 28.4, z: 30.04, r: 0, sector: '02' },
  { room: 'G', t: 'sign', x: 19.4, z: 30.02, y: 2.3, text: 'DECK 2 / HAB', gloss: 'ПАЛУБА 2 · ЖИЛОЙ', r: 0 },
  { room: 'G', t: 'decal', x: 38.5, z: 31.5, kind: 'blood', s: 1.6 },
  { room: 'G', t: 'decal', x: 30, z: 31.2, kind: 'oil', s: 1.2 },
  { room: 'G', t: 'hazardFloor', x: 44, z: 30, w: 0.3, d: 2 },
  { room: 'G', t: 'pipes', x: 17, z: 30, len: 28, axis: 'x' },

  // ---------- D: Crew quarters ----------
  { room: 'D', t: 'bunk', x: 19.6, z: 22.9, r: 0 },
  { room: 'D', t: 'bunk', x: 22.4, z: 22.9, r: 0 },
  { room: 'D', t: 'bunk', x: 25.2, z: 22.9, r: 0 },
  { room: 'D', t: 'locker', x: 26.7, z: 25.0, r: 1 },
  { room: 'D', t: 'locker', x: 26.7, z: 25.9, r: 1 },
  { room: 'D', t: 'locker', x: 26.7, z: 26.8, r: 1 },
  { room: 'D', t: 'table', x: 21.5, z: 26.5, w: 2.0, d: 1.1 },
  { room: 'D', t: 'chair', x: 20.4, z: 26.5, r: 1 },
  { room: 'D', t: 'chair', x: 22.6, z: 26.8, r: 3, fallen: true },
  { room: 'D', t: 'lamp', x: 19.2, z: 24.2, y: 0.95 },
  { room: 'D', t: 'rug', x: 21.5, z: 26.5, w: 3.2, d: 2.2, kind: 'felt' },
  { room: 'D', t: 'poster', x: 18.02, z: 26, r: 3, kind: 4 },
  { room: 'D', t: 'sign', x: 22.4, z: 22.02, y: 2.35, text: 'CREW', gloss: 'ЭКИПАЖ', r: 0, w: 1.1 },

  // ---------- H: Security ----------
  { room: 'H', t: 'desk', x: 33, z: 22.7, r: 0, w: 3.2 },
  { room: 'H', t: 'monitorBank', x: 33, z: 22.25, r: 0 },
  { room: 'H', t: 'chair', x: 33, z: 23.8, r: 2 },
  { room: 'H', t: 'cabinet', x: 30.35, z: 24, r: 3 },
  { room: 'H', t: 'cabinet', x: 30.35, z: 25, r: 3 },
  { room: 'H', t: 'rack', x: 36.7, z: 25.5, r: 1 },
  { room: 'H', t: 'sign', x: 34.9, z: 22.02, y: 2.35, text: 'SECURITY', gloss: 'ОХРАНА', r: 0, w: 1.2 },
  { room: 'H', t: 'poster', x: 30.02, z: 27.2, r: 3, kind: 1 },
  { room: 'H', t: 'decal', x: 34.5, z: 27, kind: 'blood', s: 1.4 },
  { room: 'H', t: 'crate', x: 36.3, z: 28.3, s: 0.7 },

  // ---------- E: Mess hall ----------
  { room: 'E', t: 'table', x: 21, z: 36.5, w: 1.2, d: 3.2 },
  { room: 'E', t: 'table', x: 25, z: 36.5, w: 1.2, d: 3.2 },
  { room: 'E', t: 'bench', x: 20.1, z: 36.5, r: 1, len: 3 },
  { room: 'E', t: 'bench', x: 21.9, z: 36.5, r: 1, len: 3 },
  { room: 'E', t: 'bench', x: 24.1, z: 36.5, r: 1, len: 3 },
  { room: 'E', t: 'bench', x: 25.9, z: 36.5, r: 1, len: 3, fallen: true },
  { room: 'E', t: 'counter', x: 28.55, z: 35.5, len: 4, r: 1 },
  { room: 'E', t: 'chair', x: 22.5, z: 40, r: 2, fallen: true },
  { room: 'E', t: 'decal', x: 23, z: 38.5, kind: 'oil', s: 2 },
  { room: 'E', t: 'decal', x: 19.5, z: 40.5, kind: 'blood', s: 1.5 },
  { room: 'E', t: 'tray', x: 21, z: 35.6 }, { room: 'E', t: 'tray', x: 25.1, z: 37.4 },
  { room: 'E', t: 'poster', x: 23, z: 33.02, r: 0, kind: 3 },
  { room: 'E', t: 'sign', x: 26.5, z: 33.02, y: 2.3, text: 'RATIONS', gloss: 'ПАЁК', r: 0, w: 1.1 },

  // ---------- F: Medical ----------
  { room: 'F', t: 'medBed', x: 31.8, z: 34.3, r: 1 },
  { room: 'F', t: 'medBed', x: 31.8, z: 36.5, r: 1 },
  { room: 'F', t: 'medBed', x: 31.8, z: 38.7, r: 1 },
  { room: 'F', t: 'cabinet', x: 35, z: 33.35, r: 0, white: true },
  { room: 'F', t: 'cabinet', x: 36, z: 33.35, r: 0, white: true },
  { room: 'F', t: 'curtain', x: 33, z: 35.4, len: 1.6, axis: 'x' },
  { room: 'F', t: 'desk', x: 37.8, z: 38.8, r: 1 },
  { room: 'F', t: 'terminal', x: 38, z: 38.8, y: 0.78, r: 1, lines: ['MED-SYS', 'PATIENT W3', 'WIPES: 14'], color: [120, 220, 255] },
  { room: 'F', t: 'sign', x: 33, z: 33.02, y: 2.35, text: 'MEDICAL', gloss: 'МЕДПУНКТ', r: 0, w: 1.2 },
  { room: 'F', t: 'decal', x: 35, z: 37.5, kind: 'blood', s: 2 },

  // ---------- K: East corridor ----------
  { room: 'K', t: 'pipes', x: 48, z: 8, len: 37, axis: 'z' },
  { room: 'K', t: 'poster', x: 46.02, z: 14, r: 3, kind: 2 },
  { room: 'K', t: 'poster', x: 46.02, z: 33, r: 3, kind: 0 },
  { room: 'K', t: 'poster', x: 47.98, z: 24, r: 1, kind: 4 },
  { room: 'K', t: 'crate', x: 46.5, z: 43.6, s: 0.8 },
  { room: 'K', t: 'decal', x: 47, z: 24, kind: 'blood', s: 1.5 },
  { room: 'K', t: 'hazardFloor', x: 46, z: 8.1, w: 2, d: 0.25 },
  { room: 'K', t: 'sign', x: 47, z: 8.02, y: 2.3, text: 'ARRAY ACCESS', gloss: 'К АНТЕННЕ', r: 0, red: true },

  // ---------- L: Observation ----------
  { room: 'L', t: 'bench', x: 52, z: 19.2, r: 0, len: 2.4 },
  { room: 'L', t: 'bench', x: 57, z: 19.2, r: 0, len: 2.4 },
  { room: 'L', t: 'telescope', x: 59.5, z: 17.2 },
  { room: 'L', t: 'plant', x: 49.5, z: 22.5 },
  { room: 'L', t: 'plant', x: 60.5, z: 22.5 },
  { room: 'L', t: 'rail', x: 49, z: 16.9, len: 12 },

  // ---------- I: Archive ----------
  { room: 'I', t: 'shelf', x: 50.5, z: 26, r: 0, len: 3 },
  { room: 'I', t: 'shelf', x: 54.5, z: 26, r: 0, len: 3 },
  { room: 'I', t: 'shelf', x: 50.5, z: 28.5, r: 0, len: 3 },
  { room: 'I', t: 'shelf', x: 54.5, z: 28.5, r: 0, len: 3 },
  { room: 'I', t: 'shelf', x: 57.7, z: 30.5, r: 3, len: 3 },
  { room: 'I', t: 'desk', x: 53.5, z: 31.2, r: 0, w: 2, wood: true },
  { room: 'I', t: 'lamp', x: 52.9, z: 31.2, y: 0.78 },
  { room: 'I', t: 'chair', x: 53.5, z: 32.2, r: 2 },
  { room: 'I', t: 'bookPile', x: 50, z: 32.8 },
  { room: 'I', t: 'bookPile', x: 56.3, z: 33.2 },
  { room: 'I', t: 'rug', x: 53.5, z: 31.5, w: 3.4, d: 1.4, kind: 'runner' },
  { room: 'I', t: 'sign', x: 52.5, z: 25.02, y: 2.35, text: 'ARCHIVE', gloss: 'АРХИВ', r: 0, w: 1.1 },

  // ---------- N: Quiet room 2 ----------
  { room: 'N', t: 'backupDeck', x: 51.5, z: 36.36, r: 0 },
  { room: 'N', t: 'pneumaticLocker', x: 49.95, z: 36.25, r: 0 },
  { room: 'N', t: 'planTerminal', x: 53.7, z: 36.04, r: 0, sector: '03' },
  { room: 'N', t: 'sign', x: 51.5, z: 36.02, y: 2.35, text: 'QUIET ROOM', gloss: 'КОМНАТА ОТДЫХА', r: 0 },
  { room: 'N', t: 'bed', x: 54.4, z: 39.3, r: 3 },
  { room: 'N', t: 'plant', x: 49.4, z: 40.5 },
  { room: 'N', t: 'rug', x: 51.5, z: 38.6, w: 2.4, d: 1.8, kind: 'warm' },

  // ---------- M: Comms ----------
  { room: 'M', t: 'commsConsole', x: 47, z: 1.6, r: 0 },
  { room: 'M', t: 'antennaCore', x: 42.6, z: 2.6 },
  { room: 'M', t: 'antennaCore', x: 51.4, z: 2.6 },
  { room: 'M', t: 'transformer', x: 41.8, z: 5.5 },
  { room: 'M', t: 'cable', x: 43, z: 3, x2: 46, z2: 2.2 },
  { room: 'M', t: 'cable', x: 51, z: 3, x2: 48, z2: 2.2 },
  { room: 'M', t: 'cable', x: 42.5, z: 5, x2: 45.5, z2: 6.5 },
  { room: 'M', t: 'hazardFloor', x: 45, z: 3.2, w: 4, d: 0.25 },
  { room: 'M', t: 'planTerminal', x: 44.3, z: 1.04, r: 0, sector: '04' },
];

// Pickups. kind 'item' goes to inventory; kind 'file' goes to the archive;
// `module` is clipped to the harness (the receiver) and takes no slot.
//
// Economy (plan §7.2, D2): 25 rounds lie on the critical path (8 loaded +
// B 4, H 4, J 5, I 4) against seven Hollows there, at ~2–3 rounds a kill
// with a settled focus box and a stomp to finish (a crit knockdown plus a
// stomp costs one; a prong plus a stomp costs none). The keyboard route in
// `shot.mjs play` fights five of them, prongs the Warden, sneaks past the
// archive one, and ends with about 7–11. Side rooms (E, K south, F) hold a
// little more, for the fights they hold. Flares (burn a body for good) sit
// in both quiet rooms, Security and the archive; prongs in the relay room
// and medical.
export const PICKUPS = [
  { id: 'p_sealant_A', room: 'A', x: 4.2, z: 42.7, y: 0.8, item: 'sealant', qty: 1 },
  { id: 'p_note_A', room: 'A', x: 5.0, z: 42.6, y: 0.8, file: 'directive' },
  { id: 'p_ammo_B', room: 'B', x: 15.3, z: 44.6, item: 'ammo', qty: 4 },
  { id: 'p_note_C', room: 'C', x: 12.3, z: 21.2, y: 0.62, file: 'quiet' },
  { id: 'p_flare_C', room: 'C', x: 9.2, z: 24.9, item: 'flare', qty: 1 },
  { id: 'p_ammo_J', room: 'J', x: 12.2, z: 28.8, y: 0.8, item: 'ammo', qty: 5 },
  { id: 'p_prong_J', room: 'J', x: 6.4, z: 32.7, item: 'prong', qty: 2 },
  { id: 'p_sealant_G', room: 'G', x: 42.5, z: 30.6, item: 'sealant', qty: 1 },
  { id: 'p_photo_D', room: 'D', x: 22.3, z: 23.4, y: 0.55, item: 'photo', qty: 1 },
  { id: 'p_letter_D', room: 'D', x: 21.2, z: 26.4, y: 0.78, file: 'letter' },
  { id: 'p_bulletin_H', room: 'H', x: 32.2, z: 22.8, y: 0.8, file: 'bulletin' },
  { id: 'p_rx_H', room: 'H', x: 34.2, z: 22.75, y: 0.8, module: 'receiver' },
  { id: 'p_ammo_H', room: 'H', x: 36.3, z: 28.3, y: 0.72, item: 'ammo', qty: 4 },
  { id: 'p_flare_H', room: 'H', x: 36.0, z: 24.4, item: 'flare', qty: 1 },
  { id: 'p_ammo_E', room: 'E', x: 28.4, z: 34.6, y: 1.0, item: 'ammo', qty: 6 },
  { id: 'p_nanite_E', room: 'E', x: 28.2, z: 41.3, item: 'nanite', qty: 1 },
  { id: 'p_notice_E', room: 'E', x: 25.2, z: 35.5, y: 0.78, file: 'mess' },
  { id: 'p_nanite_F', room: 'F', x: 35, z: 33.7, y: 1.0, item: 'nanite', qty: 1 },
  { id: 'p_sealant_F', room: 'F', x: 36, z: 33.7, y: 1.0, item: 'sealant', qty: 2 },
  { id: 'p_prong_F', room: 'F', x: 33.3, z: 38.6, item: 'prong', qty: 1 },
  { id: 'p_medlog_F', room: 'F', x: 37.6, z: 38.4, y: 0.8, file: 'medical' },
  { id: 'p_ammo_K', room: 'K', x: 46.5, z: 43.6, y: 0.82, item: 'ammo', qty: 6 },
  { id: 'p_obslog_L', room: 'L', x: 57, z: 19.4, y: 0.5, file: 'observation' },
  { id: 'p_book_I', room: 'I', x: 50.1, z: 32.7, y: 0.4, file: 'lethe' },
  { id: 'p_journal_I', room: 'I', x: 54.0, z: 31.1, y: 0.8, file: 'final' },
  { id: 'p_obol_I', room: 'I', x: 53.1, z: 31.3, y: 0.8, item: 'obol', qty: 1 },
  { id: 'p_ammo_I', room: 'I', x: 56.5, z: 25.6, item: 'ammo', qty: 4 },
  { id: 'p_flare_I', room: 'I', x: 55.6, z: 32.6, item: 'flare', qty: 1 },
  { id: 'p_sealant_N', room: 'N', x: 53.5, z: 36.6, item: 'sealant', qty: 1 },
  { id: 'p_flare_N', room: 'N', x: 50.8, z: 39.6, item: 'flare', qty: 1 },
];

// Hollows. state: 'dormant' (slumped, wakes when you come near or make a
// noise close by) | 'idle' (stands; sees in a cone, hears footsteps and
// shots). spawn: 'power' → only appears once power is restored. wake: sight
// radius for a dormant one (0 = only a script wakes it). variant: 0–2 are
// Lurchers in three tones; 'rusher' lunges; 'warden' carries a plate.
//
// Pacing (plan §7.1): small groups in the concourse (G) and the mess (E);
// the crew quarters (D) and the observation deck (L) are left empty. Every
// Hollow revives once downed unless it is finished or burned.
export const ENEMIES = [
  // concourse: one slumped by the medical door, one standing facing the wall
  // further east; a fight with the first one brings the second
  { id: 'e_G1', room: 'G', x: 38.5, z: 31.4, rot: 0, state: 'dormant', wake: 5.5 },
  { id: 'e_G2', room: 'G', x: 43.4, z: 30.55, rot: 2, state: 'idle', variant: 2 },
  // mess: a group of three, a Rusher by the counter
  { id: 'e_E1', room: 'E', x: 26.5, z: 39.5, rot: 2, state: 'idle', variant: 1 },
  { id: 'e_E2', room: 'E', x: 18.7, z: 40.6, rot: 1, state: 'dormant', wake: 4 },
  { id: 'e_E3', room: 'E', x: 27.0, z: 36.6, rot: 1, state: 'idle', variant: 'rusher' },
  { id: 'e_H1', room: 'H', x: 35, z: 26.5, rot: 3, state: 'idle', variant: 2 },
  { id: 'e_J1', room: 'J', x: 11.8, z: 33.2, rot: 3, state: 'dormant', wake: 0, spawn: 'power' },
  { id: 'e_F1', room: 'F', x: 37.6, z: 35.2, rot: 3, state: 'dormant', wake: 4, variant: 1 },
  // east corridor: the Warden holds the north end, by the array door
  { id: 'e_K1', room: 'K', x: 46.8, z: 14, rot: 0, state: 'idle', spawn: 'power', variant: 'warden' },
  { id: 'e_K2', room: 'K', x: 47, z: 36, rot: 0, state: 'idle', spawn: 'power' },
  { id: 'e_I1', room: 'I', x: 56.8, z: 26.4, rot: 3, state: 'dormant', wake: 4 },
];

// Interactive fixtures (beyond pickups and doors). kind 'save' is the backup
// deck, 'box' the pneumatic locker. Plan terminals are 'examine' fixtures
// with a `plan` sector code, so older game code simply reads their text.
export const FIXTURES = [
  { id: 'f_pod', room: 'A', x: 10.6, z: 37.3, r: 1.1, kind: 'examine', text: 'pod_open' },
  { id: 'f_pods', room: 'A', x: 6.6, z: 37.3, r: 2.2, kind: 'examine', text: 'pod_closed' },
  { id: 'f_locker', room: 'A', x: 3.8, z: 41.0, r: 0.9, kind: 'locker_pistol' },
  { id: 'f_lockers_A', room: 'A', x: 3.8, z: 39.6, r: 0.8, kind: 'examine', text: 'locker_empty' },
  { id: 'f_breaker_A', room: 'A', x: 12.5, z: 41.2, r: 0.9, kind: 'breaker' },
  { id: 'f_save_C', room: 'C', x: 10, z: 20.95, r: 1.0, kind: 'save' },
  { id: 'f_box_C', room: 'C', x: 8.2, z: 20.85, r: 0.9, kind: 'box' },
  { id: 'f_plan_C', room: 'C', x: 11.95, z: 20.6, r: 0.8, kind: 'examine', text: 'plan_01', plan: '01' },
  { id: 'f_radio_C', room: 'C', x: 12.2, z: 21.6, r: 0.7, kind: 'examine', text: 'radio' },
  { id: 'f_bed_C', room: 'C', x: 8.2, z: 23.9, r: 1.0, kind: 'examine', text: 'bed' },
  { id: 'f_debris', room: 'B', x: 14.9, z: 20.2, r: 1.2, kind: 'examine', text: 'debris' },
  { id: 'f_body_B', room: 'B', x: 14.8, z: 44.0, r: 0.9, kind: 'examine', text: 'body' },
  { id: 'f_relay', room: 'J', x: 8.5, z: 28.9, r: 1.0, kind: 'relay' },
  { id: 'f_transformer', room: 'J', x: 5.4, z: 30.5, r: 1.2, kind: 'examine', text: 'transformer' },
  { id: 'f_vending', room: 'G', x: 18.6, z: 30.9, r: 0.9, kind: 'examine', text: 'vending' },
  { id: 'f_plan_G', room: 'G', x: 28.4, z: 30.55, r: 0.8, kind: 'examine', text: 'plan_02', plan: '02' },
  { id: 'f_locker_D', room: 'D', x: 26.2, z: 25.9, r: 1.0, kind: 'locker_keycard' },
  { id: 'f_bunks_D', room: 'D', x: 19.6, z: 23.6, r: 0.9, kind: 'examine', text: 'bunk' },
  { id: 'f_monitors', room: 'H', x: 33.8, z: 23.0, r: 0.9, kind: 'examine', text: 'monitors' },
  { id: 'f_cabinet_H', room: 'H', x: 30.8, z: 24.5, r: 1.0, kind: 'cabinet_fuse' },
  { id: 'f_rack', room: 'H', x: 36.2, z: 25.5, r: 0.9, kind: 'examine', text: 'rack' },
  { id: 'f_counter', room: 'E', x: 28, z: 36.5, r: 1.0, kind: 'examine', text: 'counter' },
  { id: 'f_medbed', room: 'F', x: 32.4, z: 36.5, r: 1.0, kind: 'examine', text: 'medbed' },
  { id: 'f_window', room: 'L', x: 55, z: 17.3, r: 3.2, kind: 'memory_window' },
  { id: 'f_telescope', room: 'L', x: 59.3, z: 17.8, r: 0.9, kind: 'examine', text: 'telescope' },
  { id: 'f_shelves', room: 'I', x: 52.5, z: 27.1, r: 1.6, kind: 'examine', text: 'shelves' },
  { id: 'f_save_N', room: 'N', x: 51.5, z: 36.95, r: 1.0, kind: 'save' },
  { id: 'f_box_N', room: 'N', x: 49.95, z: 36.85, r: 0.9, kind: 'box' },
  { id: 'f_plan_N', room: 'N', x: 53.7, z: 36.6, r: 0.8, kind: 'examine', text: 'plan_03', plan: '03' },
  { id: 'f_console', room: 'M', x: 47, z: 2.6, r: 1.2, kind: 'console' },
  { id: 'f_antenna', room: 'M', x: 42.6, z: 3.4, r: 1.0, kind: 'examine', text: 'antenna' },
  { id: 'f_plan_M', room: 'M', x: 44.3, z: 1.6, r: 0.8, kind: 'examine', text: 'plan_04', plan: '04' },
];

export const PLAYER_START = { x: 10.6, z: 38.6, rot: 0 };

export const GRID_W = 64;
export const GRID_H = 48;
