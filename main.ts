// VELMORA — travel poster for a place that isn't there.
// A floating island sailing the sky above a sea of clouds, golden hour.
// Pure Node 22 stdlib. No network, no assets. Fixed-seed LCG only, so the
// output PNG is byte-identical across runs.
// Writes /output/entry.png (1024x1024, <= 1 MiB).
import * as fs from 'node:fs';
import * as zlib from 'node:zlib';

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Fixed-seed LCG (deterministic "randomness" for stars, birds, clouds).
// ---------------------------------------------------------------------------
let seed = 0x5eed & 0xffffffff;
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
function rndRange(a: number, b: number): number {
  return a + (b - a) * rnd();
}

// ---------------------------------------------------------------------------
// RGB frame buffer + drawing primitives.
// ---------------------------------------------------------------------------
const buf = Buffer.alloc(W * H * 3);

type RGB = [number, number, number];

function idx(x: number, y: number): number {
  return (y * W + x) * 3;
}

function setPixel(x: number, y: number, c: RGB): void {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = idx(x, y);
  buf[i] = c[0];
  buf[i + 1] = c[1];
  buf[i + 2] = c[2];
}

function blendPixel(x: number, y: number, c: RGB, a: number): void {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = idx(x, y);
  buf[i] = Math.round(c[0] * a + buf[i] * (1 - a));
  buf[i + 1] = Math.round(c[1] * a + buf[i + 1] * (1 - a));
  buf[i + 2] = Math.round(c[2] * a + buf[i + 2] * (1 - a));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(c1: RGB, c2: RGB, t: number): RGB {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
  ];
}

function fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(W - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(H - 1, Math.ceil(y1));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) setPixel(x, y, c);
  }
}

// Vertical gradient over [y0, y1] with stops [{y, color}].
function vGradient(y0: number, y1: number, stops: Array<{ y: number; c: RGB }>): void {
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
    let c: RGB = stops[stops.length - 1].c;
    for (let s = 0; s < stops.length - 1; s++) {
      const a = stops[s];
      const b = stops[s + 1];
      if (y >= a.y && y <= b.y) {
        const t = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
        c = lerpColor(a.c, b.c, t);
        break;
      }
    }
    for (let x = 0; x < W; x++) setPixel(x, y, c);
  }
}

function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1): void {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(W - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) {
        if (a >= 1) setPixel(x, y, c);
        else blendPixel(x, y, c, a);
      }
    }
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  fillEllipse(cx, cy, r, r, c, a);
}

// Scanline polygon fill (even-odd). Points as [x, y] pairs.
function fillPolygon(pts: Array<[number, number]>, c: RGB, a = 1): void {
  let minY = H - 1;
  let maxY = 0;
  for (const [, y] of pts) {
    minY = Math.min(minY, Math.floor(y));
    maxY = Math.max(maxY, Math.ceil(y));
  }
  minY = Math.max(0, minY);
  maxY = Math.min(H - 1, maxY);
  const n = pts.length;
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % n];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        const t = (y - y1) / (y2 - y1);
        xs.push(x1 + t * (x2 - x1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k]));
      const xb = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = xa; x <= xb; x++) {
        if (a >= 1) setPixel(x, y, c);
        else blendPixel(x, y, c, a);
      }
    }
  }
}

// Thick line as a chain of filled circles.
function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, a = 1): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.max(1, Math.hypot(dx, dy));
  const steps = Math.ceil(len);
  const r = w / 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillCircle(x0 + dx * t, y0 + dy * t, r, c, a);
  }
}

// ---------------------------------------------------------------------------
// Palette (golden hour).
// ---------------------------------------------------------------------------
const INDIGO: RGB = [30, 42, 74];
const TEAL: RGB = [47, 111, 126];
const PEACH: RGB = [242, 166, 90];
const SUN: RGB = [255, 217, 142];
const CREAM: RGB = [255, 243, 214];
const CLOUD_PEACH: RGB = [247, 201, 139];
const ROSE: RGB = [232, 168, 124];
const ROSE_DEEP: RGB = [217, 138, 104];
const SLATE: RGB = [61, 64, 91];
const SLATE_DARK: RGB = [44, 47, 70];
const RIM: RGB = [231, 111, 81];
const GREEN: RGB = [74, 124, 89];
const GREEN_LIGHT: RGB = [94, 148, 104];
const GREEN_DARK: RGB = [47, 93, 63];
const WHITE: RGB = [255, 248, 236];
const CORAL: RGB = [231, 111, 81];
const MIST: RGB = [220, 238, 242];
const INK: RGB = [20, 29, 51];

// ---------------------------------------------------------------------------
// 1. Sky: deep indigo -> teal -> warm peach at the horizon.
// ---------------------------------------------------------------------------
vGradient(0, 700, [
  { y: 0, c: INDIGO },
  { y: 340, c: TEAL },
  { y: 700, c: PEACH },
]);

// Stars in the upper sky (fixed seed, so deterministic).
seed = 0x5eed & 0xffffffff;
for (let i = 0; i < 46; i++) {
  const sx = Math.floor(rnd() * W);
  const sy = Math.floor(rnd() * 270);
  const s = rnd();
  if (s > 0.55) blendPixel(sx, sy, CREAM, 0.55 + 0.35 * rnd());
  if (s > 0.9) blendPixel(sx + 1, sy, CREAM, 0.4);
}

// ---------------------------------------------------------------------------
// 2. Sun: pale-gold disc with a warm halo, right of centre.
// ---------------------------------------------------------------------------
const SUN_X = 650;
const SUN_Y = 430;
const SUN_R = 105;
for (let r = 260; r > SUN_R; r -= 4) {
  const a = 0.05 * (1 - (r - SUN_R) / 160);
  if (a > 0) fillCircle(SUN_X, SUN_Y, r, [255, 200, 120], a);
}
fillCircle(SUN_X, SUN_Y, SUN_R, SUN);
fillCircle(SUN_X, SUN_Y, SUN_R - 14, [255, 226, 160]);
// Thin halo ring around the sun disc so it reads against the teal sky.
for (let a = 0; a < 360; a += 1) {
  const rad = (a * Math.PI) / 180;
  const hx = SUN_X + Math.cos(rad) * (SUN_R + 7);
  const hy = SUN_Y + Math.sin(rad) * (SUN_R + 7);
  fillCircle(hx, hy, 2, [255, 232, 180], 0.55);
}

// ---------------------------------------------------------------------------
// 3. Two hazy distant ridge layers behind the island.
// ---------------------------------------------------------------------------
fillPolygon(
  [[0, 620], [180, 585], [360, 615], [560, 580], [760, 610], [1024, 585], [1024, 700], [0, 700]],
  [124, 154, 165],
  0.55,
);
fillPolygon(
  [[0, 650], [220, 625], [430, 655], [640, 628], [850, 652], [1024, 630], [1024, 700], [0, 700]],
  [78, 110, 124],
  0.7,
);

// ---------------------------------------------------------------------------
// 4. The floating island.
// ---------------------------------------------------------------------------
// Rock: deep slate, tapering to a point below.
fillPolygon(
  [[280, 470], [745, 470], [660, 560], [560, 640], [512, 668], [470, 635], [360, 565]],
  SLATE,
);
// Rock facets for depth.
fillPolygon([[360, 565], [470, 635], [512, 668], [430, 600], [330, 540]], SLATE_DARK, 0.55);
fillPolygon([[560, 640], [512, 668], [600, 600], [660, 560]], [74, 78, 108], 0.5);
// Warm rim light along the right edge.
fillPolygon([[712, 474], [745, 470], [668, 556], [640, 585]], RIM, 0.75);

// Green crown on top of the rock.
fillEllipse(512, 468, 232, 42, GREEN);
fillEllipse(480, 458, 180, 26, GREEN_LIGHT, 0.8);

// Little trees on the crown.
for (const [tx, ty, ts] of [[350, 452, 26], [620, 448, 30], [682, 458, 22]] as Array<[number, number, number]>) {
  fillPolygon([[tx, ty - ts], [tx - ts * 0.55, ty], [tx + ts * 0.55, ty]], GREEN_DARK);
}

// Lighthouse on the crown.
const LH_X0 = 478;
const LH_X1 = 537;
fillPolygon([[LH_X0, 470], [LH_X1, 470], [530, 372], [485, 372]], WHITE);
// Coral bands around the tower.
fillPolygon([[480, 424], [535, 424], [533, 402], [482, 402]], CORAL);
fillPolygon([[483, 392], [532, 392], [530, 376], [485, 376]], CORAL);
// Gallery + lamp room + dome.
fillRect(476, 366, 539, 372, SLATE_DARK);
fillRect(492, 344, 523, 366, [43, 47, 69]);
fillRect(497, 350, 518, 360, SUN);
fillPolygon([[490, 344], [525, 344], [507, 330]], CORAL);
fillCircle(507, 328, 3, SUN);

// Light beams sweeping over the cloud sea (translucent pale gold).
fillPolygon([[507, 355], [300, 296], [300, 332]], [255, 226, 160], 0.22);
fillPolygon([[507, 355], [762, 296], [762, 336]], [255, 226, 160], 0.22);

// Waterfalls spilling off the island's edges into mist.
fillPolygon([[300, 500], [318, 500], [312, 700], [296, 700]], MIST, 0.85);
fillPolygon([[706, 500], [724, 500], [730, 690], [712, 690]], MIST, 0.85);
thickLine(309, 520, 304, 690, 3, WHITE, 0.7);
thickLine(715, 520, 720, 680, 3, WHITE, 0.7);
// Mist puffs where the falls dissolve.
fillEllipse(307, 715, 46, 18, WHITE, 0.55);
fillEllipse(720, 702, 40, 16, WHITE, 0.55);
fillEllipse(312, 742, 30, 12, WHITE, 0.45);
// Thin cloud wisps drifting across the island's rock face.
fillEllipse(420, 585, 70, 10, CREAM, 0.35);
fillEllipse(610, 615, 80, 11, CREAM, 0.32);
fillEllipse(512, 640, 55, 9, [255, 240, 210], 0.3);

// Birds (fixed positions, deterministic).
for (const [bx, by, bs] of [[250, 300, 14], [300, 330, 11], [780, 280, 13], [830, 310, 10]] as Array<[number, number, number]>) {
  thickLine(bx - bs, by, bx, by - bs * 0.45, 2, INK, 0.85);
  thickLine(bx, by - bs * 0.45, bx + bs, by, 2, INK, 0.85);
}

// ---------------------------------------------------------------------------
// 5. Cloud sea (bottom third): layered soft ellipses, rose band at the base.
// ---------------------------------------------------------------------------
vGradient(700, 1024, [
  { y: 700, c: CLOUD_PEACH },
  { y: 1024, c: ROSE },
]);
seed = 0xc10d & 0xffffffff;
const cloudRows: Array<{ y: number; n: number; ry: [number, number] }> = [
  { y: 760, n: 7, ry: [22, 34] },
  { y: 840, n: 8, ry: [26, 42] },
  { y: 920, n: 8, ry: [28, 46] },
  { y: 990, n: 9, ry: [24, 40] },
];
for (const row of cloudRows) {
  for (let i = 0; i < row.n; i++) {
    const cx = (i / (row.n - 1)) * (W + 160) - 80 + rndRange(-40, 40);
    const rx = rndRange(90, 220);
    const ry = rndRange(row.ry[0], row.ry[1]);
    const pick = rnd();
    const col: RGB = pick < 0.45 ? CREAM : pick < 0.8 ? CLOUD_PEACH : ROSE;
    fillEllipse(cx, row.y + rndRange(-12, 12), rx, ry, col, 0.92);
  }
}
// Darker rose band at the very bottom for depth.
fillEllipse(200, 1010, 260, 34, ROSE_DEEP, 0.8);
fillEllipse(700, 1018, 300, 36, ROSE_DEEP, 0.8);

// ---------------------------------------------------------------------------
// 6. Title "VELMORA" — hand-built 5x7 block capitals, cream on indigo.
// ---------------------------------------------------------------------------
const GLYPHS: Record<string, string[]> = {
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
};

function drawGlyph(ch: string, x0: number, y0: number, scale: number, c: RGB): void {
  const g = GLYPHS[ch];
  if (!g) return;
  for (let r = 0; r < 7; r++) {
    for (let col = 0; col < 5; col++) {
      if (g[r][col] === '#') {
        fillRect(x0 + col * scale, y0 + r * scale, x0 + (col + 1) * scale - 1, y0 + (r + 1) * scale - 1, c);
      }
    }
  }
}

function drawTitle(text: string, y0: number, scale: number): void {
  const adv = 6 * scale; // 5 cols + 1 gap
  const totalW = text.length * 5 * scale + (text.length - 1) * scale;
  let x = Math.floor((W - totalW) / 2);
  for (const ch of text) {
    drawGlyph(ch, x + 5, y0 + 5, scale, INK); // indigo shadow, 5px offset
    drawGlyph(ch, x, y0, scale, CREAM);
    x += adv;
  }
  // Thin cream rule beneath the title.
  const ruleX0 = Math.floor((W - totalW) / 2) + 30;
  const ruleX1 = Math.floor((W + totalW) / 2) - 30;
  fillRect(ruleX0, y0 + 7 * scale + 18, ruleX1, y0 + 7 * scale + 21, CREAM);
}

drawTitle('VELMORA', 62, 18);

// ---------------------------------------------------------------------------
// PNG encoder (from scratch): signature + IHDR + IDAT + IEND, CRC32.
// Per-scanline filter chosen deterministically (None/Sub/Up, smallest |sum|).
// ---------------------------------------------------------------------------
const CRC_TABLE: number[] = (() => {
  const t: number[] = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function encodePNG(): Buffer {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  const bpp = 3;
  for (let y = 0; y < H; y++) {
    const rowStart = y * W * 3;
    const outStart = y * (W * 3 + 1);
    const variants: Buffer[] = [];
    // Filter 0: None
    const v0 = Buffer.alloc(W * 3);
    buf.copy(v0, 0, rowStart, rowStart + W * 3);
    variants.push(v0);
    // Filter 1: Sub
    const v1 = Buffer.alloc(W * 3);
    for (let i = 0; i < W * 3; i++) {
      const left = i >= bpp ? buf[rowStart + i - bpp] : 0;
      v1[i] = (buf[rowStart + i] - left) & 0xff;
    }
    variants.push(v1);
    // Filter 2: Up
    const v2 = Buffer.alloc(W * 3);
    for (let i = 0; i < W * 3; i++) {
      const up = y > 0 ? buf[rowStart - W * 3 + i] : 0;
      v2[i] = (buf[rowStart + i] - up) & 0xff;
    }
    variants.push(v2);
    // Pick the filter with the smallest absolute sum of signed bytes.
    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 3; f++) {
      let score = 0;
      const v = variants[f];
      for (let i = 0; i < v.length; i++) {
        const s = v[i] >= 128 ? v[i] - 256 : v[i];
        score += Math.abs(s);
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    raw[outStart] = best;
    variants[best].copy(raw, outStart + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const png = encodePNG();
fs.mkdirSync('/output', { recursive: true });
fs.writeFileSync('/output/entry.png', png);
console.log(`wrote /output/entry.png (${png.length} bytes, ${W}x${H})`);
