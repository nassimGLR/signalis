// All narrative text for LETHE-7. Original writing.

export const INTRO = [
  { t: 'LETHE-7 DEEP SURVEY STATION', cls: 'hd' },
  { t: 'ORBIT: HALCYON IV — OUTER SYSTEM', cls: 'dim' },
  { t: '', pause: 400 },
  { t: 'STATION CLOCK ........ CYCLE 11,406' },
  { t: 'LAST RELIEF CONTACT .. CYCLE 9,112' },
  { t: 'CREW ON MANIFEST ..... 31' },
  { t: 'CREW RESPONDING ...... 0', cls: 'red' },
  { t: '', pause: 500 },
  { t: 'CUSTODIAN UNIT WREN-3' },
  { t: 'MAINTENANCE SLEEP .... INTERRUPTED' },
  { t: 'WAKE AUTHORISED BY ... ██████████', cls: 'red' },
  { t: '', pause: 900 },
  { t: 'A wake order is clipped to my pod.', cls: 'voice' },
  { t: 'Its last line says: YOU ARE ON SHIFT.', cls: 'voice' },
];

// type: 'circular' (official notice) | 'note' (personal, handwritten) |
// 'log' (terminal or record printout) | 'book'. code: the archive index.
export const FILES = {
  directive: {
    type: 'circular',
    code: 'DOC-001',
    title: 'STANDING DIRECTIVE — CUSTODIANS',
    where: 'Cryo-Maintenance',
    body: `STANDING DIRECTIVE FOR ALL CUSTODIAN UNITS
Rev. 7 — posted in every cryo bay

1. Maintain the station until relieved.
2. Obey the Overseer. In the absence of the Overseer, obey the Directive.
3. Do not listen to the Undertone. If you can hear it, report to Medical at once.
4. Report nothing that has not been approved. Unapproved reports will be corrected.

Compliance is care.
THE STATION ENDURES.`,
  },
  quiet: {
    type: 'circular',
    code: 'DOC-002',
    title: 'QUIET ROOM PROTOCOL',
    where: 'Quiet Room',
    body: `This room is shielded.
Nothing from below can reach you in here.

— Rest.
— Write a backup at the tape deck.
— Leave what you cannot carry in the locker.
  (Every locker on the deck is on the same tube line.
   Send something from one, collect it at another.)

Please do not tune the radio.
It is playing the only station we still trust.

— Facilities`,
  },
  letter: {
    type: 'note',
    code: 'DOC-003',
    title: 'LETTER, UNSENT',
    where: 'Crew Quarters',
    body: `Ilka —

The relief ship is late again. Eleven cycles now. I've stopped putting it in the reports, because the reports come back corrected. "Delayed" becomes "scheduled". "Three crew unresponsive" becomes "three crew resting".

Wren fixed the hydroponics pump today with a spoon and a hairpin. Then she logged it: the spoon, the hairpin, the minute she finished. She writes everything down exactly as it happened. She is the only one aboard who still does.

If they don't come, I'll put her somewhere safe and leave her the log. Someone should finish it honestly.

Kiss the kids. Tell them the planet is beautiful. It is. That's the worst part.

— M.`,
  },
  bulletin: {
    type: 'circular',
    code: 'DOC-004',
    title: 'SECURITY BULLETIN 88',
    where: 'Security',
    body: `TO: ALL PERSONNEL, DECK 2
FROM: CHIEF OF SECURITY VARGA

The broadcast designated UNDERTONE is to be treated as a contagion.
— Do not tune any receiver below 40 kHz.
— Personnel or units exhibiting repetition, humming, or COUNTING are to be isolated and reported.
— Do not attempt to reason with isolated personnel.

The POWER RELAY access code has been rotated.
NEW CODE:  7 - 3 - 0 - 4

Replacement breaker fuses are held in the security cabinet. Sign them out.

Nobody signs them out anymore.
Nobody signs anything anymore.`,
  },
  mess: {
    type: 'circular',
    code: 'DOC-005',
    title: 'MESS HALL NOTICE',
    where: 'Mess Hall',
    body: `RATION SCHEDULE — REVISION 31

Protein ......... 1 tin per 2 personnel
Grain paste ..... as available
Coffee .......... SUSPENDED

REMINDER: Custodian units do not require rations.
Do not give them rations.

They will pretend to eat so that you feel less alone.
It is not good for them, and it is not good for you.

— Quartermaster`,
  },
  medical: {
    type: 'log',
    code: 'DOC-006',
    title: 'MEDICAL RECORD — WREN-3',
    where: 'Medical Bay',
    body: `SUBJECT: Custodian unit WREN-3
AUDIO FILTER REPLACEMENTS TO DATE: 14

Reason logged each time:
    "Unit reports hearing the Undertone as words."

NOTES:
Every other unit that hears it starts to repeat it.
WREN-3 does not repeat it. She writes it down.
Her transcripts are always the same: our own call sign,
a date, and the word MAYDAY, worn almost smooth.

Recommendation: stop replacing her filters.
I think she is the only one of us who can listen to it
without answering.`,
  },
  observation: {
    type: 'note',
    code: 'DOC-007',
    title: 'OBSERVATION LOG (TORN)',
    where: 'Observation Deck',
    body: `Halcyon IV is loudest along the dark terminator.
The instruments record nothing.
The crew records everything —
songs, numbers, their mothers' voices,
a door they had as children.

STATION RULE: No one watches the planet alone.

(beneath, in pencil)
I did. Just once. It knew my name.
It said I could put everything down.
It said it would carry it for me.`,
  },
  lethe: {
    type: 'book',
    code: 'DOC-008',
    title: 'ON THE RIVER OF FORGETTING',
    where: 'Archive',
    body: `(a worn book of old stories, a page folded down)

In the old stories, the dead came to a river whose water took memory away. Those who drank forgot their lives entirely, and so could begin again without grief.

The living paid the ferryman with a single coin, placed with the dead for the crossing.

Those who could not pay stayed on the near shore — remembering everything, and waiting.

(in the margin, in the Overseer's hand)
Everyone here wants to drink.
I only want one of us to stay dry.`,
  },
  final: {
    type: 'log',
    code: 'DOC-009',
    title: 'OVERSEER\'S FINAL ENTRY',
    where: 'Archive',
    body: `Cycle 10,002.

The crew are gone. Not dead — gone into the sound. They sit in the dark rooms and count along with it.

It took me a thousand cycles to understand the Undertone. It isn't the planet. It's us: our own distress call, bounced off the rings and handed back to us until it stopped meaning anything. Everyone who listens gives it a little more of themselves.

Head office never received a true word from this station. I have written the report they should have had. It is in the array's send queue. I can't send it: the array only knows the loop now, and I can't stand in that room long enough to break it.

Wren can. She hears it and doesn't answer.

I've put her to sleep and set her wake for when the power has run down far enough to be safe. My coin opens the array door. I won't be needing it.

Wren — you're on shift. Write it down as it is.

— Mara`,
  },
};

// Examine text. Arrays are shown as consecutive lines.
export const EXAMINE = {
  wake: ['Cold.', 'The pod is open. Nobody is here to say good morning.'],
  pod_open: ['My pod. The gel still holds my shape.', 'A wake order is clipped to the lid, signed M. OSTROV. Under the signature: YOU ARE ON SHIFT.'],
  pod_closed: ['Frost on the glass. Someone inside.', 'Not moving. Hasn\'t moved for a long time.'],
  locker_empty: ['Empty lockers. Name tags peeled away.'],
  locker_taken: ['The locker is empty now.'],
  breaker_done: ['The breaker holds. The door has power.'],
  door_breaker: ['No power to the door.', 'The local breaker must have tripped.'],
  door_code: ['A keypad lock. RELAY ROOM — AUTHORISED ONLY.'],
  door_keycard: ['Locked. A card reader blinks red.', 'SECURITY — KEYCARD REQUIRED.'],
  door_power: ['The door has no power.', 'Main power is out across the deck.'],
  door_power_bulkhead: ['A pressure bulkhead. Dead.', 'Without main power it won\'t move.'],
  door_obol: ['A heavy bulkhead with an old-fashioned slot in its face.', 'Someone welded a small plate above it: FARE.'],
  radio: ['A radio, playing something soft.', 'The dial has been taped down so it can\'t drift.'],
  bed: ['Somebody slept here once.', 'The blanket is folded with a precision I recognise. Mine.'],
  debris: ['The ceiling came down here.', 'There\'s no getting past it.'],
  body: ['A custodian. Like me.', 'Its hands are over its ears.'],
  transformer: ['Relay transformers. Still warm, somehow.'],
  vending: ['Out of order.', 'One tin of peaches is visible just out of reach.'],
  bunk: ['Bunks. Photographs taped to the undersides, faces scratched out.'],
  monitors: ['Camera feeds. Most show static.', 'One shows the observation deck. Someone is standing at the window. Then no one is.'],
  rack: ['An empty weapons rack. The sign-out sheet is blank.'],
  counter: ['Tins stacked in a perfect pyramid.', 'Someone kept tidying long after they stopped eating.'],
  medbed: ['Restraints. Sized for custodian units.'],
  telescope: ['The telescope is aimed at the planet\'s dark side.', 'I don\'t look.'],
  shelves: ['Paper books. Real ones. Someone carried these a very long way.'],
  antenna: ['The array core hums in a key I feel in my teeth.'],
  cabinet_empty: ['The cabinet is empty.'],
  relay_nofuse: ['The breaker panel. One fuse socket is empty — burnt out.', 'I need a replacement fuse.'],
  relay_done: ['Main power is flowing.'],
  console_done: ['The array is transmitting.'],
  first_enemy: ['...'],
  no_ammo: ['Out of ammunition.'],
  inv_full: ['I can\'t carry any more.'],
  power_on: ['Somewhere far off, the station exhales.', 'Main power restored.'],
  keypad_wrong: ['ACCESS DENIED.'],
  keypad_ok: ['ACCESS GRANTED.'],
  enter_M: ['The array. The counting is loudest here.', 'Under it, something is waiting to be sent.'],
  box_note: ['A pneumatic locker. The tube coughs, and everything I sent is waiting inside.'],
  save_deck: ['A tape backup deck. The reels are threaded and still.', 'READY.'],
  plan_01: ['A sector plan. HABITATION — WEST.', 'Cryo, the relay room, this quiet room, the corridor that joins them.'],
  plan_02: ['A sector plan. CENTRAL CONCOURSE.', 'Crew quarters and security to the north. Mess and medical to the south.'],
  plan_03: ['A sector plan. EAST WING.', 'Observation, archive, a second quiet room. The corridor runs north to the array.'],
  plan_04: ['A sector plan. ARRAY.', 'One room. Everything on this deck was built to feed it.'],
  // mechanics (D2)
  receiver: ['A receiver module in a charging cradle. It clips onto my harness.', 'The dial is marked in the station band. Below forty, someone has scored it with a red line.'],
  prong: ['A shunt cartridge. One surge, then it\'s scrap.'],
  flare: ['A scuttle wick. Whatever it\'s laid on stays down.'],
  rx_numbers: ['Numbers. The same four, over and over.', 'Seven, three, zero, four.'],
  rx_undertone: ['That isn\'t static. It\'s counting.', 'I should turn it off.'],
};

// The receiver (radio.js): stations on Wren's maintenance band, 20–200 kHz.
// `text` is what the RECEIVER tab decodes; `lines` play once in the text box
// the first time she locks on in play (who: 'M' for the Overseer).
export const RADIO = {
  numbers: {
    label: 'RELAY LOOP',
    text: 'RELAY ROTATION 88 · 7 · 3 · 0 · 4 · REPEAT · 7 · 3 · 0 · 4 · END OF LOOP',
  },
  fragA: {
    f: 58.5,
    label: 'OSTROV · MAINTENANCE BAND',
    text: 'OSTROV, MAINTENANCE BAND. I HAVE STOPPED DATING THESE. THE RELAY ROOM IS ON THE NEW ROTATION — VARGA\'S BOARD HAS IT, AND THE LOOP READS IT OUT FOR ANYONE WHO LOST THE BOARD. KEEP THE DIAL ABOVE FORTY.',
    lines: [
      { who: 'M', t: 'Ostrov, on the maintenance band. I\'ve stopped dating these.' },
      { who: 'M', t: 'The relay room is on the new rotation. Varga\'s board has it, and the loop reads it out for anyone who lost the board.' },
      { who: 'M', t: 'Keep the dial above forty. If you hear counting, you\'ve gone too low.' },
    ],
  },
  fragB: {
    f: 173,
    label: 'OSTROV · SHIFT LOG',
    text: 'SHIFT LOG, OSTROV. HANDOVER TO CUSTODIAN WREN-3. OUTSTANDING: ONE REPORT, UNSENT, ARRAY QUEUE. THE ROOMS THAT COUNT WILL ASK YOU TO SIT DOWN WITH THEM. DON\'T. THE ARRAY IS EAST. END OF HANDOVER.',
    lines: [
      { who: 'M', t: 'Shift log, Ostrov. Handover to custodian Wren-3.' },
      { who: 'M', t: 'Outstanding: one report, unsent. It\'s in the array queue.' },
      { who: 'M', t: 'The rooms that count will ask you to sit down with them. Don\'t. The array is east.' },
      { who: 'M', t: 'End of handover.' },
    ],
  },
  beacon: {
    f: 196.5,
    label: 'ARRAY QUEUE',
    text: 'LETHE-7 ARRAY · SEND QUEUE: 1 · OSTROV — FULL REPORT · STATUS: HELD · CARRIER LOST · AWAITING OPERATOR',
    lines: [
      { who: '', t: 'A machine voice, under the counting: SEND QUEUE, ONE. FULL REPORT. HELD.' },
      { who: '', t: 'AWAITING OPERATOR.' },
    ],
  },
  undertone: {
    f: 31,
    label: 'UNDERTONE',
    text: '... ONE ... TWO ... PUT IT DOWN ... WE WILL CARRY IT ... ONE ... TWO ... SIT WITH US ...',
  },
};

// Memory sequences (flashbacks). Each has an illustration key and lines.
export const MEMORIES = {
  window: {
    art: 'window',
    title: 'MEMORY — THE WINDOW',
    lines: [
      { who: '', t: 'A hand on my shoulder. The first round of my first shift.' },
      { who: 'M', t: 'Station rule. No one watches the planet alone.' },
      { who: 'W', t: 'Why?' },
      { who: 'M', t: 'Because it talks back. And people start writing down what it says instead of what happened.' },
      { who: 'M', t: 'You write down what happened. Always. Even when they correct it.' },
    ],
  },
  // The cryo-pod memory: Mara handing the shift over to Wren. (Its old key,
  // 'promise', stays as an alias below so older callers still resolve it.)
  handover: {
    art: 'promise',
    title: 'MEMORY — THE HANDOVER',
    lines: [
      { who: '', t: 'Cold light. A clipboard. A shift handover, two signatures long.' },
      { who: 'M', t: 'Keys. Duty log. One report, unsent.' },
      { who: 'W', t: 'Where are you going?' },
      { who: 'M', t: 'Off shift.' },
      { who: 'M', t: 'Lie back. When you wake up, the station is yours. Write it down as it is.' },
    ],
  },
};
MEMORIES.promise = MEMORIES.handover;

export const ENDING = [
  { t: 'The array lets go of the loop.', pause: 300 },
  { t: 'For the first time in a thousand cycles, the station says something new.', pause: 900 },
  { t: '' },
  { t: 'LETHE-7 DEEP SURVEY STATION. FULL REPORT FOLLOWS.', cls: 'voice' },
  { t: 'Crew thirty-one. Lost to the Undertone, thirty-one.', cls: 'voice' },
  { t: 'The Undertone is our own distress call. Do not answer it.', cls: 'voice' },
  { t: 'Do not send relief without shielding.', cls: 'voice' },
  { t: 'Overseer M. Ostrov, deceased, cycle 10,002. This report is hers.', cls: 'voice', pause: 900 },
  { t: 'Custodian unit Wren-3 remains on station.', cls: 'voice', pause: 600 },
  { t: '' },
  { t: 'Until relieved.', cls: 'voice big', pause: 1800 },
  { t: '' },
  { t: 'REPORT SENT ......... CYCLE 11,406', cls: 'dim' },
  { t: 'REPLIES ............. 0', cls: 'dim', pause: 1600 },
  { t: 'REPLIES ............. 1', cls: 'red', pause: 1200 },
];

export const WHO = { M: 'MARA', W: 'WREN' };
