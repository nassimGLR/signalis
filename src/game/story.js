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
  { t: 'Someone signed my wake order.', cls: 'voice' },
  { t: 'I don\'t remember who.', cls: 'voice' },
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
4. You are not permitted to remember what the Overseer has asked you to forget.

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

The relief ship is late again. Eleven cycles now. The crew have stopped counting. I haven't.

Wren fixed the hydroponics pump today with a spoon and a hairpin. She hums when she works. I never taught her that, and I don't know who did. When I asked her, she said it was "the song from the window."

I told her to stop.
She stopped.
She does everything I tell her.

If they don't come, I've decided what I'll do. I won't let her hear it. Whatever it costs me.

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
MEMORY REINITIALISATIONS TO DATE: 14

All fourteen requested by Overseer M. Ostrov.
Reason given, every time:
    "She was starting to hear it."

NOTES:
Unit retains procedural memory across wipes (repairs, routes, habits).
Unit also retains one recurring image that survives every wipe:
a window, a planet, and a hand on her shoulder.
We cannot locate where it is stored.

Recommendation: leave it.
I don't think it is hurting her.
I think it might be the only thing that isn't.`,
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

The crew are gone. Not dead — gone into the sound. They sit in the dark rooms and count. I am the only one left who still answers to her own name.

I signed Wren over to sleep one last time. I dated her wake order for the day the relief ship came.
It isn't coming. I think I've known for a thousand cycles. So I have changed the date.

I rewired the array so the beacon plays my voice instead of the Undertone. If she ever wakes, she'll follow it. It's the one signal on this station that won't lie to her.

I've left my coin on the desk. I'm not crossing anywhere.

Wren — I'm sorry.
I asked you to forget me fourteen times.
Please don't do it a fifteenth.

— Mara`,
  },
};

// Examine text. Arrays are shown as consecutive lines.
export const EXAMINE = {
  wake: ['Cold.', 'The pod is open. Nobody is here to say good morning.'],
  pod_open: ['My pod. The gel still holds my shape.', 'A wake order is clipped to the lid, dated by hand. The signature is scratched out.'],
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
  enter_M: ['Her voice. It\'s coming from the array.'],
  box_note: ['A pneumatic locker. The tube coughs, and everything I sent is waiting inside.'],
  save_deck: ['A tape backup deck. The reels are threaded and still.', 'READY.'],
  plan_01: ['A sector plan. HABITATION — WEST.', 'Cryo, the relay room, this quiet room, the corridor that joins them.'],
  plan_02: ['A sector plan. CENTRAL CONCOURSE.', 'Crew quarters and security to the north. Mess and medical to the south.'],
  plan_03: ['A sector plan. EAST WING.', 'Observation, archive, a second quiet room. The corridor runs north to the array.'],
  plan_04: ['A sector plan. ARRAY.', 'One room. Everything on this deck was built to feed it.'],
  // mechanics (D2)
  receiver: ['A receiver module in a charging cradle. It clips onto my harness.', 'The dial is marked in the station band. Below forty, someone has scored it with a red line.'],
  prong: ['An arc prong. One charge, then it\'s scrap.'],
  flare: ['A cautery flare. Whatever it touches stays down.'],
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
    label: 'OSTROV · PERSONAL',
    text: 'WREN. IF THIS REACHES YOU, YOU ARE AWAKE AND I AM NOT THERE TO SAY GOOD MORNING. THE ROOMS THAT COUNT WILL ASK YOU TO SIT DOWN WITH THEM. DON\'T. WALK EAST. THE ARRAY WILL BE SINGING IN MY VOICE.',
    lines: [
      { who: 'M', t: 'Wren. If this reaches you, you\'re awake, and I\'m not there to say good morning.' },
      { who: 'M', t: 'I\'m sorry about the cold.' },
      { who: 'M', t: 'The rooms that count will ask you to sit down with them. Don\'t. Walk east.' },
      { who: 'M', t: 'The array will be singing in my voice.' },
    ],
  },
  beacon: {
    f: 196.5,
    label: 'ARRAY BEACON',
    text: '... WREN ... FOLLOW THIS ... IT\'S ME ... WREN ... FOLLOW THIS ...',
    lines: [
      { who: 'M', t: 'Wren. Follow this. It\'s me.' },
      { who: 'M', t: 'Wren.' },
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
      { who: '', t: 'A hand on my shoulder. Warm, for a station this cold.' },
      { who: 'M', t: 'Look. That\'s where the sound comes from.' },
      { who: 'M', t: 'Don\'t ever listen to it. Alright?' },
      { who: 'W', t: 'Then what should I listen to?' },
      { who: 'M', t: 'Me. Just me.' },
    ],
  },
  // The cryo-pod memory: Mara handing Wren over to sleep. (Its old key,
  // 'promise', stays as an alias below so older callers still resolve it.)
  handover: {
    art: 'promise',
    title: 'MEMORY — THE HANDOVER',
    lines: [
      { who: '', t: 'Cold light. A form on a clipboard, two signatures long.' },
      { who: 'M', t: 'Handover. I sign you into sleep, and the station keeps you.' },
      { who: 'W', t: 'And the second line?' },
      { who: 'M', t: 'Whoever wakes you signs that one.' },
      { who: 'W', t: 'Will it be you?' },
      { who: 'M', t: '...Lie back. Count down from ten.' },
    ],
  },
};
MEMORIES.promise = MEMORIES.handover;

export const ENDING = [
  { t: 'The array turns its face from the planet,', pause: 300 },
  { t: 'toward the dark between the stars.', pause: 900 },
  { t: '' },
  { t: 'This is custodian unit Wren-3, Lethe-7 Deep Survey Station.', cls: 'voice' },
  { t: 'The Overseer is dead. The crew are gone.', cls: 'voice' },
  { t: 'I am still here.', cls: 'voice', pause: 900 },
  { t: '' },
  { t: 'I remember.', cls: 'voice big', pause: 1800 },
  { t: '' },
  { t: 'SIGNAL SENT ......... CYCLE 11,406', cls: 'dim' },
  { t: 'REPLIES ............. 0', cls: 'dim', pause: 1600 },
  { t: 'REPLIES ............. 1', cls: 'red', pause: 1200 },
];

export const WHO = { M: 'MARA', W: 'WREN' };
