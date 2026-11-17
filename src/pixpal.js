// Pixelgrafikens färgpalett: "Kontor 95" – grått och beige som en 90-talsdator, med blågrönt och
// marinblått. Alla byggnadsfärger i pixelgrafiken (pix*.js) hämtas härifrån. Hissarnas färger (EL.color) och
// våningarnas accentfärger (acc) ligger i config.js och är valda i samma palett.
// Signalfärger (brand, spårning, nödskyltar) ligger kvar i ritkoden – de ska synas i alla paletter.

export const PAL = {
  ink: '#1a1a1a',
  // fasad, tegel och källare
  shell: '#9e9a8f', brick: '#a8a395', mortar: '#8f8a7e', basement: '#7d786d',
  glass: '#a8d0e6', glassNight: '#2c3440', lit: '#fff3b0',
  // schakt, bjälklag och dörrkarmar
  shaftOuter: '#2f3a48', shaft: '#3c4a5c', rail: '#5b6b80', railDot: '#71839c', express: '#8a98ab',
  steel: '#c0c0c0', slab: '#6d675a', slabHi: '#8a8475', frame: '#d4d0c8',
  // våningsdisplayer
  lantern: '#101418', led: '#ffb000', dim: '#3a3f48',
  // hallen
  wall: '#e8e2d0', wain: '#c9c1a8', wainLine: '#8f876e', panel: '#bdb59a', floor: '#6d675a',
  corridor: '#2b2f36', corrA: '#3a3f48', corrB: '#42474f', corrEdge: '#555b66',
  // hisskorgen
  carOff: '#a0a0a0', cabin: '#efe9d8', cabinFreight: '#d8d4cc', cabinGlass: '#d6ecf5',
  doorGlass: 'rgba(192,192,192,.4)', doorLow: 'rgba(150,150,150,.8)', doorTop: '#dcdcdc', doorEdge: '#606878',
  // lappar och bubblor (Windows-gul spårlapp)
  note: '#ffffe1', noteText: '#404040',
  // staden och marken
  city: '#8d97a5', cityNight: '#2c3440', dirt: '#7c6a52', dirtStripe: '#6b5a44', pebble: '#8f7c62', walk: '#c0c0c0', walkLine: '#a0a0a0',
  // maskinrum och takskylt (fönsterknappsgrått och titelradsblått)
  machine: '#d4d0c8', machineHi: '#ffffff', wheelRim: '#d4d0c8', wheelIn: '#b8b4ac',
  sign: '#000080', signHi: '#1084d0', signLo: '#000050', bulbOn: '#ffff80', bulbOff: '#404070',
  green: '#008000',
  /** text som syns på en färgad bakgrund: svart på ljust, vitt på mörkt */
  on: c => { const n = parseInt(c.slice(1, 7), 16), l = 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255); return l > 140 ? '#1a1a1a' : '#ffffff'; },
};
