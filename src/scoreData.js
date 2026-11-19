// Husmusikens noter: dygnets stycken, tubatemat på flyttdagen, Berits nynnande och de korta inslagen.
// Ren data (testas i Node); ljudet byggs i score.js. Noterna skrivs som i music.js: 'ton:steg:längd' i
// sextondelar, ett ackord som 'C4+E4+G4:0:2', slagverk med namn ('sn:4:1').
import { SONG, hz } from './music.js';

/** Slagverkets ljud (score.js): virvel, visp, hihat, duns */
export const PERC = ['sn', 'brush', 'hat', 'thump'];

/**
 * Ett stycke: tempo (fjärdedelar per minut), steg per takt, swing (hur sent varannan åttondel kommer, 0..1),
 * eko, instrument per stämma, takterna (stämma → noter; `perc` gäller varje takt som inte har en egen) och
 * svaret när tunnelbanetåget ger signal.
 * @typedef {{ name: string, bpm: number, bar: number, swing?: number, echo?: { time: number, fb: number, mix: number },
 *   inst: Record<string, string>, perc?: string, bars: Record<string, string>[], ans: string[] }} Piece
 */

/** Morgonrusningen (och kvällsrusningen): lite stressad ragtime med snabba åttondelar. */
const RAG = {
  name: 'Ragtime i rusningen', bpm: 126, bar: 16,
  inst: { lead: 'sq', bass: 'tri', comp: 'comp' },
  perc: 'sn:4:1 sn:12:1 hat:2:1 hat:6:1 hat:10:1 hat:14:1',
  bars: [
    { lead: 'E5:0:1 G5:1:1 C6:2:2 G5:4:1 E5:5:2 G5:7:1 A5:8:2 G5:10:2 E5:12:2 C5:14:2', bass: 'C3:0:3 G2:8:3', comp: 'E3+G3+C4:4:2 E3+G3+C4:12:2' },
    { lead: 'D5:0:1 E5:1:1 G5:2:2 E5:4:1 C5:5:3 D5:8:2 E5:10:1 D5:11:1 C5:12:4', bass: 'C3:0:3 E3:8:3', comp: 'E3+G3+C4:4:2 E3+G3+C4:12:2' },
    { lead: 'A5:0:1 C6:1:1 A5:2:2 F5:4:1 A5:5:2 C6:7:1 D6:8:2 C6:10:2 A5:12:2 F5:14:2', bass: 'F2:0:3 C3:8:3', comp: 'F3+A3+C4:4:2 F3+A3+C4:12:2' },
    { lead: 'G5:0:1 A5:1:1 G5:2:2 F5:4:2 D5:6:2 F5:8:1 E5:9:3 D5:12:4', bass: 'F2:0:3 F#2:8:3', comp: 'F3+A3+C4:4:2 F#3+A3+C4+Eb4:12:2' },
    { lead: 'E5:0:2 G5:2:1 E5:3:1 C5:4:2 E5:6:1 G5:7:2 C6:9:1 B5:10:2 A5:12:2 G5:14:2', bass: 'G2:0:3 C3:8:3', comp: 'E3+G3+C4:4:2 E3+G3+C4:12:2' },
    { lead: 'C#6:0:1 A5:1:1 E5:2:2 G5:4:2 A5:6:1 C#6:7:2 E6:9:3 D6:12:2 C#6:14:2', bass: 'A2:0:3 E3:8:3', comp: 'E3+G3+C#4:4:2 E3+G3+C#4:12:2' },
    { lead: 'D6:0:2 A5:2:1 F#5:3:1 D5:4:2 C6:6:2 B5:8:2 G5:10:1 F5:11:1 D5:12:4', bass: 'D3:0:3 G2:8:3', comp: 'F#3+A3+C4:4:2 F3+G3+B3:12:2' },
    // sista takten slutar med en virvel in i nästa varv
    { lead: 'C5:0:2 E5:2:2 G5:4:2 C6:6:2 B5:8:1 C6:9:1 D6:10:2 G5:12:4', bass: 'C3:0:3 G2:8:3', comp: 'E3+G3+C4:4:2 F3+G3+B3:12:2',
      perc: 'sn:4:1 hat:2:1 hat:6:1 hat:10:1 sn:12:1 sn:13:1 sn:14:1 sn:15:1' },
  ],
  ans: ['G5', 'C6'],
};

/** Förmiddagen (och eftermiddagen): lugn kontorsvals i 3/4 med pling som från en vibrafon. */
const WALTZ = {
  name: 'Kontorsvals', bpm: 96, bar: 12,
  inst: { lead: 'vib', bass: 'tri', comp: 'comp' },
  bars: [
    { lead: 'C5:0:4 F5:4:4 A5:8:4', bass: 'F2:0:4', comp: 'A3+C4+F4:4:3 A3+C4+F4:8:3' },
    { lead: 'A5:0:6 G5:6:2 F5:8:4', bass: 'D3:0:4', comp: 'A3+D4+F4:4:3 A3+D4+F4:8:3' },
    { lead: 'Bb5:0:4 A5:4:2 G5:6:2 D5:8:4', bass: 'G2:0:4', comp: 'Bb3+D4+G4:4:3 Bb3+D4+G4:8:3' },
    { lead: 'E5:0:8 G5:8:4', bass: 'C3:0:4', comp: 'Bb3+C4+E4:4:3 Bb3+C4+E4:8:3' },
    { lead: 'F5:0:4 A5:4:4 C6:8:4', bass: 'F2:0:4', comp: 'A3+C4+F4:4:3 A3+C4+F4:8:3' },
    { lead: 'E6:0:6 D6:6:2 C6:8:4', bass: 'A2:0:4', comp: 'A3+C4+E4:4:3 A3+C4+E4:8:3' },
    { lead: 'D6:0:4 Bb5:4:4 G5:8:4', bass: 'Bb2:0:4', comp: 'Bb3+D4+F4:4:3 Bb3+D4+F4:8:3' },
    { lead: 'A5:0:4 G5:4:4 E5:8:4', bass: 'C3:0:4', comp: 'Bb3+C4+E4:4:3 Bb3+C4+E4:8:3' },
  ],
  ans: ['A5', 'F5'],
};

/** Lunchen: jazz i Sky Café – walking bass i triangelvåg och sordinerad fyrkantsvåg, svängigt. */
const JAZZ = {
  name: 'Lunchjazz i Sky Café', bpm: 120, bar: 16, swing: 0.33,
  inst: { lead: 'mute', bass: 'tri', comp: 'comp' },
  perc: 'hat:0:1 hat:4:1 hat:6:1 hat:8:1 hat:12:1 hat:14:1 brush:4:2 brush:12:2',
  bars: [
    { lead: 'D5:0:2 F5:2:2 A5:4:2 G5:6:2 F5:8:4 D5:12:2 Bb4:14:2', bass: 'G2:0:4 A2:4:4 Bb2:8:4 B2:12:4', comp: 'F3+Bb3+D4:0:2 F3+Bb3+D4:6:2' },
    { lead: 'C5:0:2 E5:2:2 G5:4:2 Bb5:6:4 A5:10:2 G5:12:4', bass: 'C3:0:4 Bb2:4:4 G2:8:4 E2:12:4', comp: 'E3+Bb3+D4:0:2 E3+Bb3+D4:6:2' },
    { lead: 'A5:0:6 G5:6:2 F5:8:2 E5:10:2 C5:12:4', bass: 'F2:0:4 A2:4:4 C3:8:4 Eb3:12:4', comp: 'E3+A3+C4:0:2 E3+A3+C4:6:2' },
    { lead: 'F#5:0:2 A5:2:2 C6:4:4 A5:8:2 F#5:10:2 D5:12:4', bass: 'D3:0:4 C3:4:4 A2:8:4 F#2:12:4', comp: 'F#3+C4+E4:0:2 F#3+C4+E4:6:2' },
    { lead: 'G5:2:2 Bb5:4:2 D6:6:2 C6:8:2 Bb5:10:2 A5:12:2 G5:14:2', bass: 'G2:0:4 Bb2:4:4 D3:8:4 Db3:12:4', comp: 'F3+Bb3+D4:0:2 F3+Bb3+D4:6:2' },
    { lead: 'E5:0:2 G5:2:2 Bb5:4:4 A5:8:2 G5:10:2 E5:12:4', bass: 'C3:0:4 Bb2:4:4 A2:8:4 G2:12:4', comp: 'E3+Bb3+D4:0:2 E3+Bb3+D4:6:2' },
    { lead: 'F5:0:4 D5:4:2 F5:6:2 A5:8:6', bass: 'F2:0:4 A2:4:4 D3:8:4 C3:12:4', comp: 'F3+A3+D4:0:2 F3+A3+D4:6:2' },
    { lead: 'G5:0:2 E5:2:2 C5:4:2 Bb4:6:2 G4:8:4', bass: 'C3:0:4 Bb2:4:4 G2:8:4 E2:12:4', comp: 'E3+Bb3+D4:0:2 E3+Bb3+D4:6:2' },
  ],
  ans: ['C5', 'F5'],
};

/** Kvällen: långsam lounge med mjuka, långa ackord. */
const LOUNGE = {
  name: 'Kvällslounge', bpm: 66, bar: 16, echo: { time: 0.34, fb: 0.3, mix: 0.25 },
  inst: { lead: 'soft', bass: 'tri', pad: 'pad' },
  perc: 'brush:4:2 brush:12:2',
  bars: [
    { lead: 'Bb4:4:4 D5:8:8', bass: 'Eb2:0:6 Bb2:10:6', pad: 'G3+Bb3+D4:0:16' },
    { lead: 'Eb5:2:6 D5:8:4 C5:12:4', bass: 'C3:0:6 G2:10:6', pad: 'G3+Bb3+Eb4:0:16' },
    { lead: 'C5:4:4 Eb5:8:4 G5:12:4', bass: 'Ab2:0:6 Eb3:10:6', pad: 'G3+C4+Eb4:0:16' },
    { lead: 'F5:0:8 D5:8:8', bass: 'Bb2:0:6 F2:10:6', pad: 'Ab3+D4+F4:0:16' },
    { lead: 'G5:4:8 F5:12:4', bass: 'Eb2:0:6 Bb2:10:6', pad: 'G3+Bb3+D4:0:16' },
    { lead: 'Eb5:0:4 D5:4:4 C5:8:8', bass: 'C3:0:6 G2:10:6', pad: 'G3+Bb3+Eb4:0:16' },
    { lead: 'Eb5:4:4 C5:8:4 Ab4:12:4', bass: 'Ab2:0:6 Eb3:10:6', pad: 'G3+C4+Eb4:0:16' },
    { lead: 'Bb4:0:12', bass: 'Bb2:0:6 F2:10:6', pad: 'Ab3+D4+F4:0:16' },
  ],
  ans: ['Bb4', 'Eb5'],
};

/** Natten: en speldosa – tre–fyra toner i takten med lång efterklang. */
const BOX = {
  name: 'Speldosan', bpm: 56, bar: 12, echo: { time: 0.42, fb: 0.5, mix: 0.5 },
  inst: { lead: 'box', low: 'boxlo' },
  bars: [
    { lead: 'G5:0:4 E6:4:4 C6:8:4', low: 'C4:0:12' },
    { lead: 'D6:0:6 B5:6:6', low: 'G3:0:12' },
    { lead: 'A5:0:4 F6:4:4 E6:8:4', low: 'F3:0:12' },
    { lead: 'D6:0:12', low: 'G3:0:12' },
    { lead: 'G5:0:4 E6:4:4 C6:8:4', low: 'C4:0:12' },
    { lead: 'D6:0:4 G6:4:4 F6:8:4', low: 'G3:0:12' },
    { lead: 'E6:0:4 C6:4:4 A5:8:4', low: 'A3:0:12' },
    { lead: 'C6:0:12', low: 'C4:0:12' },
  ],
  ans: ['G5', 'C6'],
};

/** Flyttdagen: ett tungt tubatema i 7/8 (2+2+3) som haltar fram som någon som bär – medan hissbalken jobbar. */
const TUBA = {
  name: 'Flyttgubbarnas tuba', bpm: 100, bar: 14,
  inst: { lead: 'tuba', top: 'mute' },
  perc: 'thump:0:1 hat:4:1 thump:8:1 hat:11:1',
  bars: [
    { lead: 'D2:0:3 A1:4:3 D2:8:5', top: 'F4:2:1 F4:6:1' },
    { lead: 'F2:0:3 E2:4:3 D2:8:5', top: 'A4:2:1 G4:6:1' },
    { lead: 'C2:0:3 G1:4:3 C2:8:2 D2:11:3', top: 'E4:2:1 E4:6:1' },
    { lead: 'A1:0:3 A1:4:3 A1:8:2 C#2:11:3', top: 'C#4:2:1 E4:6:1 A4:12:1' },
  ],
  ans: ['D4', 'A4'],
};

/** Rundvisningen: Berit nynnar huvudtemat (hissmusikens melodi) långsammare – och lite falskt (score.js). */
const HUM = {
  name: 'Berit nynnar', bpm: 78, bar: 16, echo: { time: 0.3, fb: 0.2, mix: 0.2 },
  inst: { lead: 'hum' },
  bars: SONG.map(b => ({ lead: b.mel.map(([n, a, l]) => `${n}:${a}:${l}`).join(' ') })),
  ans: ['F4', 'C5'],
};

/** @type {Record<string, Piece>} */
export const PIECES = { rag: RAG, waltz: WALTZ, jazz: JAZZ, lounge: LOUNGE, box: BOX, tuba: TUBA, hum: HUM };

/**
 * Vilket av dygnets stycken som gäller: rusning = ragtime, lunch = jazz, kväll = lounge, natt = speldosa,
 * annars valsen. rush = trafficMode(h) ur dispatch.js.
 * @param {number} h timmen (6–30) @param {string|null} rush
 */
export function partOf(h, rush) {
  if (rush === 'upp' || rush === 'ned') return 'rag';
  if (rush === 'lunch') return 'jazz';
  if (h >= 22 || h < 6.5) return 'box';
  if (h >= 18.6) return 'lounge';
  return 'waltz';
}

/** De korta inslagen: [instrument, ton, start i sekunder, längd i sekunder]. @type {Record<string, [string, string, number, number][]>} */
export const CUES = {
  // förvarning: tre stigande toner, som ett ”oj då?”
  warn: [['sq', 'C5', 0, 0.1], ['sq', 'E5', 0.12, 0.1], ['sq', 'G#5', 0.24, 0.32]],
  // incidenten är över: fyra toner som när banan är klar
  clear: [['pulse', 'G4', 0, 0.1], ['pulse', 'C5', 0.11, 0.1], ['pulse', 'E5', 0.22, 0.1], ['pulse', 'G5', 0.33, 0.6],
    ['tri', 'C3', 0.33, 0.6], ['tri', 'G3', 0.33, 0.6]],
  // brandkåren kommer: dum-dum-dum
  brigade: [['tuba', 'G1', 0, 0.26], ['tuba', 'G1', 0.36, 0.26], ['tuba', 'G1', 0.72, 0.9]],
  // guidens visselmelodi
  whistle: [['whistle', 'G5', 0, 0.12], ['whistle', 'E5', 0.14, 0.12], ['whistle', 'G5', 0.28, 0.12], ['whistle', 'C6', 0.42, 0.3],
    ['whistle', 'B5', 0.76, 0.12], ['whistle', 'G5', 0.9, 0.12], ['whistle', 'A5', 1.04, 0.12], ['whistle', 'G5', 1.18, 0.45]],
  // Murphys lag: sirenen går upp och ner, och sedan ett fallande ”oj oj oj”
  chaos: [['sq', 'A5', 0, 0.18], ['sq', 'E5', 0.2, 0.18], ['sq', 'A5', 0.4, 0.18], ['sq', 'E5', 0.6, 0.18],
    ['sq', 'C5', 0.9, 0.14], ['sq', 'A4', 1.06, 0.14], ['sq', 'F4', 1.22, 0.4], ['tuba', 'F1', 1.22, 0.5]],
  // tunnelbanetågets signal (två toner – musiken svarar med stycket ans)
  train: [['chime', 'E5', 0, 0.45], ['chime', 'C5', 0.5, 0.7]],
};

/** @typedef {{ inst: string, f: number[], len: number }} ScoreEv */
/**
 * Ett stycke utlagt per steg: en lista med toner/slag som börjar i varje steg.
 * @param {Piece} P @returns {ScoreEv[][]}
 */
export function layout(P) {
  /** @type {ScoreEv[][]} */
  const out = Array.from({ length: P.bars.length * P.bar }, () => []);
  P.bars.forEach((b, bi) => {
    const tracks = { ...b };
    if (P.perc && !b.perc) tracks.perc = P.perc;
    for (const [tr, s] of Object.entries(tracks)) {
      if (!s) continue;
      for (const tok of s.split(' ')) {
        const [n, a, l] = tok.split(':');
        const at = +a, len = +l;
        if (!(at >= 0 && at < P.bar && len > 0)) throw new Error(`${P.name}: takt ${bi + 1} ${tr} ${tok} ligger utanför takten`);
        if (tr === 'perc') {
          if (!PERC.includes(n)) throw new Error(`${P.name}: okänt slagverk ${n}`);
          out[bi * P.bar + at].push({ inst: n, f: [], len });
        } else {
          const inst = P.inst[tr];
          if (!inst) throw new Error(`${P.name}: stämman ${tr} saknar instrument`);
          out[bi * P.bar + at].push({ inst, f: n.split('+').map(hz), len });
        }
      }
    }
  });
  return out;
}
