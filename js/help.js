// help.js — shared instruction content, used by BOTH the on-load
// instructions screen and the in-game help page (reached from pause).
// Content lives as data (helpSections) so it is testable without a DOM;
// helpHtml()/renderHelp() do the actual rendering.

export function helpSections() {
  return [
    {
      title: 'GOAL',
      lines: [
        'Vacuum every mote of dust in the room, then drive to the DOCK to empty your bin.',
        'Clear the room, pick 1 of 3 upgrades, roll deeper. Rooms get dirtier the deeper you go. No fail state.',
      ],
    },
    {
      title: 'CONTROLS',
      lines: [
        'TOUCH — left joystick steers · tap the floor to drive there · BOOST button for a burst.',
        'KEYBOARD — WASD / arrows steer · SPACE boosts · click to drive there · ESC or P pauses.',
      ],
    },
    {
      title: 'DUST',
      lines: [
        'Gold motes are worth 5 dust; common motes are worth 1–4. Heavy motes (big, static, tar) resist suction and drag you down.',
        'When your bin is full you cannot vacuum — dump it at the dock.',
      ],
    },
    {
      title: 'SHARDS',
      lines: [
        'Earn ✦ over time and from dust. Spend them in the HANGAR on permanent upgrades.',
        'The Auto-Bay idles in the hangar and keeps collecting while you are away. Deeper runs unlock new bots.',
      ],
    },
  ];
}

export function helpHtml() {
  return helpSections().map(s =>
    `<div class="help-sec"><h3>${s.title}</h3>` +
    s.lines.map(l => `<p>${l}</p>`).join('') +
    '</div>'
  ).join('');
}

export function renderHelp(el) {
  if (el) el.innerHTML = helpHtml();
}
