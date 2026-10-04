// A GIF89a encoder and the PNG reader that feeds it, without dependencies.
// The motion animation (src/motion-gif.mjs) screenshots the viewer as PNG and
// writes one GIF frame per pose. Colours are exact when the frames use at most
// 256 distinct colours; otherwise one global palette keeps every flat colour exactly and median-cuts the rest
// (a rendered image is not a measurement, the report carries the numbers).
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// PNG bytes -> { width, height, rgba }. 8-bit greyscale, RGB, palette (with tRNS),
// grey+alpha and RGBA, not interlaced: the formats a browser screenshot has.
export function decodePng(bytes) {
  const buffer = Buffer.from(bytes);
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('gif/png-signature: not a PNG');
  let width = 0, height = 0, depth = 0, colorType = -1, interlace = 0, palette = null, transparency = null;
  const data = [];
  for (let at = 8; at + 8 <= buffer.length;) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('latin1', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      [depth, colorType, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') transparency = body;
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!width || !height || !channels) throw new Error('gif/png-header: missing or unsupported IHDR');
  if (depth !== 8 || interlace !== 0) throw new Error(`gif/png-format: only 8-bit, non-interlaced PNG (got depth ${depth}, interlace ${interlace})`);
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  if (raw.length !== (stride + 1) * height) throw new Error('gif/png-size: decompressed size does not match the header');
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = y * stride, above = line - stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? pixels[line + x - channels] : 0;
      const b = y ? pixels[above + x] : 0;
      const c = y && x >= channels ? pixels[above + x - channels] : 0;
      let predicted;
      if (filter === 0) predicted = 0;
      else if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else throw new Error(`gif/png-filter: unknown filter ${filter}`);
      pixels[line + x] = (value + predicted) & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = i * channels, o = i * 4;
    if (colorType === 6) pixels.copy(rgba, o, p, p + 4);
    else if (colorType === 2) { rgba[o] = pixels[p]; rgba[o + 1] = pixels[p + 1]; rgba[o + 2] = pixels[p + 2]; rgba[o + 3] = 255; }
    else if (colorType === 0) { rgba[o] = rgba[o + 1] = rgba[o + 2] = pixels[p]; rgba[o + 3] = 255; }
    else if (colorType === 4) { rgba[o] = rgba[o + 1] = rgba[o + 2] = pixels[p]; rgba[o + 3] = pixels[p + 1]; }
    else {
      const k = pixels[p];
      if (!palette || k * 3 + 2 >= palette.length) throw new Error('gif/png-palette: index outside PLTE');
      rgba[o] = palette[k * 3]; rgba[o + 1] = palette[k * 3 + 1]; rgba[o + 2] = palette[k * 3 + 2];
      rgba[o + 3] = transparency && k < transparency.length ? transparency[k] : 255;
    }
  }
  return { width, height, rgba };
}

// Alpha is composited over white: a GIF frame here is opaque.
const flat = (rgba, i) => {
  const a = rgba[i + 3];
  if (a === 255) return (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
  const mix = channel => Math.round((channel * a + 255 * (255 - a)) / 255);
  return (mix(rgba[i]) << 16) | (mix(rgba[i + 1]) << 8) | mix(rgba[i + 2]);
};

// Palette of at most `limit` colours for the given RGBA images: the colours
// themselves when they fit, otherwise median cut over the weighted colours.
export function buildPalette(images, limit = 256) {
  const counts = new Map();
  for (const rgba of images) for (let i = 0; i < rgba.length; i += 4) { const c = flat(rgba, i); counts.set(c, (counts.get(c) ?? 0) + 1); }
  if (counts.size <= limit) return { colors: [...counts.keys()].sort((a, b) => a - b), exact: true, distinct: counts.size };
  // Flat regions (a body colour, the background) keep their exact colour: every
  // colour holding at least 0.2 % of the pixels, up to half the palette. The rest
  // (edges, gradients, shading) is median cut into the remaining entries.
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  const heavy = [...counts].filter(([, n]) => n >= total * 0.002).sort((p, q) => q[1] - p[1] || p[0] - q[0]).slice(0, limit >> 1);
  const kept = new Set(heavy.map(([c]) => c));
  const room = limit - heavy.length;
  let boxes = [[...counts].filter(([c]) => !kept.has(c)).map(([c, n]) => ({ r: c >> 16, g: (c >> 8) & 255, b: c & 255, n }))];
  const range = (box, key) => { let lo = 255, hi = 0; for (const e of box) { lo = Math.min(lo, e[key]); hi = Math.max(hi, e[key]); } return hi - lo; };
  while (boxes.length < room) {
    let pick = -1, best = 0;
    boxes.forEach((box, k) => {
      if (box.length < 2) return;
      const spread = Math.max(range(box, 'r'), range(box, 'g'), range(box, 'b')) * box.reduce((s, e) => s + e.n, 0);
      if (spread > best) { best = spread; pick = k; }
    });
    if (pick < 0) break;
    const box = boxes[pick];
    const key = ['r', 'g', 'b'].reduce((k, c) => (range(box, c) > range(box, k) ? c : k), 'r');
    box.sort((p, q) => p[key] - q[key]);
    const half = box.reduce((s, e) => s + e.n, 0) / 2;
    let acc = 0, cut = 0;
    while (cut < box.length - 1 && acc + box[cut].n < half) acc += box[cut++].n;
    boxes.splice(pick, 1, box.slice(0, cut + 1), box.slice(cut + 1));
  }
  const colors = [...heavy.map(([c]) => c), ...boxes.filter(box => box.length).map(box => {
    const weight = box.reduce((s, e) => s + e.n, 0);
    const mean = key => Math.round(box.reduce((s, e) => s + e[key] * e.n, 0) / weight);
    return (mean('r') << 16) | (mean('g') << 8) | mean('b');
  })];
  return { colors, exact: false, distinct: counts.size };
}

function lzw(indices, minCodeSize) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  const bytes = [];
  let size = minCodeSize + 1, next = eoi + 1, accumulator = 0, held = 0;
  let table = new Map();
  const emit = code => {
    accumulator |= code << held; held += size;
    while (held >= 8) { bytes.push(accumulator & 255); accumulator >>>= 8; held -= 8; }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = (prefix << 8) | k, found = table.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next === 4096) { emit(clear); next = eoi + 1; size = minCodeSize + 1; table = new Map(); }
    else { if (next >= (1 << size)) size++; table.set(key, next++); }
    prefix = k;
  }
  emit(prefix);
  // The decoder adds one more entry after the last code and may widen for the end code.
  if (next < 4096 && next >= (1 << size)) size++;
  emit(eoi);
  if (held > 0) bytes.push(accumulator & 255);
  return bytes;
}

const u16 = value => [value & 255, (value >> 8) & 255];

// frames: [{ rgba: Buffer of width*height*4, delayCs? }]. Returns { bytes, palette }
// with palette { colors, exact, distinct }. A frame delay is in 1/100 s.
export function encodeGif({ width, height, frames, delayCs = 60, loop = 0, palette: given }) {
  if (!frames.length) throw new Error('gif/no-frames: at least one frame');
  if (!(width > 0 && width < 65536 && height > 0 && height < 65536)) throw new Error('gif/dimensions: 1..65535 pixels');
  for (const frame of frames) if (frame.rgba.length !== width * height * 4) throw new Error('gif/frame-size: a frame does not match the GIF dimensions');
  const palette = given ?? buildPalette(frames.map(frame => frame.rgba));
  const bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, palette.colors.length))));
  const minCodeSize = Math.max(2, bits);
  const out = [...Buffer.from('GIF89a'), ...u16(width), ...u16(height), 0x80 | 0x70 | (bits - 1), 0, 0];
  for (let k = 0; k < (1 << bits); k++) { const c = palette.colors[k] ?? 0; out.push(c >> 16, (c >> 8) & 255, c & 255); }
  out.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, ...u16(loop), 0x00);
  const lookup = new Map(palette.colors.map((c, k) => [c, k]));
  const nearest = c => {
    let best = 0, distance = Infinity;
    const r = c >> 16, g = (c >> 8) & 255, b = c & 255;
    palette.colors.forEach((p, k) => {
      const d = (r - (p >> 16)) ** 2 + (g - ((p >> 8) & 255)) ** 2 + (b - (p & 255)) ** 2;
      if (d < distance) { distance = d; best = k; }
    });
    lookup.set(c, best);
    return best;
  };
  for (const frame of frames) {
    const indices = new Uint8Array(width * height);
    for (let i = 0; i < indices.length; i++) { const c = flat(frame.rgba, i * 4); indices[i] = lookup.get(c) ?? nearest(c); }
    out.push(0x21, 0xf9, 0x04, 0x04, ...u16(frame.delayCs ?? delayCs), 0x00, 0x00);
    out.push(0x2c, 0, 0, 0, 0, ...u16(width), ...u16(height), 0x00, minCodeSize);
    const data = lzw(indices, minCodeSize);
    for (let at = 0; at < data.length; at += 255) { const chunk = data.slice(at, at + 255); out.push(chunk.length, ...chunk); }
    out.push(0x00);
  }
  out.push(0x3b);
  return { bytes: Buffer.from(out), palette };
}
