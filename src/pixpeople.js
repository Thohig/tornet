// Pixelgrafik: människor och deras bagage som rutnätsfigurer (12 × 24 pixlar med kontur).
// Varje person ritas ihop från sitt utseende (p.look) – hudfärg, frisyr, kläder, slips, tillbehör –
// och sparas per utseende, vy, gångsteg och humör så att varje figur bara byggs en gång.
import { PAL } from './pixpal.js';

const INK = PAL.ink;
import { blend, dark, light, fromCells, flipped, sprite } from './pixart.js';

const W = 10, H = 22; // figurens yta utan kontur (konturen lägger till 1 pixel runtom)
export const PERSON_W = W + 2, PERSON_H = H + 2;

/**
 * @param {any} look  p.look
 * @param {{ view: 'side'|'front', frame: number, mood: number, blink: boolean, child: boolean, hot: boolean, smoked: boolean }} o
 */
function build(look, o) {
  const cells = Array.from({ length: H }, () => new Array(W).fill(null));
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H && c) cells[y][x] = c; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c); };
  let skin = look.skin;
  if (o.hot) skin = blend(skin, '#ff4b3a', 0.55);
  if (o.smoked) skin = blend(skin, '#6b6b7a', 0.45);
  const P = {
    S: skin, s: dark(skin, 0.18), H: look.hairC, h: dark(look.hairC, 0.3),
    T: look.shirt, t: dark(look.shirt, 0.25), R: light(look.shirt, 0.45),
    L: look.pants, l: dark(look.pants, 0.3), N: look.tieC, B: '#2a1d3a', E: INK, W: '#ffffff', M: '#7a2033',
  };
  const front = o.view === 'front';
  const stride = !front && (o.frame === 1 || o.frame === 3);
  // höjder: barn har kortare kropp och ben; i steget sjunker kroppen en pixel
  const head = o.child ? 6 : 1, bob = stride ? 1 : 0;
  const hy = head + bob;                           // huvudets översta rad
  const ty = hy + 6, tl = o.child ? 4 : 7;         // överkropp: start och längd
  const hip = ty + tl;                             // byxlinning
  const feet = H - 1;

  // ----- ben (bakom kroppen) -----
  if (front) {
    rect(2, hip + 1, 3, feet - 1, P.L); rect(6, hip + 1, 7, feet - 1, P.L);
    rect(1, feet, 3, feet, P.B); rect(6, feet, 8, feet, P.B);
  } else if (!stride) {
    rect(2, hip + 1, 3, feet - 1, P.l); rect(5, hip + 1, 6, feet - 1, P.L);
    rect(2, feet, 4, feet, P.B); rect(5, feet, 7, feet, P.B);
  } else {
    // steg: ena benet fram, andra bak (frame 1 och 3 byter vilket ben som är främst)
    const fwd = o.frame === 1 ? P.L : P.l, back = o.frame === 1 ? P.l : P.L;
    const n = feet - hip - 1; // antal rader ben ovanför skon
    for (let i = 0; i < n; i++) {
      const y = hip + 1 + i, k = Math.floor((i * 3) / n);
      rect(1 - k + 2, y, 2 - k + 2, y, back);  // bakre benet glider bakåt
      rect(5 + k, y, 6 + k, y, fwd);           // främre benet glider framåt
    }
    rect(0, feet, 2, feet, P.B); rect(7, feet, 9, feet, P.B);
  }
  // ----- frisyr bakom huvudet (afro, långt hår) -----
  if (look.hair === 6) { rect(1, hy - 1, 8, hy + 3, P.H); rect(0, hy + 1, 9, hy + 2, P.H); }
  if (look.hair === 5) { if (front) { rect(1, hy + 1, 1, hy + 7, P.H); rect(8, hy + 1, 8, hy + 7, P.H); } else rect(1, hy + 1, 2, hy + 7, P.h); }
  // ryggsäck
  if (look.acc === 5 && !front) rect(0, ty + 1, 1, ty + tl - 2, '#ff5d52');
  // ----- överkropp -----
  rect(2, ty, 7, hip - 1, P.T);
  if (front) { rect(1, ty + 1, 1, hip - 2, P.t); rect(8, ty + 1, 8, hip - 2, P.t); }
  else rect(2, ty, 2, hip - 1, P.t);
  if (look.stripe) rect(front ? 2 : 3, ty + 2, 7, ty + 2, P.R);
  if (look.tie && !o.child) {
    const tx = front ? 4 : 6;
    rect(tx, ty, front ? tx + 1 : tx, ty + 3, P.N); if (front) set(tx, ty + 4, P.N); else set(tx, ty + 4, P.N);
  }
  rect(2, hip, 7, hip, P.l); // bälte/byxlinning
  // armar och händer
  const swing = !front && stride ? (o.frame === 1 ? 1 : -1) : 0;
  if (front) { set(1, hip - 1, P.S); set(8, hip - 1, P.S); }
  else {
    rect(4 + swing, ty + 1, 5 + swing, hip - 2, P.t);
    rect(4 + swing, hip - 1, 5 + swing, hip - 1, P.S);
    // portfölj i handen / kaffekopp
    if (look.acc === 1) rect(4 + swing, hip, 7 + swing, hip + 2, '#8a5a2b');
    if (look.acc === 2) { rect(7, ty + 2, 8, ty + 4, '#ffffff'); set(7, ty + 3, '#ff4fa3'); set(8, ty + 3, '#ff4fa3'); }
  }
  // ----- huvud -----
  rect(2, hy, 7, hy + 5, P.S);
  rect(3, hy + 5, 6, hy + 5, P.s);
  // ögon och mun
  const ex = front ? [3, 6] : [4, 6], mx = front ? [4, 5] : [5, 6];
  if (look.acc === 3) rect(ex[0] - 1, hy + 2, ex[1] + (front ? 1 : 1), hy + 2, P.E); // solglasögon
  else if (o.blink) for (const x of ex) set(x, hy + 2, P.s);
  else for (const x of ex) set(x, hy + 2, P.E);
  if (o.mood >= 1) { set(ex[0], hy + 1, P.E); set(ex[1], hy + 1, P.E); if (o.mood === 2) { set(ex[0] + (front ? -1 : 0), hy + 1, P.h); } }
  if (o.mood === 0) { set(mx[0], hy + 4, P.M); set(mx[1], hy + 4, P.M); set(mx[0] - 1, hy + 3, P.s); set(mx[1] + 1, hy + 3, P.s); }
  else if (o.mood === 1) { set(mx[0], hy + 4, P.E); set(mx[1], hy + 4, P.E); }
  else { rect(mx[0], hy + 3, mx[1], hy + 4, P.E); set(mx[0], hy + 3, P.W); }
  // ----- frisyr ovanpå -----
  switch (look.hair) {
    case 0: set(3, hy, light(P.S, 0.5)); break;                                   // flint med glans
    case 1: rect(2, hy - 1, 7, hy, P.H); set(2, hy + 1, P.h); if (front) set(7, hy + 1, P.h); break; // platt topp
    case 2: case 5:                                                                 // sidbena
      rect(2, hy - 1, 7, hy, P.H); set(2, hy + 1, P.H); set(front ? 7 : 3, hy + 1, P.h);
      if (!front) set(7, hy + 1, P.H);
      break;
    case 3:                                                                         // spretigt
      rect(2, hy, 7, hy, P.H); for (const x of [2, 4, 6]) set(x, hy - 1, P.H); set(front ? 8 : 1, hy - 1, P.h); set(2, hy + 1, P.h);
      break;
    case 4: {                                                                       // keps
      const C = look.tieC;
      rect(2, hy - 1, 7, hy, C); set(4, hy - 1, light(C, 0.4));
      if (front) rect(1, hy + 1, 8, hy + 1, dark(C, 0.25)); else rect(5, hy + 1, 9, hy + 1, dark(C, 0.25));
      break;
    }
    case 6: rect(1, hy - 1, 8, hy, P.H); break;                                    // afro (ovansidan)
  }
  // hörlurar
  if (look.acc === 4) {
    rect(2, hy - 1, 7, hy - 1, P.E);
    if (front) { rect(1, hy + 1, 1, hy + 3, '#36c5d6'); rect(8, hy + 1, 8, hy + 3, '#36c5d6'); }
    else rect(2, hy + 1, 3, hy + 3, '#36c5d6');
  }
  return fromCells(cells, W, H, 1, INK);
}

const CACHE = new WeakMap();
/** figuren för en person; dir < 0 = vänd åt vänster */
export function personSprite(p, view, frame, dir, extra = {}) {
  const look = p.look;
  let m = CACHE.get(look);
  if (!m) { m = new Map(); CACHE.set(look, m); }
  const o = { view, frame: view === 'front' ? 0 : frame, mood: p.mood || 0, blink: !!extra.blink, child: !!p.child, hot: !!extra.hot, smoked: !!p.smoked };
  const key = `${o.view}${o.frame}${o.mood}${+o.blink}${+o.child}${+o.hot}${+o.smoked}${dir < 0 && view !== 'front' ? 'L' : 'R'}`;
  let c = m.get(key);
  if (!c) {
    if (dir < 0 && view !== 'front') {
      const rk = key.slice(0, -1) + 'R';
      let r = m.get(rk);
      if (!r) { r = build(look, o); m.set(rk, r); }
      c = flipped(r);
    } else c = build(look, o);
    m.set(key, c);
  }
  return c;
}

// ----- bagage (åt höger; spegelvänds vid behov) -----
const POODLE = { W: '#fff4fb', w: '#e3c9dc', K: INK, N: '#2a1d3a', P: '#ff4fa3' };
const SHAGGY = { W: '#b9a27e', w: '#8f7a58', K: INK, N: '#2a1d3a', P: '#3f7cff' }; // ostklippt: brunaktig och tovig
const CARGO_ROWS = {
  resväska: { rows: ['.KK..', 'BBBBBB', 'BBBBBB', 'YYYYYY', 'BBBBBB', 'BBBBBB', 'BBBBBB', 'K....K'], pal: { B: '#3f7cff', Y: '#ffe14d', K: INK }, dx: -12 },
  städvagn: { rows: ['......M', '......M', '......M', '.....M.', '.YYYYY.', 'CCCCCCC', 'CCCCCCC', 'CCCCCCC', 'CCCCCCC', 'K.....K'], pal: { C: '#36c5d6', Y: '#ffe14d', M: '#ffffff', K: INK }, dx: 8 },
  verktygslåda: { rows: ['.KKK.', 'RRRRR', 'RRRRR', 'RRRRR'], pal: { R: '#ff5d52', K: INK }, dx: 4 },
  pizza: { rows: ['PPPPPPP', 'PPPRPPP', 'PPPPPPP', 'PPPPPPP'], pal: { P: '#f5deb3', R: '#ff5d52' }, dx: -1 },
  // budets paketkärra: två kartonger med tejp på en säckkärra
  paket: { rows: ['KK......', '.K.BBBB.', '.K.BYYB.', '.K.BBBB.', '.KBBBBBB', '.KBYYYYB', '.KBBBBBB', '.KBBBBBB', '.KKKKKKK', '.WW.....', '.WW.....'],
    pal: { B: '#b07a45', Y: '#e8d27a', K: INK, W: '#5a5a6e' }, dx: 6 },
  // ambulansens bår (tom, och med patienten under en filt), akutväskan, flyttgubbarnas lådor och filtar
  bår: { rows: ['..............', 'WWWWWWWWWWWWWW', 'KKKKKKKKKKKKKK', '.K..........K.', '.K..........K.', 'KK..........KK'], pal: { W: '#ffffff', K: INK }, dx: 5 },
  bårP: { rows: ['.SSS.TTTTTTTT.', 'WSSSWTTTTTTTTW', 'KKKKKKKKKKKKKK', '.K..........K.', '.K..........K.', 'KK..........KK'], pal: { W: '#ffffff', S: '#f6c48f', T: '#2ec4b6', K: INK }, dx: 5 },
  väska: { rows: ['.KKK.', 'RRRRR', 'RRWRR', 'RWWWR', 'RRWRR'], pal: { R: '#ff5d52', W: '#ffffff', K: INK }, dx: 4 },
  flyttlåda: { rows: ['BBBBBBBB', 'BBBYYBBB', 'BBBBBBBB', 'BBBBBBBB', 'BBBBBBBB', 'BBBBBBBB'], pal: { B: '#b07a45', Y: '#e8d27a' }, dx: 2 },
  filtar: { rows: ['FFFFF', 'GGGGG', 'FFFFF'], pal: { F: '#3f5f9f', G: '#5577b8' }, dx: -2 },
  // flyttdagens bohag på flyttkärra (kärrans hjul längst ner)
  kartonger: { rows: ['.BBBBBB.', '.BYYYYB.', '.BBBBBB.', 'BBBBBBBB', 'BYYYYYYB', 'BBBBBBBB', 'BBBBBBBB', 'BYYYYYYB', 'BBBBBBBB', 'KKKKKKKK', '.W....W.'],
    pal: { B: '#b07a45', Y: '#e8d27a', K: INK, W: '#5a5a6e' }, dx: 4 },
  soffa: { rows: ['SS............SS', 'SSSSSSSSSSSSSSSS', 'SDDDDDDDDDDDDDDS', 'SSSSSSSSSSSSSSSS', '.K............K.', 'KKKKKKKKKKKKKKKK', '.W............W.'],
    pal: { S: '#c0392b', D: '#96281b', K: INK, W: '#5a5a6e' }, dx: 4 },
  hylla: { rows: ['HHHHHH', 'HbrgbH', 'HHHHHH', 'HrbgrH', 'HHHHHH', 'HgbrbH', 'HHHHHH', 'H....H', 'HHHHHH', 'KKKKKK', '.W..W.'],
    pal: { H: '#8a5a2b', b: '#3f7cff', r: '#ff5d52', g: '#7cf06b', K: INK, W: '#5a5a6e' }, dx: 4 },
  madrass: { rows: ['MMMMM', 'MbMbM', 'MMMMM', 'MbMbM', 'MMMMM', 'MbMbM', 'MMMMM', 'MbMbM', 'MMMMM', 'MbMbM', 'MMMMM', 'KKKKK', '.W.W.'],
    pal: { M: '#f5deb3', b: '#7fb2e5', K: INK, W: '#5a5a6e' }, dx: 4 },
  kyl: { rows: ['FFFFFFF', 'FFFFFKF', 'FFFFFKF', 'FFFFFFF', 'LLLLLLL', 'FFFFFFF', 'FFFFFKF', 'FFFFFKF', 'FFFFFFF', 'FFFFFFF', 'KKKKKKK', '.W...W.'],
    pal: { F: '#f2f2f2', L: '#b8b8b8', K: INK, W: '#5a5a6e' }, dx: 4 },
  kassaskap: { rows: ['GGGGGGGG', 'GDDDDDDG', 'GDGGGGDG', 'GDGYYGDG', 'GDGYYGDG', 'GDGGGGDG', 'GDDDDDDG', 'GGGGGGGG', 'KKKKKKKK', '.R....R.'],
    pal: { G: '#5a6670', D: '#3d4650', Y: '#d4a017', K: INK, R: '#5a5a6e' }, dx: 4 },
  piano: { rows: ['PPPPPPPPPP', 'PPPPPPPPPP', 'PGPPPPPPGP', 'PPPPPPPPPP', 'WKWKWWKWKW', 'PPPPPPPPPP', 'PPPPPPPPPP', 'PPPPPPPPPP', 'PP......PP', 'KKKKKKKKKK', '.R......R.'],
    pal: { P: '#2b2233', G: '#d4a017', W: '#ffffff', K: INK, R: '#5a5a6e' }, dx: 4 },
  // pudeln från hundsalongen i koppel: två gångsteg, sittande (när matte/husse väntar) och framifrån (i hissen)
  pudel: { rows: ['......WW..', '.....WWWW.', '.....WWKWN', 'WW...PWWW.', 'WWwWWWWW..', '..WWWWWW..', '..w....w..', '.WW...WW..'], pal: POODLE, dx: 7 },
  pudel2: { rows: ['......WW..', '.....WWWW.', '.....WWKWN', 'WW...PWWW.', 'WWwWWWWW..', '..WWWWWW..', '...w..w...', '..WW.WW...'], pal: POODLE, dx: 7 },
  pudelS: { rows: ['......WW..', '.....WWWW.', '.....WWKWN', '.....PWWW.', 'WW..WWWW..', 'WWwWWWWW..', '..WWWWWW..', '.WWWWW.WW.'], pal: POODLE, dx: 6 },
  pudelF: { rows: ['.WWWWW.', 'WWKWKWW', '.WWNWW.', '..PPP..', '.WWWWW.', '.W...W.', 'WW...WW'], pal: POODLE, dx: 0 },
  // den raggiga pudeln (på väg till klippning): tovig päls som hänger ner
  ragg: { rows: ['.....wWW..', '....WWWWW.', '....wWWKWN', 'wW..PWWWw.', 'WWwWWWWWw.', '.wWWWWWWw.', '.ww....ww.', '.WW...WW..'], pal: SHAGGY, dx: 7 },
  ragg2: { rows: ['.....wWW..', '....WWWWW.', '....wWWKWN', 'wW..PWWWw.', 'WWwWWWWWw.', '.wWWWWWWw.', '..ww..ww..', '..WW.WW...'], pal: SHAGGY, dx: 7 },
  raggS: { rows: ['.....wWW..', '....WWWWW.', '....wWWKWN', '....PWWWw.', 'wW.WWWWWw.', 'WWwWWWWWw.', '.wWWWWWWw.', '.WWWWW.WW.'], pal: SHAGGY, dx: 6 },
  raggF: { rows: ['wWWWWWw', 'WWKWKWW', 'wWWNWWw', '.wPPPw.', 'wWWWWWw', '.W...W.', 'WW...WW'], pal: SHAGGY, dx: 0 },
};
const CARGO_CACHE = new Map();
/** bagagefigur + förskjutning i x (pixlar, för en figur vänd åt höger) och höjd över fötterna */
export function cargoSprite(kind, dir) {
  const d = CARGO_ROWS[kind]; if (!d) return null;
  const key = kind + (dir < 0 ? 'L' : 'R');
  let c = CARGO_CACHE.get(key);
  if (!c) {
    const r = sprite(d.rows, d.pal);
    c = dir < 0 ? flipped(r) : r;
    CARGO_CACHE.set(key, c);
  }
  const lift = kind === 'pizza' ? 14 : kind === 'verktygslåda' ? 6 : kind === 'flyttlåda' ? 9 : kind === 'filtar' ? 18 : kind === 'bår' || kind === 'bårP' ? 4 : 0;
  return { c, dx: dir < 0 ? -d.dx - c.width : d.dx, lift };
}
