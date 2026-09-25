// Item definitions and the six-slot inventory.
//
// kind: weapon | ammo | heal | key | memory | tool. Optional fields the
// Custodian OS reads: `mag` (magazine size), `inspect` (a detail found on
// TURN OVER). Healing: `heal` hit points, over `hot` seconds (0 = at once).
// Tools are equipped in the OS and used with C / Mouse 4 / pad LB:
//   prong — ARC PRONG: knocks every Hollow within `radius` flat (finishable).
//   flare — CAUTERY FLARE: burns a body on the floor within `radius` to ash
//           (it never gets up), or sets a Hollow in reach alight.
export const ITEMS = {
  pistol: {
    name: 'P-17 SIDEARM', kind: 'weapon', stack: 1, mag: 8,
    desc: 'Standard custodian sidearm, issued during the evacuation drills. Holds 8 rounds. Heavier than it looks.',
    inspect: 'Serial filed off. Someone scratched a tally into the grip: eleven marks.',
  },
  ammo: {
    name: 'PISTOL ROUNDS', kind: 'ammo', stack: 24,
    desc: '9×19 caseless rounds for the P-17. Count them. Always count them.',
  },
  sealant: {
    name: 'SEALANT SPRAY', kind: 'heal', heal: 40, hot: 8, stack: 3,
    desc: 'Polymer sealant for hull breaches and chassis damage. Restores some integrity as it sets, over a few seconds. It stings, if I let it.',
    inspect: 'SHAKE WELL. DO NOT APPLY TO OPTICS. The nozzle is crusted grey.',
  },
  nanite: {
    name: 'NANITE AMPOULE', kind: 'heal', heal: 100, stack: 1,
    desc: 'A glass ampoule of repair nanites. Fully restores integrity, at once. Medical keeps — kept — these locked away.',
    inspect: 'The seal is stamped with a lot number and a date eleven hundred cycles gone.',
  },
  prong: {
    name: 'ARC PRONG', kind: 'tool', stack: 4, radius: 1.8,
    desc: 'A single-use discharge prong for clearing jammed relays. Anything standing close enough goes down. Get to them before they get up.',
    inspect: 'Two copper tines, a thumb trigger, a cartridge the size of a finger. HOLD AWAY FROM BODY.',
  },
  flare: {
    name: 'CAUTERY FLARE', kind: 'tool', stack: 3, radius: 1.5, damage: 45,
    desc: 'A magnesium flare for sealing coolant lines. Laid on a fallen Hollow it burns it down to nothing, and nothing gets up. It will light one in reach, too.',
    inspect: 'STRIKE CAP · BURN TIME 3 s. Someone has written on the tube in marker: FOR THE ONES THAT KEEP COUNTING.',
  },
  keycard: {
    name: 'SECURITY KEYCARD', kind: 'key', stack: 1,
    desc: 'Clearance card, Security Office. The photo has been scratched off. The name reads VARGA.',
  },
  fuse: {
    name: 'BREAKER FUSE', kind: 'key', stack: 1,
    desc: 'A ceramic 400A cartridge fuse. For the relay panel.',
  },
  photo: {
    name: 'FADED PHOTOGRAPH', kind: 'memory', stack: 1,
    desc: 'Two figures silhouetted against a window. One is a woman in an overseer\'s coat. The other one is me.',
  },
  obol: {
    name: 'OBOL', kind: 'key', stack: 1,
    desc: 'An old silver coin, worn almost smooth. On one side, a boat. On the other, someone has scratched: FOR W.',
  },
};

export const SLOTS = 6;

export class Inventory {
  constructor() {
    this.slots = new Array(SLOTS).fill(null); // { id, qty, loaded? }
    this.box = [];                              // shared storage trunk
    this.files = [];                            // collected file ids
  }

  serialize() {
    return { slots: this.slots, box: this.box, files: this.files };
  }

  load(d) {
    this.slots = d.slots.map((s) => (s ? { ...s } : null));
    this.box = d.box.map((s) => ({ ...s }));
    this.files = [...d.files];
  }

  count(id) {
    return this.slots.reduce((n, s) => n + (s && s.id === id ? s.qty : 0), 0);
  }

  has(id) { return this.count(id) > 0; }

  freeSlots() { return this.slots.filter((s) => !s).length; }

  // Returns how many could NOT be added.
  add(id, qty = 1) {
    const def = ITEMS[id];
    let left = qty;
    for (const s of this.slots) {
      if (left <= 0) break;
      if (s && s.id === id && s.qty < def.stack) {
        const take = Math.min(def.stack - s.qty, left);
        s.qty += take; left -= take;
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (!this.slots[i]) {
        const take = Math.min(def.stack, left);
        this.slots[i] = { id, qty: take };
        if (id === 'pistol') this.slots[i].loaded = 0;
        left -= take;
      }
    }
    return left;
  }

  canAdd(id, qty = 1) {
    const def = ITEMS[id];
    let room = 0;
    for (const s of this.slots) {
      if (!s) room += def.stack;
      else if (s.id === id) room += def.stack - s.qty;
    }
    return room >= qty;
  }

  remove(id, qty = 1) {
    let left = qty;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(s.qty, left);
        s.qty -= take; left -= take;
        if (s.qty <= 0) this.slots[i] = null;
      }
    }
    return qty - left;
  }

  weapon() { return this.slots.find((s) => s && s.id === 'pistol') || null; }

  // All carried rounds, loaded plus loose (the economy check reads this).
  rounds() {
    const w = this.weapon();
    return this.count('ammo') + (w ? w.loaded || 0 : 0);
  }

  addFile(id) {
    if (!this.files.includes(id)) { this.files.push(id); return true; }
    return false;
  }

  // Move slot i into the storage trunk.
  store(i) {
    const s = this.slots[i];
    if (!s) return false;
    if (s.id === 'pistol' && s.loaded > 0) {
      // unload into ammo so rounds aren't lost
      this.box.push({ id: 'ammo', qty: s.loaded });
      s.loaded = 0;
    }
    const existing = this.box.find((b) => b.id === s.id && ITEMS[s.id].stack > 1);
    if (existing) existing.qty += s.qty; else this.box.push({ ...s });
    this.slots[i] = null;
    return true;
  }

  retrieve(j) {
    const b = this.box[j];
    if (!b) return false;
    const def = ITEMS[b.id];
    const qty = Math.min(b.qty, def.stack);
    if (!this.canAdd(b.id, 1)) return false;
    const left = this.add(b.id, qty);
    const moved = qty - left;
    b.qty -= moved;
    if (b.id === 'pistol') {
      const w = this.weapon(); if (w) w.loaded = b.loaded || 0;
    }
    if (b.qty <= 0) this.box.splice(j, 1);
    return moved > 0;
  }
}
