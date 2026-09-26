// Navigation for click-to-go (and, later, the Hollows): a 0.5 m grid over the
// deck, A* with 8 neighbours, and string-pulling into a few straight legs.
//
//   const nav = new Nav(world);
//   nav.find({x,z}, {x,z}, { agentR, targetDoor }) → [{x, z, door?}] | null
//
// Walls block their own cells only (so 1 m doorways stay open); props block
// every cell whose centre lies inside their collider inflated by the agent
// radius. Doors are checked at query time: open doors are free, closed and
// unlocked ones cost extra, locked ones are walls unless the door itself is
// the target. A waypoint carrying `door` means "this door must be open before
// you walk the next leg"; the follower opens it.
import { GRID_W, GRID_H } from './map.js';

const CELL = 0.5;
const INV = 1 / CELL;
const SQ2 = Math.SQRT2;
const MAX_EXPAND = 4000;
const DOOR_COST = 1.5;
const LINE_OFFSET = 0.26;
const EDGE_COST = 0.3;  // cells hugging a wall cost a little more, so routes keep off walls

// The face of a door leaf on the side of (x, z), just outside the door tile:
// a closed leaf blocks line of sight to its own centre, so reach and sight
// checks aim here instead.
export function doorFace(d, x, z) {
  const cx = d.x + 0.5, cz = d.z + 0.5;
  if (d.axis === 'x') return { x: cx + (x < cx ? -0.55 : 0.55), z: cz };
  return { x: cx, z: cz + (z < cz ? -0.55 : 0.55) };
}

class Heap {
  constructor(n) { this.k = new Int32Array(n); this.f = new Float32Array(n); this.n = 0; }
  push(k, f) {
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[p] <= f) break;
      this.k[i] = this.k[p]; this.f[i] = this.f[p]; i = p;
    }
    this.k[i] = k; this.f[i] = f;
  }
  pop() {
    const top = this.k[0];
    const k = this.k[--this.n], f = this.f[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && this.f[c + 1] < this.f[c]) c++;
      if (this.f[c] >= f) break;
      this.k[i] = this.k[c]; this.f[i] = this.f[c]; i = c;
    }
    this.k[i] = k; this.f[i] = f;
    return top;
  }
}

export class Nav {
  constructor(world, { agentR = 0.28 } = {}) {
    this.world = world;
    this.W = GRID_W * 2;
    this.H = GRID_H * 2;
    const N = this.W * this.H;
    this.N = N;
    this.roomKeys = Object.keys(world.rooms);
    this.doorList = Object.values(world.doors);
    this.roomIdx = new Map(this.roomKeys.map((k, i) => [k, i]));
    this.doorIdx = new Map(this.doorList.map((d, i) => [d, i]));
    // static layers
    this.room = new Int16Array(N).fill(-1);   // room index, or -1
    this.door = new Int16Array(N).fill(-1);   // door index, or -1
    this.edge = new Uint8Array(N);            // room cell within 0.3 m of a wall
    for (let j = 0; j < this.H; j++) {
      for (let i = 0; i < this.W; i++) {
        const t = world.tile(Math.floor((i + 0.5) * CELL), Math.floor((j + 0.5) * CELL));
        const c = j * this.W + i;
        if (typeof t === 'string') this.room[c] = this.roomIdx.get(t);
        else if (t && typeof t === 'object') this.door[c] = this.doorIdx.get(t);
      }
    }
    for (let c = 0; c < N; c++) {
      if (this.room[c] < 0) continue;
      const x = this.cx(c), z = this.cz(c);
      for (const [ox, oz] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
        if (world.tile(Math.floor(x + ox), Math.floor(z + oz)) === null) { this.edge[c] = 1; break; }
      }
    }
    this.layers = new Map();
    this.layer(agentR);
    // search scratch (generation-stamped so nothing is cleared per query)
    this.g = new Float32Array(N);
    this.from = new Int32Array(N);
    this.stamp = new Uint32Array(N);
    this.closed = new Uint32Array(N);
    this.gen = 0;
    this.heap = new Heap(Math.max(N * 2, MAX_EXPAND * 8 + 64));
    this.stats = { queries: 0, lastMs: 0, maxMs: 0, lastExpanded: 0 };
  }

  // Cells blocked by props for a given agent radius.
  layer(r) {
    const key = Math.round(r * 100);
    let L = this.layers.get(key);
    if (L) return L;
    L = new Uint8Array(this.N);
    for (const c of this.world.propColliders) {
      const x0 = c.x0 - r, x1 = c.x1 + r, z0 = c.z0 - r, z1 = c.z1 + r;
      const i0 = Math.max(0, Math.floor(x0 * INV)), i1 = Math.min(this.W - 1, Math.floor(x1 * INV));
      const j0 = Math.max(0, Math.floor(z0 * INV)), j1 = Math.min(this.H - 1, Math.floor(z1 * INV));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const cx = (i + 0.5) * CELL, cz = (j + 0.5) * CELL;
        if (cx > x0 && cx < x1 && cz > z0 && cz < z1) L[j * this.W + i] = 1;
      }
    }
    this.layers.set(key, L);
    return L;
  }

  cellOf(x, z) {
    const i = Math.floor(x * INV), j = Math.floor(z * INV);
    if (i < 0 || j < 0 || i >= this.W || j >= this.H) return -1;
    return j * this.W + i;
  }
  cx(c) { return (c % this.W + 0.5) * CELL; }
  cz(c) { return (Math.floor(c / this.W) + 0.5) * CELL; }

  // Door rule at query time: 0 free, >0 extra cost, -1 blocked.
  doorCost(d, q) {
    if (d.open && d.t >= 0.8) return 0;
    if (!d.locked) return DOOR_COST;
    return d === q.targetDoor ? DOOR_COST : -1;
  }

  // Rooms the search may touch: the start room plus rooms within `depth` doors.
  allowedRooms(startRoom, q, depth = 2) {
    const allowed = new Uint8Array(this.roomKeys.length);
    if (startRoom < 0) { allowed.fill(1); return allowed; }
    allowed[startRoom] = 1;
    let frontier = [startRoom];
    for (let k = 0; k < depth; k++) {
      const next = [];
      for (const ri of frontier) {
        for (const id of this.world.rooms[this.roomKeys[ri]].neighbours) {
          const d = this.world.doors[id];
          if (this.doorCost(d, q) < 0) continue;
          for (const other of [d.a, d.b]) {
            const oi = this.roomIdx.get(other);
            if (!allowed[oi]) { allowed[oi] = 1; next.push(oi); }
          }
        }
      }
      frontier = next;
    }
    return allowed;
  }

  // Is cell c walkable for this query? Returns -1 blocked, else extra cost.
  cellCost(c, q) {
    if (c < 0 || q.block[c]) return -1;
    const r = this.room[c];
    if (r >= 0) return q.allowed[r] ? 0 : -1;
    const di = this.door[c];
    if (di < 0) return -1; // wall
    const d = this.doorList[di];
    if (!q.allowed[this.roomIdx.get(d.a)] && !q.allowed[this.roomIdx.get(d.b)]) return -1;
    return this.doorCost(d, q);
  }

  // Nearest walkable cell to (x, z) within `maxR` metres (ring search).
  nearestFree(x, z, q, maxR = 1) {
    const c0 = this.cellOf(x, z);
    if (c0 >= 0 && this.cellCost(c0, q) >= 0) return c0;
    const i0 = Math.floor(x * INV), j0 = Math.floor(z * INV);
    const rings = Math.ceil(maxR * INV);
    let best = -1, bestD = Infinity;
    for (let rr = 1; rr <= rings; rr++) {
      for (let j = j0 - rr; j <= j0 + rr; j++) for (let i = i0 - rr; i <= i0 + rr; i++) {
        if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== rr) continue;
        if (i < 0 || j < 0 || i >= this.W || j >= this.H) continue;
        const c = j * this.W + i;
        if (this.cellCost(c, q) < 0) continue;
        const d = Math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - z);
        if (d <= maxR && d < bestD) { bestD = d; best = c; }
      }
      if (best >= 0) return best;
    }
    return best;
  }

  roomAtCell(c) {
    if (c < 0) return -1;
    if (this.room[c] >= 0) return this.room[c];
    const di = this.door[c];
    return di >= 0 ? this.roomIdx.get(this.doorList[di].a) : -1;
  }

  find(from, to, opts = {}) {
    const t0 = performance.now();
    const q = {
      targetDoor: opts.targetDoor || null,
      block: this.layer(opts.agentR ?? 0.28),
      allowed: null,
    };
    const startCell0 = this.cellOf(from.x, from.z);
    q.allowed = this.allowedRooms(this.roomAtCell(startCell0), q, opts.depth ?? 2);
    const start = this.nearestFree(from.x, from.z, q, 1.0);
    const goal = this.nearestFree(to.x, to.z, q, opts.snap ?? 1.0);
    let result = null;
    if (start >= 0 && goal >= 0) {
      const cells = this.astar(start, goal, q);
      if (cells) {
        // `exact`: the caller checked that the agent fits at `to` itself (a
        // spot between cell centres, e.g. tight against a desk), so end there
        const exact = opts.exact || this.cellOf(to.x, to.z) === goal ? { x: to.x, z: to.z } : { x: this.cx(goal), z: this.cz(goal) };
        result = this.buildPath(from, cells, exact, q);
      }
    }
    const ms = performance.now() - t0;
    this.stats.queries++;
    this.stats.lastMs = ms;
    this.stats.maxMs = Math.max(this.stats.maxMs, ms);
    return result;
  }

  astar(start, goal, q) {
    const W = this.W;
    const gen = ++this.gen;
    const { g, from, stamp, closed, heap } = this;
    heap.n = 0;
    const gx = goal % W, gz = Math.floor(goal / W);
    const h = (c) => {
      const dx = Math.abs(c % W - gx), dz = Math.abs(Math.floor(c / W) - gz);
      return (dx + dz + (SQ2 - 2) * Math.min(dx, dz)) * CELL;
    };
    stamp[start] = gen; g[start] = 0; from[start] = -1;
    heap.push(start, h(start));
    let expanded = 0, found = false;
    while (heap.n > 0 && expanded < MAX_EXPAND) {
      const c = heap.pop();
      if (closed[c] === gen) continue;
      closed[c] = gen;
      if (c === goal) { found = true; break; }
      expanded++;
      const ci = c % W, cj = Math.floor(c / W);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= this.H) continue;
        const n = nj * W + ni;
        if (closed[n] === gen) continue;
        const extra = this.cellCost(n, q);
        if (extra < 0) continue;
        if (di && dj) {
          // no corner cutting
          if (this.cellCost(cj * W + ni, q) < 0 || this.cellCost(nj * W + ci, q) < 0) continue;
        }
        // door cost is paid once, on entering a door from outside it
        const pay = extra > 0 && this.door[c] !== this.door[n] ? extra : 0;
        const ng = g[c] + (di && dj ? SQ2 : 1) * CELL + pay + (this.edge[n] ? EDGE_COST * CELL : 0);
        if (stamp[n] !== gen || ng < g[n]) {
          stamp[n] = gen; g[n] = ng; from[n] = c;
          heap.push(n, ng + h(n));
        }
      }
    }
    this.stats.lastExpanded = expanded;
    if (!found) return null;
    const cells = [];
    for (let c = goal; c !== -1; c = from[c]) cells.push(c);
    cells.reverse();
    return cells;
  }

  // Split the raw cell path at door crossings (each door gets a fixed
  // approach / exit pair) and string-pull the legs in between.
  buildPath(from, cells, goalPt, q) {
    const pts = [];
    const legs = []; // [{ cells:[...], startPt, endPt, door? }]
    let legStart = { x: from.x, z: from.z };
    let cur = [];
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      const di = this.door[c];
      if (di < 0) { cur.push(c); continue; }
      // entering a door: collect every consecutive cell of this door
      let m = k;
      while (m + 1 < cells.length && this.door[cells[m + 1]] === di) m++;
      const d = this.doorList[di];
      const cxd = d.x + 0.5, czd = d.z + 0.5;
      const startsInDoor = k === 0 && this.door[this.cellOf(from.x, from.z)] === di;
      const endsInDoor = m === cells.length - 1;
      // direction of travel through the door, from the exit side (or entry side)
      let ex, ez;
      if (!endsInDoor) { ex = this.cx(cells[m + 1]); ez = this.cz(cells[m + 1]); } else { ex = goalPt.x; ez = goalPt.z; }
      let sx, sz;
      if (cur.length) { sx = this.cx(cur[cur.length - 1]); sz = this.cz(cur[cur.length - 1]); } else { sx = legStart.x; sz = legStart.z; }
      let ax = 0, az = 0; // unit vector pointing back toward the entry side
      if (d.axis === 'x') ax = endsInDoor ? (sx < cxd ? -1 : 1) : (ex < cxd ? 1 : -1);
      else az = endsInDoor ? (sz < czd ? -1 : 1) : (ez < czd ? 1 : -1);
      const APP = 0.85;
      const before = { x: cxd + ax * APP, z: czd + az * APP };
      const after = { x: cxd - ax * APP, z: czd - az * APP };
      if (!startsInDoor) {
        legs.push({ cells: cur, startPt: legStart, endPt: before });
        pts.push(...this.pull(legs[legs.length - 1], q));
        // the door approach carries the door; then walk straight through
        pts.push({ x: before.x, z: before.z, door: d });
      }
      if (endsInDoor) { legStart = { x: cxd, z: czd }; cur = []; k = m; break; }
      pts.push({ x: after.x, z: after.z });
      legStart = after;
      cur = [];
      k = m;
    }
    const last = { cells: cur, startPt: legStart, endPt: goalPt };
    const tail = this.pull(last, q);
    pts.push(...tail);
    pts.push({ x: goalPt.x, z: goalPt.z });
    // drop points that sit on top of each other
    const out = [];
    let lx = from.x, lz = from.z;
    for (const p of pts) {
      if (!p.door && Math.hypot(p.x - lx, p.z - lz) < 0.05) continue;
      out.push(p); lx = p.x; lz = p.z;
    }
    return out;
  }

  // Greedy string pull of one leg. Returns intermediate waypoints only
  // (not startPt, not endPt).
  pull(leg, q) {
    const nodes = leg.cells.map((c) => ({ x: this.cx(c), z: this.cz(c) }));
    nodes.push(leg.endPt);
    const out = [];
    let anchor = leg.startPt;
    let first = true;
    for (let k = 1; k < nodes.length; k++) {
      if (!this.clear(anchor, nodes[k], q, first)) {
        const keep = nodes[k - 1];
        if (Math.hypot(keep.x - anchor.x, keep.z - anchor.z) > 0.01) out.push({ x: keep.x, z: keep.z });
        anchor = keep;
        first = false;
      }
    }
    return out;
  }

  // Straight-line clearance: the centre line must stay on walkable cells
  // (props inflated by the agent radius); two parallel lines ±0.26 m must
  // stay off walls and closed doors.
  clear(a, b, q, lenientStart = false) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return true;
    const ux = dx / len, uz = dz / len;
    const px = -uz * LINE_OFFSET, pz = ux * LINE_OFFSET;
    const steps = Math.ceil(len / 0.1);
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * len;
      const x = a.x + ux * t, z = a.z + uz * t;
      if (!(lenientStart && t < 0.35)) {
        if (this.cellCost(this.cellOf(x, z), q) < 0) return false;
      }
      if (this.wallAt(x + px, z + pz) || this.wallAt(x - px, z - pz)) return false;
    }
    return true;
  }

  wallAt(x, z) {
    const t = this.world.tile(Math.floor(x), Math.floor(z));
    if (t === null) return true;
    if (typeof t === 'object') return !(t.open && t.t >= 0.8);
    return false;
  }

  // Where to stand to use something at `target` within `reach`: the free cell
  // in reach (with a clear line to it) nearest to `from`, i.e. on the agent's
  // side of a desk rather than behind it. Returns {x, z} or null.
  //
  // A door target is sighted at its face on the cell's side (the closed leaf
  // blocks the ray to its centre). When no cell centre is close enough (an
  // item at the back of a desk), finer points are tried: any spot where the
  // agent's circle fits (the world's own collider leaves it in place) and
  // that sees the target. Such a spot comes back with `exact: true`; pass
  // that on to find() so the walk ends on it rather than on a cell centre.
  approach(target, from, reach, opts = {}) {
    const agentR = opts.agentR ?? 0.28;
    const q = { targetDoor: opts.targetDoor || null, block: this.layer(agentR), allowed: null };
    q.allowed = this.allowedRooms(this.roomAtCell(this.cellOf(from.x, from.z)), q, opts.depth ?? 2);
    const door = opts.targetDoor || (target.kind === 'door' ? target.door : null);
    const sees = (x, z) => {
      if (door) { const f = doorFace(door, x, z); return this.world.lineOfSight(x, z, f.x, f.z); }
      return this.world.lineOfSight(x, z, target.x, target.z);
    };
    const i0 = Math.floor(target.x * INV), j0 = Math.floor(target.z * INV);
    const R = Math.ceil(reach * INV) + 1;
    let best = null, bestD = Infinity;
    for (let j = j0 - R; j <= j0 + R; j++) for (let i = i0 - R; i <= i0 + R; i++) {
      if (i < 0 || j < 0 || i >= this.W || j >= this.H) continue;
      const c = j * this.W + i;
      const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL;
      if (Math.hypot(x - target.x, z - target.z) > reach) continue;
      if (this.cellCost(c, q) < 0 || this.door[c] >= 0) continue;
      if (!sees(x, z)) continue;
      const d = Math.hypot(x - from.x, z - from.z);
      if (d < bestD) { bestD = d; best = { x, z }; }
    }
    if (best) return best;
    // sub-cell search, 0.1 m steps
    const p = { x: 0, z: 0 };
    const STEP = 0.1;
    const n = Math.ceil(reach / STEP);
    for (let b = -n; b <= n; b++) for (let a = -n; a <= n; a++) {
      const x = target.x + a * STEP, z = target.z + b * STEP;
      if (Math.hypot(x - target.x, z - target.z) > reach) continue;
      const c = this.cellOf(x, z);
      if (c < 0 || this.room[c] < 0 || !q.allowed[this.room[c]]) continue;
      p.x = x; p.z = z;
      this.world.resolve(p, agentR);
      if (Math.abs(p.x - x) > 1e-3 || Math.abs(p.z - z) > 1e-3) continue;
      if (!sees(x, z)) continue;
      // it must also join the walkable grid (a free cell next to it)
      if (this.nearestFree(x, z, q, 0.75) < 0) continue;
      const d = Math.hypot(x - from.x, z - from.z);
      if (d < bestD) { bestD = d; best = { x, z, exact: true }; }
    }
    return best;
  }

  // Is there a walkable cell under (x, z) for a player-sized agent?
  walkable(x, z, agentR = 0.28) {
    const c = this.cellOf(x, z);
    if (c < 0) return false;
    if (this.layer(agentR)[c]) return false;
    return this.room[c] >= 0 || (this.door[c] >= 0 && this.doorList[this.door[c]].open);
  }
}
