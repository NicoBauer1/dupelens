// Procedural test images and the transforms of the calibration suite.
//
// Every image is drawn from a seed, so the samples, the calibration numbers
// and the unit tests are fully reproducible and contain no real photographs.
// Images use the RGBA layout of ImageData: { width, height, data }.

import { dct2d, idct2d } from '../../src/engine/dct.js';
import { resizeArea } from '../../src/engine/raster.js';

// ---------------------------------------------------------------------------
// Random numbers

/**
 * xorshift32 generator returning floats in
 * [0, 1). The seed is scrambled first so that small seeds differ a lot.
 * @param {number} seed
 * @returns {() => number}
 */
export function createRandom(seed) {
  let state = (Math.imul((seed >>> 0) ^ 0x5bd1e995, 0x2c1b3c6d) ^ 0x9e3779b9) >>> 0 || 0x1234567;
  const next = () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
  for (let i = 0; i < 8; i++) next();
  return next;
}

/** Standard normal sample by the Box-Muller transform. */
function gaussian(random) {
  const u = Math.max(random(), 1e-12);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// Small drawing helpers working on normalised coordinates (u, v in [0, 1])

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const mix = (a, b, t) => a + (b - a) * t;
const mixColour = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Colour from hue (0..1), saturation and lightness, all in [0, 1]. */
function hsl(h, s, l) {
  const k = (n) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/**
 * Smooth value noise: random values on a lattice, blended with smoothstep,
 * summed over several octaves.
 */
function createNoise(random, cells = 8, octaves = 4) {
  const size = cells << octaves;
  const lattice = new Float32Array((size + 1) * (size + 1));
  for (let i = 0; i < lattice.length; i++) lattice[i] = random();
  const row = size + 1;
  const sample = (x, y, scale) => {
    const fx = Math.abs(x * scale);
    const fy = Math.abs(y * scale);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const xa = x0 % size;
    const xb = (x0 + 1) % size;
    const ya = (y0 % size) * row;
    const yb = ((y0 + 1) % size) * row;
    const top = lattice[ya + xa] + (lattice[ya + xb] - lattice[ya + xa]) * sx;
    const bottom = lattice[yb + xa] + (lattice[yb + xb] - lattice[yb + xa]) * sx;
    return top + (bottom - top) * sy;
  };
  return (u, v) => {
    let total = 0;
    let amplitude = 0.5;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      total += amplitude * sample(u, v, cells << o);
      norm += amplitude;
      amplitude *= 0.5;
    }
    return total / norm;
  };
}

/** Anti-aliasing coverage of a signed distance (negative = inside). */
const coverage = (distance, pixel) => clamp01(0.5 - distance / pixel);

// ---------------------------------------------------------------------------
// Scenes. Each returns a shader (u, v, pixel) -> [r, g, b].

const SCENES = {
  landscape(random) {
    const skyTop = hsl(0.55 + random() * 0.1, 0.6, 0.35 + random() * 0.2);
    const skyHorizon = hsl(0.05 + random() * 0.1, 0.7, 0.7 + random() * 0.15);
    const sun = { u: 0.15 + random() * 0.7, v: 0.15 + random() * 0.25, r: 0.04 + random() * 0.06 };
    const ridge = [0, 1, 2].map(() => ({ f: 3 + random() * 9, p: random() * 6.28, a: 0.02 + random() * 0.06 }));
    const horizon = 0.45 + random() * 0.15;
    const mountain = hsl(0.6 + random() * 0.2, 0.3, 0.25 + random() * 0.15);
    const ground = hsl(0.2 + random() * 0.15, 0.5, 0.3 + random() * 0.15);
    const noise = createNoise(random, 6, 4);
    return (u, v, pixel) => {
      let c = mixColour(skyTop, skyHorizon, smoothstep(0, horizon, v));
      const d = Math.hypot(u - sun.u, (v - sun.v) * 0.75) - sun.r;
      c = mixColour(c, [255, 240, 200], coverage(d, pixel));
      let ridgeV = horizon - 0.12;
      for (const r of ridge) ridgeV += r.a * Math.sin(r.f * u + r.p);
      c = mixColour(c, mixColour(mountain, [30, 30, 50], noise(u, v) * 0.5), coverage(ridgeV - v, pixel));
      const groundV = horizon + 0.05 * Math.sin(2 * u + ridge[0].p);
      const g = mixColour(ground, [20, 40, 10], noise(u * 3, v * 3) * 0.8);
      return mixColour(c, g, coverage(groundV - v, pixel));
    };
  },

  city(random) {
    const sky = [hsl(0.6, 0.5, 0.3 + random() * 0.3), hsl(0.08, 0.6, 0.6 + random() * 0.2)];
    const buildings = [];
    let x = -0.02;
    while (x < 1) {
      const w = 0.05 + random() * 0.12;
      buildings.push({ x0: x, x1: x + w, top: 0.2 + random() * 0.5, colour: hsl(random(), 0.15, 0.2 + random() * 0.35), lit: random() });
      x += w + random() * 0.02;
    }
    const windowSeed = createNoise(random, 16, 1);
    return (u, v, pixel) => {
      let c = mixColour(sky[0], sky[1], v);
      for (const b of buildings) {
        if (u < b.x0 - pixel || u > b.x1 + pixel || v < b.top - pixel) continue;
        const inside = Math.min(coverage(b.x0 - u, pixel), coverage(u - b.x1, pixel), coverage(b.top - v, pixel));
        let colour = b.colour;
        const wu = ((u - b.x0) * 60) % 1;
        const wv = ((v - b.top) * 45) % 1;
        if (wu > 0.3 && wu < 0.75 && wv > 0.3 && wv < 0.75 && v > b.top + 0.02) {
          colour = windowSeed(u * 3, v * 3) < b.lit ? [250, 220, 140] : [40, 45, 60];
        }
        c = mixColour(c, colour, inside);
      }
      return c;
    };
  },

  portrait(random) {
    const bgNoise = createNoise(random, 3, 3);
    const bgA = hsl(random(), 0.4, 0.3 + random() * 0.3);
    const bgB = hsl(random(), 0.4, 0.5 + random() * 0.3);
    const skin = hsl(0.05 + random() * 0.05, 0.45, 0.45 + random() * 0.3);
    const hair = hsl(0.08, 0.5, 0.1 + random() * 0.4);
    const shirt = hsl(random(), 0.6, 0.3 + random() * 0.3);
    const cx = 0.4 + random() * 0.2;
    const head = { u: cx, v: 0.38 + random() * 0.06, ru: 0.13 + random() * 0.03, rv: 0.2 + random() * 0.03 };
    return (u, v, pixel) => {
      let c = mixColour(bgA, bgB, bgNoise(u, v));
      const body = Math.hypot((u - cx) / 0.35, (v - 1.05) / 0.4) - 1;
      c = mixColour(c, shirt, coverage(body * 0.3, pixel));
      const hairD = Math.hypot((u - head.u) / (head.ru * 1.12), (v - head.v + 0.04) / (head.rv * 1.05)) - 1;
      c = mixColour(c, hair, coverage(hairD * 0.15, pixel));
      const face = Math.hypot((u - head.u) / head.ru, (v - head.v) / head.rv) - 1;
      const shade = mixColour(skin, [skin[0] * 0.7, skin[1] * 0.65, skin[2] * 0.6], clamp01((u - head.u) / head.ru + 0.4));
      c = mixColour(c, shade, coverage(face * 0.15, pixel));
      for (const side of [-1, 1]) {
        const eye = Math.hypot(u - (head.u + side * head.ru * 0.4), (v - head.v + head.rv * 0.1) * 1.6) - 0.018;
        c = mixColour(c, [35, 30, 30], coverage(eye, pixel));
      }
      const mouth = Math.hypot((u - head.u) * 0.6, v - (head.v + head.rv * 0.45)) - 0.02;
      return mixColour(c, [150, 60, 60], coverage(mouth, pixel));
    };
  },

  stillLife(random) {
    const wall = [hsl(random(), 0.2, 0.6 + random() * 0.2), hsl(random(), 0.2, 0.35 + random() * 0.2)];
    const tableV = 0.55 + random() * 0.15;
    const wood = hsl(0.07, 0.5, 0.25 + random() * 0.15);
    const fruits = Array.from({ length: 3 + Math.floor(random() * 3) }, () => ({
      u: 0.15 + random() * 0.7,
      v: tableV - 0.02 + random() * 0.1,
      r: 0.06 + random() * 0.08,
      colour: hsl(random() * 0.3, 0.8, 0.45),
    }));
    return (u, v, pixel) => {
      let c = mixColour(wall[0], wall[1], v);
      const grain = 0.5 + 0.5 * Math.sin(v * 140 + Math.sin(u * 9) * 3);
      c = mixColour(c, mixColour(wood, [wood[0] * 0.6, wood[1] * 0.6, wood[2] * 0.6], grain), coverage(tableV - v, pixel));
      for (const f of fruits) {
        const d = Math.hypot(u - f.u, (v - f.v) * 0.75) - f.r;
        const light = clamp01(1 - Math.hypot(u - f.u + f.r * 0.4, (v - f.v + f.r * 0.4) * 0.75) / (f.r * 1.8));
        c = mixColour(c, mixColour([f.colour[0] * 0.5, f.colour[1] * 0.5, f.colour[2] * 0.5], [255, 255, 240], light * 0.9), coverage(d, pixel));
      }
      return c;
    };
  },

  abstract(random) {
    const base = [hsl(random(), 0.6, 0.5), hsl(random(), 0.6, 0.5)];
    const angle = random() * Math.PI;
    const shapes = Array.from({ length: 6 + Math.floor(random() * 6) }, () => ({
      round: random() < 0.6,
      u: random(),
      v: random(),
      a: 0.05 + random() * 0.2,
      b: 0.05 + random() * 0.2,
      colour: hsl(random(), 0.75, 0.3 + random() * 0.4),
      alpha: 0.5 + random() * 0.5,
    }));
    return (u, v, pixel) => {
      const t = clamp01(0.5 + (u - 0.5) * Math.cos(angle) + (v - 0.5) * Math.sin(angle));
      let c = mixColour(base[0], base[1], t);
      for (const s of shapes) {
        const d = s.round
          ? Math.hypot(u - s.u, v - s.v) - s.a
          : Math.max(Math.abs(u - s.u) - s.a, Math.abs(v - s.v) - s.b);
        c = mixColour(c, s.colour, coverage(d, pixel) * s.alpha);
      }
      return c;
    };
  },

  seascape(random) {
    const sky = [hsl(0.58, 0.5, 0.45 + random() * 0.2), hsl(0.1, 0.4, 0.8)];
    const sea = hsl(0.52 + random() * 0.08, 0.6, 0.25 + random() * 0.15);
    const horizon = 0.4 + random() * 0.2;
    const waves = 20 + random() * 30;
    const boat = { u: 0.2 + random() * 0.6, v: horizon + 0.05 + random() * 0.15, s: 0.04 + random() * 0.05 };
    const clouds = createNoise(random, 4, 3);
    return (u, v, pixel) => {
      let c = mixColour(sky[0], sky[1], v / horizon);
      c = mixColour(c, [250, 250, 250], smoothstep(0.55, 0.75, clouds(u, v * 2)) * (1 - v / horizon));
      const wave = 0.5 + 0.5 * Math.sin(v * waves * (1 + v * 4) + Math.sin(u * 12) * 1.5);
      const water = mixColour(sea, [sea[0] * 1.5, sea[1] * 1.4, sea[2] * 1.3], wave * (v - horizon) * 1.5);
      c = mixColour(c, water, coverage(horizon - v, pixel));
      const hull = Math.max(Math.abs(u - boat.u) - boat.s * (1 - (v - boat.v) / (boat.s * 0.5)), Math.abs(v - boat.v - boat.s * 0.25) - boat.s * 0.25);
      c = mixColour(c, [60, 30, 20], coverage(hull, pixel));
      const sail = Math.max(-(u - boat.u), (u - boat.u) - boat.s * 0.8 * (1 - (boat.v - v) / (boat.s * 1.6)), v - boat.v, boat.v - boat.s * 1.6 - v);
      return mixColour(c, [245, 245, 235], coverage(sail, pixel));
    };
  },

  forest(random) {
    const sky = hsl(0.55, 0.4, 0.7 + random() * 0.15);
    const leaves = hsl(0.22 + random() * 0.12, 0.55, 0.25 + random() * 0.15);
    const foliage = createNoise(random, 10, 4);
    const trunks = Array.from({ length: 4 + Math.floor(random() * 6) }, () => ({
      u: random(),
      w: 0.01 + random() * 0.03,
      colour: hsl(0.07, 0.4, 0.15 + random() * 0.15),
    }));
    const floorV = 0.7 + random() * 0.15;
    return (u, v, pixel) => {
      let c = sky;
      const canopy = foliage(u, v) - 0.35 - v * 0.4;
      c = mixColour(c, mixColour(leaves, [leaves[0] * 1.6, leaves[1] * 1.5, leaves[2]], foliage(u * 2, v * 2)), smoothstep(-0.05, 0.05, canopy));
      for (const t of trunks) c = mixColour(c, t.colour, coverage(Math.abs(u - t.u) - t.w, pixel) * smoothstep(0.2, 0.45, v));
      return mixColour(c, mixColour([70, 50, 30], [40, 60, 20], foliage(u * 4, v * 4)), coverage(floorV - v, pixel));
    };
  },

  texture(random) {
    const noise = createNoise(random, 5, 5);
    const a = hsl(random(), 0.5, 0.25 + random() * 0.2);
    const b = hsl(random(), 0.5, 0.6 + random() * 0.2);
    return (u, v) => mixColour(a, b, smoothstep(0.25, 0.75, noise(u, v)));
  },
};

export const SCENE_TYPES = Object.keys(SCENES);

/**
 * Renders a scene with 2×2 supersampling.
 * @param {string} type one of SCENE_TYPES
 * @param {number} seed
 * @param {number} [width=320]
 * @param {number} [height=240]
 * @returns {{ width: number, height: number, data: Uint8ClampedArray }}
 */
export function renderScene(type, seed, width = 320, height = 240) {
  const factory = SCENES[type];
  if (!factory) throw new Error(`unknown scene type ${type}`);
  const shader = factory(createRandom(seed));
  const data = new Uint8ClampedArray(width * height * 4);
  const pixel = 1 / Math.max(width, height);
  const offsets = [0.25, 0.75];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (const oy of offsets) {
        for (const ox of offsets) {
          const c = shader((x + ox) / width, (y + oy) / height, pixel);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const i = (y * width + x) * 4;
      data[i] = Math.round(r / 4);
      data[i + 1] = Math.round(g / 4);
      data[i + 2] = Math.round(b / 4);
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

// ---------------------------------------------------------------------------
// Transforms

function mapPixels(image, fn) {
  const data = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = fn(image.data[i], image.data[i + 1], image.data[i + 2]);
    data[i] = Math.round(r);
    data[i + 1] = Math.round(g);
    data[i + 2] = Math.round(b);
    data[i + 3] = image.data[i + 3];
  }
  return { width: image.width, height: image.height, data };
}

function toFloatRgb(image) {
  const n = image.width * image.height;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = image.data[i * 4];
    rgb[i * 3 + 1] = image.data[i * 4 + 1];
    rgb[i * 3 + 2] = image.data[i * 4 + 2];
  }
  return rgb;
}

function fromFloatRgb(rgb, width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = Math.round(rgb[i * 3]);
    data[i * 4 + 1] = Math.round(rgb[i * 3 + 1]);
    data[i * 4 + 2] = Math.round(rgb[i * 3 + 2]);
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

/** Bilinear interpolation (used for upscaling). */
function resizeBilinear(image, width, height) {
  const { data, width: sw, height: sh } = image;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / height - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / width - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const a = mix(data[(y0 * sw + x0) * 4 + c], data[(y0 * sw + x1) * 4 + c], tx);
        const b = mix(data[(y1 * sw + x0) * 4 + c], data[(y1 * sw + x1) * 4 + c], tx);
        out[(y * width + x) * 4 + c] = Math.round(mix(a, b, ty));
      }
    }
  }
  return { width, height, data: out };
}

/** Resize by a factor: area averaging when shrinking, bilinear when enlarging. */
export function resize(image, factor) {
  const width = Math.max(1, Math.round(image.width * factor));
  const height = Math.max(1, Math.round(image.height * factor));
  if (factor >= 1) return resizeBilinear(image, width, height);
  return fromFloatRgb(resizeArea(toFloatRgb(image), image.width, image.height, width, height, 3), width, height);
}

/** The usual JPEG example quantisation tables (luminance and chrominance). */
const JPEG_LUMA_TABLE = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const JPEG_CHROMA_TABLE = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];

function scaledTable(table, quality) {
  const q = Math.min(100, Math.max(1, quality));
  const scale = q < 50 ? 5000 / q : 200 - 2 * q;
  return table.map((v) => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))));
}

function lossyPlane(plane, width, height, table) {
  const bw = Math.ceil(width / 8) * 8;
  const bh = Math.ceil(height / 8) * 8;
  const out = new Float32Array(width * height);
  const block = new Float64Array(64);
  for (let by = 0; by < bh; by += 8) {
    for (let bx = 0; bx < bw; bx += 8) {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const sx = Math.min(width - 1, bx + x);
          const sy = Math.min(height - 1, by + y);
          block[y * 8 + x] = plane[sy * width + sx] - 128;
        }
      }
      const coefficients = dct2d(block, 8);
      for (let i = 0; i < 64; i++) coefficients[i] = Math.round(coefficients[i] / table[i]) * table[i];
      const restored = idct2d(coefficients, 8);
      for (let y = 0; y < 8 && by + y < height; y++) {
        for (let x = 0; x < 8 && bx + x < width; x++) out[(by + y) * width + bx + x] = restored[y * 8 + x] + 128;
      }
    }
  }
  return out;
}

/**
 * Simulates saving as JPEG: YCbCr conversion, 4:2:0 chroma subsampling,
 * 8×8 DCT, quantisation with the T.81 example tables scaled to `quality`
 * (1..100), and the way back. Produces the typical blocking and ringing.
 */
export function jpegLike(image, quality) {
  const { width, height, data } = image;
  const n = width * height;
  const Y = new Float32Array(n);
  const Cb = new Float32Array(n);
  const Cr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    Cb[i] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    Cr[i] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  const cw = Math.ceil(width / 2);
  const ch = Math.ceil(height / 2);
  const subsample = (plane) => {
    const out = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        let sum = 0, count = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = 2 * x + dx, sy = 2 * y + dy;
            if (sx < width && sy < height) {
              sum += plane[sy * width + sx];
              count++;
            }
          }
        }
        out[y * cw + x] = sum / count;
      }
    }
    return out;
  };
  const yOut = lossyPlane(Y, width, height, scaledTable(JPEG_LUMA_TABLE, quality));
  const cbOut = lossyPlane(subsample(Cb), cw, ch, scaledTable(JPEG_CHROMA_TABLE, quality));
  const crOut = lossyPlane(subsample(Cr), cw, ch, scaledTable(JPEG_CHROMA_TABLE, quality));
  const out = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const c = (y >> 1) * cw + (x >> 1);
      const yy = yOut[i], cb = cbOut[c] - 128, cr = crOut[c] - 128;
      out[i * 4] = Math.round(yy + 1.402 * cr);
      out[i * 4 + 1] = Math.round(yy - 0.344136 * cb - 0.714136 * cr);
      out[i * 4 + 2] = Math.round(yy + 1.772 * cb);
      out[i * 4 + 3] = 255;
    }
  }
  return { width, height, data: out };
}

/** Adds `amount` (fraction of the full range, may be negative) to every channel. */
export const brightness = (image, amount) => mapPixels(image, (r, g, b) => [r + amount * 255, g + amount * 255, b + amount * 255]);

/** Scales the distance from mid-grey by `factor`. */
export const contrast = (image, factor) => mapPixels(image, (r, g, b) => [128 + (r - 128) * factor, 128 + (g - 128) * factor, 128 + (b - 128) * factor]);

/** Gamma correction v' = 255 (v / 255)^gamma. */
export const gamma = (image, value) => mapPixels(image, (r, g, b) => [255 * (r / 255) ** value, 255 * (g / 255) ** value, 255 * (b / 255) ** value]);

/** Mixes each pixel with its luma: 0 = grey, 1 = unchanged, > 1 = more colourful. */
export const saturation = (image, factor) =>
  mapPixels(image, (r, g, b) => {
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    return [l + (r - l) * factor, l + (g - l) * factor, l + (b - l) * factor];
  });

export const grayscale = (image) => saturation(image, 0);

/** Warmer or cooler white balance. */
export const colourCast = (image, amount) => mapPixels(image, (r, g, b) => [r * (1 + amount), g, b * (1 - amount)]);

/** Independent Gaussian noise with standard deviation `sigma` (in 0..255 units). */
export function noise(image, sigma, seed = 1) {
  const random = createRandom(seed);
  return mapPixels(image, (r, g, b) => [r + sigma * gaussian(random), g + sigma * gaussian(random), b + sigma * gaussian(random)]);
}

/** Two passes of a separable box blur with the given radius. */
export function blur(image, radius) {
  const { width, height } = image;
  let rgb = toFloatRgb(image);
  const pass = (src, horizontal) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0, count = 0;
          for (let k = -radius; k <= radius; k++) {
            const sx = horizontal ? x + k : x;
            const sy = horizontal ? y : y + k;
            if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
            sum += src[(sy * width + sx) * 3 + c];
            count++;
          }
          out[(y * width + x) * 3 + c] = sum / count;
        }
      }
    }
    return out;
  };
  for (let i = 0; i < 2; i++) rgb = pass(pass(rgb, true), false);
  return fromFloatRgb(rgb, width, height);
}

/**
 * Removes `fraction` of the width and of the height. `anchor` 'center' crops
 * evenly on all sides, 'corner' only on the right and bottom.
 */
export function crop(image, fraction, anchor = 'center') {
  const cw = Math.round(image.width * fraction);
  const chh = Math.round(image.height * fraction);
  const x0 = anchor === 'center' ? Math.floor(cw / 2) : 0;
  const y0 = anchor === 'center' ? Math.floor(chh / 2) : 0;
  const width = image.width - cw;
  const height = image.height - chh;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((y0 + y) * image.width + x0) * 4;
    data.set(image.data.subarray(from, from + width * 4), y * width * 4);
  }
  return { width, height, data };
}

/** Rotation by 90 degrees clockwise. */
export function rotate90(image) {
  const { width, height } = image;
  const data = new Uint8ClampedArray(image.data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const to = (x * height + (height - 1 - y)) * 4;
      data.set(image.data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), to);
    }
  }
  return { width: height, height: width, data };
}

/** Horizontal mirror image. */
export function mirror(image) {
  const { width, height } = image;
  const data = new Uint8ClampedArray(image.data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(image.data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), (y * width + (width - 1 - x)) * 4);
    }
  }
  return { width, height, data };
}

/** A semi-transparent caption bar with blocky "letters" in the lower right. */
export function watermark(image) {
  const out = { width: image.width, height: image.height, data: Uint8ClampedArray.from(image.data) };
  const { width, height, data } = out;
  const x0 = Math.round(width * 0.55), x1 = Math.round(width * 0.97);
  const y0 = Math.round(height * 0.86), y1 = Math.round(height * 0.95);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const letter = Math.floor((x - x0) / (height * 0.03)) % 2 === 0 && y > y0 + 2 && y < y1 - 2;
      const alpha = letter ? 0.85 : 0.35;
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * (1 - alpha) + 255 * alpha);
    }
  }
  return out;
}

/** A pixel-identical copy (stands for a lossless re-save with different bytes). */
export const copy = (image) => ({ width: image.width, height: image.height, data: Uint8ClampedArray.from(image.data) });
