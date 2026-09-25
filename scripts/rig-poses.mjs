// Pose tables + drivers shared by the rig sheet page (browser) and the numeric
// checks in scripts/rig-sheet.mjs (Node), so the checks test exactly the
// poses the sheets show.
import * as CH from '../src/engine/characters.js';

const PI = Math.PI;

// [label, yaw, state, frames?]
export const WREN_POSES = [
  ['IDLE · FRONT', 0, {}],
  ['IDLE · SIDE', PI / 2, {}],
  ['IDLE · BACK', PI, {}],
  ['IDLE · 3/4', 0.65, {}],
  ['WALK · CONTACT', 0.9, { speed: 2.3, phase: 0.05 }],
  ['WALK · PASSING', 0.9, { speed: 2.3, phase: PI / 2 + 0.3 }],
  ['RUN', 1.0, { speed: 4.1, phase: 0.95 }],
  ['TURN IN PLACE', 0.6, { turn: 4.5 }, 8],
  ['LOOK LEFT', 0.3, { look: { yaw: 1.1, pitch: 0 } }],
  ['LOOK RIGHT', 0.3, { look: { yaw: -1.1, pitch: 0.1 } }],
  ['AIM', 0.9, { aiming: true }],
  ['AIM-WALK STRAFE', 0.5, { aiming: true, speed: 1.1, moveLocal: { x: -1, z: 0 }, phase: 0.6 }],
  ['RELOAD', 0.7, { reload: 0.5 }],
  ['IMPAIRED (LIMP)', 0.9, { condition: 1, speed: 1.95, phase: PI + 0.2 }],
  ['FAILING', 0.6, { condition: 2 }],
  ['CRITICAL', 0.6, { condition: 3, speed: 1.4, phase: 0.4 }],
  ['REACH', 0.8, { action: 'reach', actionT: 0.22 }],
  ['REACH LOW', 0.8, { action: 'reachLow', actionT: 0.24 }],
  ['STOMP · IMPACT', 0.9, { action: 'stomp', actionT: 0.3 }],
  ['STOMP · KNEE UP', 0.9, { action: 'stomp', actionT: 0.19 }],
  ['TOOL · FLARE STRIKE', 0.7, { action: 'toolFlare', actionT: 0.34 }],
  ['TOOL · PRONG JAB', 0.9, { action: 'toolProng', actionT: 0.35 }],
  ['HURT (FROM FRONT)', 0.8, { hurt: 1, hurtDir: 0 }, 4],
  ['DEAD', 0.7, { dead: true, deadT: 2.2 }],
];
// game-scale strip
export const WREN_STRIP = [
  ['IDLE ↓', 0, {}], ['IDLE →', PI / 2, {}], ['IDLE ↑', PI, {}], ['WALK', 0.8, { speed: 2.3, phase: PI / 2 }],
  ['AIM', -0.9, { aiming: true }], ['FAILING', 0.5, { condition: 2 }], ['REACH LOW', 0.9, { action: 'reachLow', actionT: 0.24 }], ['DEAD', 0.6, { dead: true, deadT: 2.2 }],
];

export const HOLLOW_STATES = ['dormant', 'idle', 'investigate', 'notice', 'rising', 'chase', 'lunge', 'attack', 'flinch', 'knockdown', 'down', 'stomped', 'burning', 'ash', 'dead'];
export const LYING_STATES = ['knockdown', 'down', 'stomped', 'burning', 'ash', 'dead'];
export const STATE_SPEC = {
  dormant: { stateT: 1 }, idle: { stateT: 2 }, investigate: { stateT: 2, speed: 0.6 }, notice: { stateT: 0.12 },
  rising: { stateT: 0.8 }, chase: { stateT: 2, speed: 1.35 }, lunge: { stateT: 0.62 }, attack: { stateT: 0.3, attackPhase: 0.9 },
  flinch: { stateT: 0.15 }, knockdown: { stateT: 0.9 }, down: { stateT: 2, twitch: 0.4, reviving: 0.6 }, stomped: { stateT: 1 },
  burning: { stateT: 1.2 }, ash: { stateT: 4 }, dead: { stateT: 5 },
};
export const VARIANTS = [[0, 'LURCHER · 0'], [1, 'LURCHER · 1'], [2, 'LURCHER · 2'], ['rusher', 'RUSHER'], ['warden', 'WARDEN']];

// Run the custodian into a pose over `frames` frames at 30 fps (so blends settle).
export function poseWren(rig, spec) {
  const s = spec.s || {};
  const frames = spec.frames ?? 45;
  const dt = 1 / 30;
  const speed = s.speed || 0;
  const rate = CH.custodianPhaseRate(speed, s.condition || 0);
  const ph1 = s.phase ?? 0;
  for (let f = 0; f <= frames; f++) {
    const back = (frames - f) * dt;
    const st = { ...s, time: 10 - back, phase: ph1 - rate * back };
    if (s.actionT !== undefined) st.actionT = Math.max(0, s.actionT - back);
    if (s.deadT !== undefined) st.deadT = Math.max(0, s.deadT - back);
    if (s.reload !== undefined) st.reload = s.reload + back * 0.2;
    if (s.hurt !== undefined) st.hurt = Math.max(0, s.hurt - back * 3);
    CH.poseCustodian(rig, st, f === 0 ? 1 : dt);
  }
  const armed = !!(s.aiming || s.reload);
  rig.gun.visible = armed;
  rig.holster.visible = !armed;
  rig.statusLamp.color.setHex([0x6fc3c9, 0xe0c85a, 0xe0862e, 0xff2a3a][Math.min(3, s.condition || 0)]);
}

// Run a Hollow into a state (stateT counts up to spec.s.stateT over the frames).
export function poseHollowRig(rig, spec) {
  const frames = spec.frames ?? 40;
  const dt = 1 / 30;
  for (let f = 0; f <= frames; f++) {
    const back = (frames - f) * dt;
    CH.poseHollow(rig, { ...spec.s, time: 10 - back, stateT: Math.max(0, (spec.s.stateT ?? 1) - back), speed: spec.s.speed || 0, phase: (10 - back) * 3 }, f === 0 ? 1 : dt);
  }
  const st = spec.s.state;
  CH.setHollowScorch(rig, st === 'ash' ? 1 : st === 'burning' ? 0.55 : 0);
  const alive = !LYING_STATES.includes(st);
  const g = alive ? 0.9 : st === 'down' ? 0.35 : 0.04;
  rig.glow.color.setRGB(Math.max(0.1, g), 0.1 * g, 0.1 * g);
}
