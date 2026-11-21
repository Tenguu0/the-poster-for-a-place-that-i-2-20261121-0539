// VELMORA — travel poster for a floating island that sails the sky.
// Pure Node stdlib (node:zlib, node:fs). No network, no assets, no randomness
// except a fixed-seed LCG. Output is byte-identical across runs.
// Writes /output/entry.png (1024x1024 PNG).
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const W = 1024;
const H = 1024;
const OUT = process.env.ENTRY_OUTPUT || "/output/entry.png";

type RGB = [number, number, number];

// ---------------------------------------------------------------- buffer
const px = new Uint8Array(W * H * 3);

function setPx(x: number, y: number, c: RGB): void {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
}

function blendPx(x: number, y: number, c: RGB, a: number): void {
  if (x < 0 || x >= W || y < 0 || y >= H || a <= 0) return;
  if (a >= 1) { setPx(x, y, c); return; }
  const i = (y * W + x) * 3;
  px[i] = Math.round(px[i] * (1 - a) + c[0] * a);
  px[i + 1] = Math.round(px[i + 1] * (1 - a) + c[1] * a);
  px[i + 2] = Math.round(px[i + 2] * (1 - a) + c[2] * a);
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// ------------------------------------------------------- deterministic rng
let seed = 987654321;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

// ---------------------------------------------------------------- shapes
function fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1): void {
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) blendPx(x, y, c, a);
}

// Vertical gradient over a rectangle. stops: [y, color][] sorted by y.
function vgrad(x0: number, y0: number, x1: number, y1: number, stops: Array<[number, RGB]>): void {
  for (let y = y0; y < y1; y++) {
    let c = stops[stops.length - 1][1];
    for (let s = 0; s < stops.length - 1; s++) {
      const [ya, ca] = stops[s];
      const [yb, cb] = stops[s + 1];
      if (y >= ya && y <= yb) { c = mix(ca, cb, yb === ya ? 0 : (y - ya) / (yb - ya)); break; }
      if (y < ya) { c = ca; break; }
    }
    for (let x = x0; x < x1; x++) setPx(x, y, c);
  }
}

// Radial glow: strongest at centre, fading quadratically to radius r.
function radialGlow(cx: number, cy: number, r: number, c: RGB, maxA: number): void {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d >= 1) continue;
      const a = maxA * (1 - d) * (1 - d);
      blendPx(x, y, c, a);
    }
  }
}

function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1): void {
  const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    const t = (y - cy) / ry;
    if (Math.abs(t) > 1) continue;
    const dx = rx * Math.sqrt(1 - t * t);
    const x0 = Math.max(0, Math.ceil(cx - dx)), x1 = Math.min(W - 1, Math.floor(cx + dx));
    for (let x = x0; x <= x1; x++) blendPx(x, y, c, a);
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  fillEllipse(cx, cy, r, r, c, a);
}

// Even-odd scanline polygon fill.
function fillPoly(pts: Array<[number, number]>, c: RGB, a = 1): void {
  let ymin = H, ymax = 0;
  for (const [, y] of pts) { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
  ymin = Math.max(0, Math.floor(ymin)); ymax = Math.min(H - 1, Math.ceil(ymax));
  for (let y = ymin; y <= ymax; y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k])), x1 = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = x0; x <= x1; x++) blendPx(x, y, c, a);
    }
  }
}

// Thick line drawn as stamped circles along the segment.
function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, a = 1): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(len / (w / 3)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillCircle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2, c, a);
  }
}

// ------------------------------------------------------------------- font
// 5x7 block capitals, "#" = filled pixel.
const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function textWidth(text: string, scale: number): number {
  return text.length * 5 * scale + (text.length - 1) * scale;
}

function drawText(text: string, x0: number, y0: number, scale: number, c: RGB): void {
  let x = x0;
  for (const ch of text) {
    const glyph = FONT[ch] || FONT[" "];
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[r][col] === "1") {
          fillRect(x + col * scale, y0 + r * scale, x + (col + 1) * scale, y0 + (r + 1) * scale, c);
        }
      }
    }
    x += 6 * scale;
  }
}

// ------------------------------------------------------------- PNG encode
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  const crcIn = new Uint8Array(4 + data.length);
  crcIn.set(new TextEncoder().encode(type), 0);
  crcIn.set(data, 4);
  dv.setUint32(8 + data.length, crc32(crcIn));
  return out;
}

function encodePNG(): Buffer {
  const stride = W * 3;
  const raw = new Uint8Array(H * (stride + 1));
  const prev = new Uint8Array(stride);
  for (let y = 0; y < H; y++) {
    const row = px.subarray(y * stride, (y + 1) * stride);
    // Candidate filters: 0 None, 1 Sub, 2 Up. Pick smallest abs sum (deterministic).
    let bestF = 0;
    let bestScore = Infinity;
    let best: Uint8Array | null = null;
    for (const f of [0, 1, 2]) {
      const filt = new Uint8Array(stride);
      let score = 0;
      for (let i = 0; i < stride; i++) {
        let v: number;
        if (f === 0) v = row[i];
        else if (f === 1) v = (row[i] - (i >= 3 ? row[i - 3] : 0) + 256) & 0xff;
        else v = (row[i] - prev[i] + 256) & 0xff;
        filt[i] = v;
        const s = v > 127 ? v - 256 : v;
        score += Math.abs(s);
      }
      if (score < bestScore) { bestScore = score; bestF = f; best = filt; }
    }
    raw[y * (stride + 1)] = bestF;
    raw.set(best!, y * (stride + 1) + 1);
    prev.set(row);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, W); dv.setUint32(4, H);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(idat)), chunk("IEND", new Uint8Array(0))]);
}

// ------------------------------------------------------------------ scene
const INDIGO: RGB = [27, 39, 72];
const TEAL: RGB = [47, 111, 126];
const PEACH: RGB = [242, 166, 90];
const CREAM: RGB = [255, 243, 214];
const SUN: RGB = [255, 217, 142];
const SUN_CORE: RGB = [255, 233, 184];
const ROCK: RGB = [61, 64, 91];
const ROCK_DARK: RGB = [46, 47, 70];
const GREEN: RGB = [74, 124, 89];
const PINE: RGB = [47, 82, 56];
const CORAL: RGB = [231, 111, 81];
const WHITE: RGB = [255, 248, 236];
const CLOUD_DARK: RGB = [232, 168, 124];
const CLOUD_MID: RGB = [247, 201, 139];

function drawScene(): void {
  // 1. Sky: indigo -> teal -> warm peach toward the horizon.
  vgrad(0, 0, W, 780, [
    [0, INDIGO], [260, [46, 95, 112]], [480, [224, 142, 95]], [640, PEACH], [780, CLOUD_MID],
  ]);

  // 2. Sparse stars in the upper sky.
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(rnd() * W);
    const y = Math.floor(rnd() * 360);
    const a = 0.25 + rnd() * 0.55;
    const r = rnd() < 0.85 ? 1 : 2;
    fillCircle(x, y, r, CREAM, a);
  }

  // 3. Sun with glow, low and right of centre.
  radialGlow(700, 408, 300, SUN, 0.55);
  radialGlow(700, 408, 170, SUN_CORE, 0.7);
  fillCircle(700, 408, 108, SUN);
  fillCircle(700, 408, 86, SUN_CORE);

  // 4. Two hazy distant ridge layers.
  fillPoly([
    [0, 640], [90, 585], [180, 622], [260, 575], [350, 625], [470, 585],
    [560, 630], [680, 580], [800, 628], [900, 590], [1024, 632], [1024, 780], [0, 780],
  ], [122, 106, 140]);
  fillPoly([
    [0, 690], [120, 640], [230, 682], [340, 645], [470, 688], [600, 648],
    [720, 690], [850, 652], [960, 688], [1024, 660], [1024, 780], [0, 780],
  ], [90, 74, 110]);

  // 5. The floating island.
  // Rock body, tapering to a point.
  fillPoly([
    [285, 478], [360, 470], [740, 470], [706, 540], [648, 600], [566, 648],
    [512, 670], [462, 642], [402, 586], [322, 536],
  ], ROCK);
  // Warm rim light on the sun side.
  thickLine(700, 500, 648, 600, 7, CORAL, 0.55);
  thickLine(648, 600, 566, 648, 7, CORAL, 0.4);
  // Stalactites under the point.
  fillPoly([[500, 664], [512, 668], [524, 664], [518, 700], [512, 712], [506, 700]], ROCK_DARK);
  fillPoly([[452, 636], [466, 640], [470, 636], [464, 668], [458, 672], [452, 668]], ROCK_DARK);
  // Grassy crown.
  fillEllipse(512, 470, 232, 24, GREEN);
  fillEllipse(512, 464, 232, 18, [88, 140, 102]);
  // Pine trees on the crown.
  const trees: Array<[number, number, number]> = [[330, 452, 26], [380, 446, 32], [440, 450, 24], [700, 448, 30], [742, 454, 22]];
  for (const [tx, ty, th] of trees) {
    fillPoly([[tx - th * 0.42, ty], [tx, ty - th], [tx + th * 0.42, ty]], PINE);
    fillRect(tx - 2, ty, tx + 2, ty + 8, [58, 44, 32]);
  }
  // Lighthouse: white tower with coral bands, lamp on top.
  fillPoly([[586, 470], [592, 396], [608, 396], [614, 470]], WHITE);
  fillPoly([[588, 448], [590, 428], [610, 428], [612, 448]], CORAL);
  fillPoly([[590, 416], [592, 400], [608, 400], [610, 416]], CORAL);
  fillRect(588, 388, 612, 398, [46, 42, 69]);
  fillCircle(600, 384, 9, [46, 42, 69]);
  fillCircle(600, 384, 5, SUN_CORE);
  // Light beams sweeping over the cloud sea.
  fillPoly([[600, 386], [392, 330], [392, 356]], SUN_CORE, 0.16);
  fillPoly([[600, 386], [818, 322], [818, 352]], SUN_CORE, 0.16);

  // Waterfalls spilling off the island's edges into mist (slight bend so
  // they read as falling water, not stilts).
  thickLine(340, 535, 322, 620, 16, [220, 239, 245], 0.85);
  thickLine(322, 620, 306, 700, 13, [220, 239, 245], 0.85);
  thickLine(340, 535, 322, 620, 7, [255, 255, 255], 0.8);
  thickLine(322, 620, 306, 700, 6, [255, 255, 255], 0.8);
  thickLine(686, 540, 706, 625, 14, [220, 239, 245], 0.85);
  thickLine(706, 625, 720, 700, 12, [220, 239, 245], 0.85);
  thickLine(686, 540, 706, 625, 6, [255, 255, 255], 0.8);
  thickLine(706, 625, 720, 700, 5, [255, 255, 255], 0.8);
  fillEllipse(314, 706, 34, 14, [255, 248, 236], 0.55);
  fillEllipse(716, 706, 30, 13, [255, 248, 236], 0.55);

  // Birds.
  const birds: Array<[number, number, number]> = [[300, 330, 14], [360, 300, 11], [790, 350, 13], [840, 305, 10], [250, 400, 9], [700, 290, 11]];
  for (const [bx, by, bs] of birds) {
    thickLine(bx - bs, by, bx, by - bs * 0.45, 3, [42, 47, 74], 0.9);
    thickLine(bx, by - bs * 0.45, bx + bs, by, 3, [42, 47, 74], 0.9);
  }

  // 6. Cloud sea.
  vgrad(0, 700, W, H, [[700, CLOUD_MID], [1024, CLOUD_DARK]]);
  // Back row of clouds (darker, larger).
  for (let i = 0; i < 16; i++) {
    const cx = rnd() * W;
    const cy = 716 + rnd() * 130;
    fillEllipse(cx, cy, 90 + rnd() * 110, 22 + rnd() * 22, CLOUD_DARK, 0.85);
  }
  // Front row (lighter).
  for (let i = 0; i < 22; i++) {
    const cx = rnd() * W;
    const cy = 760 + rnd() * 220;
    const c = rnd() < 0.5 ? CREAM : CLOUD_MID;
    fillEllipse(cx, cy, 70 + rnd() * 120, 20 + rnd() * 26, c, 0.75 + rnd() * 0.2);
  }
  // Darker band at the very bottom for depth (soft, so it does not read as a hard edge).
  fillRect(0, 985, W, H, [216, 138, 104], 0.35);

  // 7. Title: only the place name — no other copy.
  const title = "VELMORA";
  const scale = 18;
  const tw = textWidth(title, scale);
  const tx = Math.floor((W - tw) / 2);
  const ty = 88;
  drawText(title, tx + 5, ty + 6, scale, [20, 27, 51]); // shadow
  drawText(title, tx, ty, scale, CREAM);
  // Thin rule beneath the title with a small diamond at centre.
  fillRect(tx + 90, 238, tx + tw - 90, 243, CREAM, 0.95);
  fillPoly([[512, 232], [522, 240], [512, 248], [502, 240]], CREAM);
}

// -------------------------------------------------------------------- main
drawScene();
const png = encodePNG();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${png.length} bytes, ${W}x${H})`);
