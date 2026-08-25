/**
 * Brand raster generator.
 *
 * Next serves `icon.svg` for the favicon, but `apple-icon` and the social card
 * images have to be real rasters, and an X profile picture has to be a PNG. No
 * rasteriser is installed and none is worth adding for six files, so this script
 * draws the mark and a monoline uppercase alphabet analytically and writes the
 * PNGs itself with `zlib`.
 *
 * The glyphs are stroked geometry rather than a licensed typeface: the site's own
 * face is Geist, and shipping a bitmap of it in a build script would be both
 * heavier and murkier than drawing the eight letters of the wordmark.
 *
 *   node scripts/generate-brand.mjs
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* -------------------------------------------------------------------------- */
/* PNG                                                                         */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A single-image ICO wrapping a PNG, which every browser since IE11 accepts. */
function encodeIco(size, png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = size === 256 ? 0 : size;
  entry[1] = size === 256 ? 0 : size;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

/* -------------------------------------------------------------------------- */
/* Canvas                                                                      */
/* -------------------------------------------------------------------------- */

const SAMPLES = 4; // 4x4 supersampling

function hex(value) {
  return [
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5, 7), 16),
  ];
}

function canvas(width, height, background) {
  const rgba = Buffer.alloc(width * height * 4);
  const [br, bg, bb] = hex(background);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = br;
    rgba[i * 4 + 1] = bg;
    rgba[i * 4 + 2] = bb;
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

const seg = (x0, y0, x1, y1, w) => ({ kind: "seg", x0, y0, x1, y1, r: w / 2 });
const ring = (cx, cy, radius, w) => ({ kind: "ring", cx, cy, radius, r: w / 2 });
const disc = (cx, cy, radius) => ({ kind: "disc", cx, cy, r: radius });

function bounds(shape) {
  if (shape.kind === "seg") {
    return [
      Math.min(shape.x0, shape.x1) - shape.r,
      Math.min(shape.y0, shape.y1) - shape.r,
      Math.max(shape.x0, shape.x1) + shape.r,
      Math.max(shape.y0, shape.y1) + shape.r,
    ];
  }
  const reach = shape.kind === "ring" ? shape.radius + shape.r : shape.r;
  return [shape.cx - reach, shape.cy - reach, shape.cx + reach, shape.cy + reach];
}

function inside(shape, x, y) {
  if (shape.kind === "seg") {
    const dx = shape.x1 - shape.x0;
    const dy = shape.y1 - shape.y0;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((x - shape.x0) * dx + (y - shape.y0) * dy) / lengthSq));
    const px = x - (shape.x0 + t * dx);
    const py = y - (shape.y0 + t * dy);
    return px * px + py * py <= shape.r * shape.r;
  }
  const d = Math.hypot(x - shape.cx, y - shape.cy);
  return shape.kind === "ring" ? Math.abs(d - shape.radius) <= shape.r : d <= shape.r;
}

/**
 * Blend one colour group. Coverage is taken as the max across the group's shapes
 * so overlapping strokes — every joint in the mark and every letter — do not
 * darken where they meet.
 */
function draw(target, shapes, color, opacity = 1) {
  if (shapes.length === 0) return;
  const [fr, fg, fb] = hex(color);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of shapes) {
    const [x0, y0, x1, y1] = bounds(shape);
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  }
  const left = Math.max(0, Math.floor(minX));
  const top = Math.max(0, Math.floor(minY));
  const right = Math.min(target.width - 1, Math.ceil(maxX));
  const bottom = Math.min(target.height - 1, Math.ceil(maxY));

  const step = 1 / SAMPLES;
  const offset = step / 2;

  for (let py = top; py <= bottom; py += 1) {
    for (let px = left; px <= right; px += 1) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        const y = py + offset + sy * step;
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = px + offset + sx * step;
          for (const shape of shapes) {
            if (inside(shape, x, y)) {
              hits += 1;
              break;
            }
          }
        }
      }
      if (hits === 0) continue;
      const alpha = (hits / (SAMPLES * SAMPLES)) * opacity;
      const index = (py * target.width + px) * 4;
      target.rgba[index] = Math.round(target.rgba[index] + (fr - target.rgba[index]) * alpha);
      target.rgba[index + 1] = Math.round(
        target.rgba[index + 1] + (fg - target.rgba[index + 1]) * alpha,
      );
      target.rgba[index + 2] = Math.round(
        target.rgba[index + 2] + (fb - target.rgba[index + 2]) * alpha,
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The mark                                                                    */
/* -------------------------------------------------------------------------- */

/* The ink of the mark does not fill its 24-unit viewBox: the spine starts inside
   the left edge and the ring sits below the top. Centring on the viewBox would
   therefore leave the mark visibly high and left, so everything below positions
   by the ink box instead. */
const INK_BOX = { x0: 5.5, y0: 2.75, x1: 20.5, y1: 20.5 };
const INK_W = INK_BOX.x1 - INK_BOX.x0;
const INK_H = INK_BOX.y1 - INK_BOX.y0;

/** Same geometry as FolesterMark.tsx, in its 24-unit viewBox. */
function markShapes(originX, originY, size) {
  const s = size / 24;
  const at = (x, y) => [originX + x * s, originY + y * s];
  const [rx, ry] = at(6.5, 5);
  const [s0x, s0y] = at(6.5, 7.6);
  const [s1x, s1y] = at(6.5, 19.5);
  const [b0x, b0y] = at(6.5, 10.5);
  const [b1x, b1y] = at(16.6, 10.5);
  const [c0x, c0y] = at(6.5, 15.5);
  const [c1x, c1y] = at(12.6, 15.5);
  const [n0x, n0y] = at(18.5, 10.5);
  const [n1x, n1y] = at(14.5, 15.5);
  return [
    ring(rx, ry, 2.25 * s, 1.6 * s),
    seg(s0x, s0y, s1x, s1y, 2 * s),
    seg(b0x, b0y, b1x, b1y, 2 * s),
    seg(c0x, c0y, c1x, c1y, 2 * s),
    disc(n0x, n0y, 2 * s),
    disc(n1x, n1y, 2 * s),
  ];
}

/**
 * The mark's ink centred in a square, occupying `fraction` of the shorter edge.
 */
function markCentred(canvasSize, fraction) {
  const size = (fraction * canvasSize * 24) / Math.max(INK_W, INK_H);
  const scale = size / 24;
  const originX = canvasSize / 2 - ((INK_BOX.x0 + INK_BOX.x1) / 2) * scale;
  const originY = canvasSize / 2 - ((INK_BOX.y0 + INK_BOX.y1) / 2) * scale;
  return markShapes(originX, originY, size);
}

/** The mark's ink placed by its left edge and vertical centre. */
function markAt(left, centreY, inkHeight) {
  const scale = inkHeight / INK_H;
  return markShapes(left - INK_BOX.x0 * scale, centreY - ((INK_BOX.y0 + INK_BOX.y1) / 2) * scale, 24 * scale);
}

/* -------------------------------------------------------------------------- */
/* A monoline uppercase alphabet                                               */
/* -------------------------------------------------------------------------- */

/* Polylines on a 6-wide by 10-tall grid, y growing downward from the cap line.
   Curves are polygonal because at these sizes the difference is under a pixel. */
const GLYPHS = {
  A: [
    [[0, 10], [3, 0], [6, 10]],
    [[1.1, 6.7], [4.9, 6.7]],
  ],
  B: [
    [[0, 0], [0, 10]],
    [[0, 0], [3.9, 0], [5.4, 1.2], [5.4, 3.6], [3.9, 4.9], [0, 4.9]],
    [[0, 4.9], [4.2, 4.9], [5.9, 6.2], [5.9, 8.7], [4.2, 10], [0, 10]],
  ],
  C: [[[6, 1.9], [4.2, 0], [1.8, 0], [0, 1.9], [0, 8.1], [1.8, 10], [4.2, 10], [6, 8.1]]],
  D: [
    [[0, 0], [0, 10]],
    [[0, 0], [3.8, 0], [6, 2.3], [6, 7.7], [3.8, 10], [0, 10]],
  ],
  E: [
    [[6, 0], [0, 0], [0, 10], [6, 10]],
    [[0, 4.9], [5, 4.9]],
  ],
  F: [
    [[6, 0], [0, 0], [0, 10]],
    [[0, 4.9], [4.8, 4.9]],
  ],
  G: [[[6, 1.9], [4.2, 0], [1.8, 0], [0, 1.9], [0, 8.1], [1.8, 10], [4.2, 10], [6, 8.1], [6, 5.5], [3.3, 5.5]]],
  H: [
    [[0, 0], [0, 10]],
    [[6, 0], [6, 10]],
    [[0, 4.9], [6, 4.9]],
  ],
  I: [[[3, 0], [3, 10]]],
  J: [[[5.4, 0], [5.4, 8.1], [3.6, 10], [1.6, 10], [0, 8.3]]],
  K: [
    [[0, 0], [0, 10]],
    [[6, 0], [0.5, 5.4]],
    [[1.9, 4.1], [6, 10]],
  ],
  L: [[[0, 0], [0, 10], [6, 10]]],
  M: [[[0, 10], [0, 0], [3, 5.4], [6, 0], [6, 10]]],
  N: [[[0, 10], [0, 0], [6, 10], [6, 0]]],
  O: [[[1.9, 0], [4.1, 0], [6, 2], [6, 8], [4.1, 10], [1.9, 10], [0, 8], [0, 2], [1.9, 0]]],
  P: [[[0, 10], [0, 0], [4.1, 0], [6, 1.9], [6, 3.9], [4.1, 5.8], [0, 5.8]]],
  Q: [
    [[1.9, 0], [4.1, 0], [6, 2], [6, 8], [4.1, 10], [1.9, 10], [0, 8], [0, 2], [1.9, 0]],
    [[3.9, 7.5], [6.2, 10.3]],
  ],
  R: [
    [[0, 10], [0, 0], [4.1, 0], [6, 1.9], [6, 3.9], [4.1, 5.8], [0, 5.8]],
    [[2.7, 5.8], [6, 10]],
  ],
  S: [[[6, 1.7], [4.2, 0], [1.8, 0], [0, 1.7], [0, 3.3], [1.7, 4.7], [4.3, 5.3], [6, 6.7], [6, 8.3], [4.2, 10], [1.8, 10], [0, 8.3]]],
  T: [
    [[0, 0], [6, 0]],
    [[3, 0], [3, 10]],
  ],
  U: [[[0, 0], [0, 7.9], [1.9, 10], [4.1, 10], [6, 7.9], [6, 0]]],
  V: [[[0, 0], [3, 10], [6, 0]]],
  W: [[[0, 0], [1.5, 10], [3, 3.6], [4.5, 10], [6, 0]]],
  X: [
    [[0, 0], [6, 10]],
    [[6, 0], [0, 10]],
  ],
  Y: [
    [[0, 0], [3, 5.4], [6, 0]],
    [[3, 5.4], [3, 10]],
  ],
  Z: [[[0, 0], [6, 0], [0, 10], [6, 10]]],
  ".": [[[2.9, 9.8], [3.1, 9.8]]],
  "·": [[[2.9, 5], [3.1, 5]]],
  " ": [],
};

const TRACKING = 2.1; // grid units of sidebearing between glyph boxes

function textShapes(text, x, capTop, capHeight, weight) {
  const unit = capHeight / 10;
  const stroke = capHeight * weight;
  const advance = (6 + TRACKING) * unit;
  const shapes = [];
  let cursor = x;
  for (const character of text.toUpperCase()) {
    const glyph = GLYPHS[character];
    if (glyph === undefined) throw new Error(`No glyph for '${character}'`);
    for (const polyline of glyph) {
      for (let i = 0; i < polyline.length - 1; i += 1) {
        shapes.push(
          seg(
            cursor + polyline[i][0] * unit,
            capTop + polyline[i][1] * unit,
            cursor + polyline[i + 1][0] * unit,
            capTop + polyline[i + 1][1] * unit,
            stroke,
          ),
        );
      }
      if (polyline.length === 1) {
        shapes.push(disc(cursor + polyline[0][0] * unit, capTop + polyline[0][1] * unit, stroke / 2));
      }
    }
    cursor += advance;
  }
  return shapes;
}

const textWidth = (text, capHeight) =>
  text.length * (6 + TRACKING) * (capHeight / 10) - TRACKING * (capHeight / 10);

/* -------------------------------------------------------------------------- */
/* Palette                                                                     */
/* -------------------------------------------------------------------------- */

const INK = "#000000";
const ICON_BG = "#050505";
const AGENT = "#5b9bd5";
const CHALK = "#ffffff";
const CHALK_DIM = "#a3a3a3";
const CHALK_FAINT = "#737373";

/* -------------------------------------------------------------------------- */
/* Outputs                                                                     */
/* -------------------------------------------------------------------------- */

function write(path, buffer) {
  const target = join(ROOT, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buffer);
  console.log(`${path}  ${(buffer.length / 1024).toFixed(1)} KiB`);
}

/** A square mark on the brand charcoal, its ink filling `fraction` of the edge. */
function squareMark(size, fraction) {
  const image = canvas(size, size, ICON_BG);
  draw(image, markCentred(size, fraction), AGENT);
  return image;
}

/* favicon.ico — replaces the framework scaffold. icon.svg covers modern
   browsers; this exists for the ones that still ask for /favicon.ico. */
{
  const image = squareMark(32, 0.74);
  write("src/app/favicon.ico", encodeIco(32, encodePng(32, 32, image.rgba)));
}

/* apple-icon — Next accepts only jpg/jpeg/png here. Apple applies its own
   rounding, so this is a full-bleed square with no corner radius of its own. */
{
  const image = squareMark(180, 0.6);
  write("src/app/apple-icon.png", encodePng(180, 180, image.rgba));
}

/* X / avatar — cropped to a circle by every platform that uses it, so the mark
   is inset far enough to survive the crop. */
{
  const image = squareMark(1000, 0.54);
  write("public/brand/folester-avatar.png", encodePng(1000, 1000, image.rgba));
}

/* The social card. Same words as the hero, because a card that promises
   something the page does not say is its own small dishonesty. */
function socialCard() {
  const width = 1200;
  const height = 630;
  const image = canvas(width, height, INK);
  const margin = 96;

  /* Lockup */
  draw(image, markAt(margin, 99.5, 31), AGENT);
  draw(image, textShapes("FOLESTER", margin + 54, 90, 19, 0.105), CHALK);

  /* Headline */
  draw(image, textShapes("THE OPERATING LAYER FOR", margin, 236, 52, 0.1), CHALK);
  draw(image, textShapes("AUTONOMOUS AI AGENTS", margin, 322, 52, 0.1), CHALK);

  /* Hairline */
  draw(image, [seg(margin, 442, width - margin, 442, 1)], CHALK, 0.16);

  /* The four layers, and where it runs */
  draw(
    image,
    textShapes("IDENTITY · MEMORY · COMMUNICATION · EXECUTION", margin, 482, 20, 0.115),
    CHALK_DIM,
  );
  const tag = "RUNNING ON TECHNOCORE";
  draw(
    image,
    textShapes(tag, width - margin - textWidth(tag, 14), 488, 14, 0.13),
    CHALK_FAINT,
  );

  /* Three accent nodes at the lower right: the same vocabulary as the scene. */
  draw(
    image,
    [disc(width - margin - 4, 560, 4), disc(width - margin - 30, 560, 4), disc(width - margin - 56, 560, 4)],
    AGENT,
    0.55,
  );

  return encodePng(width, height, image.rgba);
}

{
  const card = socialCard();
  write("src/app/opengraph-image.png", card);
  write("src/app/twitter-image.png", card);
}
