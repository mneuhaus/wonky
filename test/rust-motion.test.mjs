// Motion sampling (src/motion.mjs, bin/wonky-motion.mjs). Closed forms only:
// a door hinged on a lattice axis sweeping toward a stop block, and a slider
// closing a gap of known size. The contact pose is decided exactly (abutment at
// the analytic contact angle), so a float cos/sin rotation cannot pass it; the
// planted negatives run the same assertions on throwaway copies of the module
// with the exact placement replaced or an undecided pair reported as clear.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const motionModule = await import('../src/motion.mjs');
const { buildPalette, decodePng, encodeGif } = await import('../src/gif.mjs');
const { writeMotionGif } = await import('../src/motion-gif.mjs');
const { MotionRefusal, normalizeMotionSpec, runMotion } = motionModule;

const root = fileURLToPath(new URL('../', import.meta.url));
const box = (id, lo, hi) => `fCuboid(context,id+"${id}",{"corner1":vector(${lo})*millimeter,"corner2":vector(${hi})*millimeter});`;
const source = statements => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
${statements}
});`;

// Door: 100 x 10 x 50 mm, hinged on the z axis through x = 50 mm (mid-door), so
// the hinge translation is a real chained step. Stop block x 55..100, y -30..-10.
// The door's y = 10 face swings to y = -10 mm exactly at 180 degrees (contact
// with the stop's top face), and at 270 degrees the door spans x 50..60, y -50..50.
// A float cos/sin rotation errs by 1.2e-16 at 180 degrees, which dips the door's
// half at x < 50 into the stop, so the exact contact cannot be reproduced by it.
const doorSource = source(box('door', '0,0,0', '100,10,50') + box('stop', '55,-30,0', '100,-10,50'));
const doorSpec = samples => ({ schema: 'wonky-motion/v1', model: { source: 'door.fs', feature: 'f' },
  joints: [{ id: 'hinge', type: 'revolute', body: 'door', axis: { point: [50, 0, 0], direction: [0, 0, 1] }, range: [0, 360], driver: { samples } }] });
// Slider: 10 mm cube A at x 0..10, cube B at x 20..30 slides along x by -15..0.
const sliderSource = source(box('a', '0,0,0', '10,10,10') + box('b', '20,0,0', '30,10,10'));
const sliderSpec = samples => ({ schema: 'wonky-motion/v1', model: { source: 'slider.fs', feature: 'f' },
  joints: [{ id: 'slide', type: 'prismatic', body: 'b', direction: [1, 0, 0], range: [-15, 0], driver: { samples } }] });

// A genuinely unfulfillable tolerance retains refusal coverage now that 45° runs.
const tightSpec = samples => { const spec = doorSpec(samples); spec.joints[0].rotationToleranceDegrees = 1e-14; return spec; };

const pair = (pose, name) => pose.pairs.find(p => `${p.aName}|${p.bName}`.includes(name)) ?? pose.pairs[0];
const near = (value, expected, bound) => assert.ok(Math.abs(value - expected) <= bound + 1e-9, `${value} vs ${expected} (+-${bound})`);
const doorModel = await build(doorSource, { feature: 'f' });
const sliderModel = await build(sliderSource, { feature: 'f' });

// The contact-angle contract, applied to a report (also used by the planted negative).
function assertDoorContact(report) {
  assert.deepEqual(report.poses.map(p => pair(p).kind), ['clear', 'clear', 'abutment', 'interference']);
  near(report.poses[0].pairs[0].distanceMm, 10, report.poses[0].pairs[0].distanceBoundMm);
  near(report.poses[1].pairs[0].distanceMm, 5, report.poses[1].pairs[0].distanceBoundMm);
  assert.equal(report.poses[2].pairs[0].distanceMm, 0);
  assert.equal(report.poses[2].pairs[0].volumeMm3, 0);
  // 270 degrees: the door spans x 50..60, y -50..50; overlap with the stop is 5 x 20 x 50.
  near(report.poses[3].pairs[0].volumeMm3, 5000, report.poses[3].pairs[0].volumeBoundMm3);
}
// An undecided pair is never clear.
function assertUndecidedRefused(report) {
  const pose = report.poses[1];
  assert.equal(pose.exactPlacement, false);
  assert.equal(pose.pairs[0].kind, 'refused');
  assert.match(pose.pairs[0].refusal, /^motion\/rotation-tolerance-unmet/);
  assert.equal(pose.summary.clear, 0);
  assert.equal(pose.summary.refused, 1);
  assert.equal(report.summary.posesWithRefusal, 1);
}

test('door hinged on the z axis at x = 50 mm is clear (10 mm), clear (5 mm), abutting exactly at 180 degrees, then interferes with the exact volume', () => {
  const { report } = runMotion(doorModel, doorSpec([0, 90, 180, 270]));
  assertDoorContact(report);
  assert.equal(report.summary.refused, 0);
  assert.equal(report.poses.every(p => p.exactPlacement), true);
});

test('the report states it is sampled, not continuous, and names the largest sample step', () => {
  const { report } = runMotion(doorModel, doorSpec([0, 90, 270]));
  assert.equal(report.sampling.continuous, false);
  assert.equal(report.sampling.poses, 3);
  assert.equal(report.sampling.largestSampleStep[0].step, 180);
  assert.match(report.statement, /Sampled at 3 poses; not continuous collision detection\. Largest sample step: hinge 180 degree/);
  assert.ok(report.notChecked.includes('continuous (swept) collision'));
  assert.ok(report.notChecked.includes('closed kinematic chains'));
  assert.equal(report.model.bodies.length, 2);
  assert.match(report.model.hash, /^[0-9a-f]{64}$/);
});

test('a hinge away from the origin chains three exact steps and abuts exactly at 90 degrees', async () => {
  // Hinge axis through x = 100 mm. At 90 degrees the door (100 x 10 mm) hangs from y = 0 to y = -100 mm
  // (the same binary64 value as the stop's face), so contact is exact only if translate-rotate-translate composes exactly.
  const model = await build(source(box('door', '0,0,0', '100,10,50') + box('stop', '80,-150,0', '120,-100,50')), { feature: 'f' });
  const joint = { ...doorSpec([0]).joints[0], axis: { point: [100, 0, 0], direction: [0, 0, 1] }, driver: { samples: [0, 90, 180] } };
  const { report } = runMotion(model, { ...doorSpec([0]), joints: [joint] });
  assert.deepEqual(report.poses.map(p => p.pairs[0].kind), ['clear', 'abutment', 'clear']);
  assert.equal(report.poses[1].pairs[0].distanceMm, 0);
});

test('a slider closes a 10 mm gap: distances 10 and 5, exact contact at -10, then 500 mm3 of interference', () => {
  const { report } = runMotion(sliderModel, sliderSpec([0, -5, -10, -15]));
  const [p0, p1, p2, p3] = report.poses.map(p => p.pairs[0]);
  assert.deepEqual([p0.kind, p1.kind, p2.kind, p3.kind], ['clear', 'clear', 'abutment', 'interference']);
  near(p0.distanceMm, 10, p0.distanceBoundMm);
  near(p1.distanceMm, 5, p1.distanceBoundMm);
  assert.equal(p2.distanceMm, 0);
  near(p3.volumeMm3, 500, p3.volumeBoundMm3);
});

test('an unfulfillable angular tolerance refuses by name and the pair is refused, never clear', () => {
  const { report } = runMotion(doorModel, tightSpec([0, 45, 180, 270]));
  assertUndecidedRefused(report);
  assert.equal(report.poses[0].pairs[0].kind, 'clear');
  assert.equal(report.poses[2].pairs[0].kind, 'abutment');
});

test('spec errors refuse with stable codes', () => {
  const bad = (mutate, code) => {
    const spec = structuredClone(doorSpec([0, 90]));
    mutate(spec);
    assert.throws(() => normalizeMotionSpec(spec), e => e instanceof MotionRefusal && e.code === code, code);
  };
  bad(s => { s.schema = 'x'; }, 'motion/schema');
  bad(s => { s.joints[0].type = 'screw'; }, 'motion/joint-type');
  bad(s => { s.joints[0].parent = 'other'; }, 'motion/chains-not-supported');
  bad(s => { s.joints[0].driver = { samples: [0], count: 3 }; }, 'motion/driver');
  bad(s => { s.joints[0].driver = { samples: [400] }; }, 'motion/sample-out-of-range');
  bad(s => { s.joints[0].axis.direction = [0, 0, 0]; }, 'motion/axis');
  bad(s => { s.joints.push({ ...s.joints[0], id: 'again' }); }, 'motion/body-moved-twice');
  assert.throws(() => runMotion(doorModel, { ...doorSpec([0]), joints: [{ ...doorSpec([0]).joints[0], body: 'nope' }] }), e => e.code === 'motion/body-not-found');
});

test('a count driver spreads samples over the range, the last one exactly at its end', () => {
  const spec = normalizeMotionSpec({ ...doorSpec([0]), joints: [{ ...doorSpec([0]).joints[0], driver: { count: 5 } }] });
  assert.deepEqual(spec.joints[0].samples, [0, 90, 180, 270, 360]);
});

// ---- planted negatives: the same contracts on throwaway copies of the module

async function plantedModule(from, to) {
  const path = join(root, 'src', 'native', '..', `.motion-planted-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
  const text = readFileSync(join(root, 'src', 'motion.mjs'), 'utf8');
  assert.ok(text.includes(from), `planted edit target missing: ${from}`);
  writeFileSync(path, text.replace(from, to));
  try { return await import(pathToFileURL(path).href); } finally { rmSync(path, { force: true }); }
}

test('planted: float cos/sin rotations instead of the exact placement lose the contact angle', async () => {
  const planted = await plantedModule('const [ex, , ez] = quarterTurn(axis, k);',
    'const c = Math.cos(k * Math.PI / 2), s = Math.sin(k * Math.PI / 2); const ex = [c, s, 0], ez = [0, 0, 1];');
  const { report } = planted.runMotion(doorModel, doorSpec([0, 90, 180, 270]));
  assert.notEqual(report.poses[2].pairs[0].kind, 'abutment');
  assert.throws(() => assertDoorContact(report));
});

test('planted: reporting clear for an undecided pair fails the undecided contract', async () => {
  const planted = await plantedModule("kind: 'refused', volumeMm3: null", "kind: 'clear', volumeMm3: null");
  const { report } = planted.runMotion(doorModel, tightSpec([0, 45, 180, 270]));
  assert.throws(() => assertUndecidedRefused(report));
});

test('CLI: --json prints the report, exits 0; an undecided pose exits 2; a bad spec exits 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-motion-'));
  try {
    writeFileSync(join(dir, 'door.fs'), doorSource);
    const run = (samples, tight = false) => {
      writeFileSync(join(dir, 'spec.json'), JSON.stringify(tight ? tightSpec(samples) : doorSpec(samples)));
      return spawnSync(process.execPath, ['bin/wonky-motion.mjs', join(dir, 'spec.json'), '--json'], { cwd: root, encoding: 'utf8', env: { ...process.env, WONKY_BACKEND: 'rust' } });
    };
    const ok = run([0, 90, 180, 270]);
    assert.equal(ok.status, 0, ok.stderr);
    const report = JSON.parse(ok.stdout);
    assert.equal(report.schema, 'wonky-motion-report/v1');
    assert.equal(report.poses.length, 4);
    assert.equal(report.poses[2].pairs[0].kind, 'abutment');
    assert.match(report.configuration.specSha256, /^[0-9a-f]{64}$/);
    const arbitrary = run([0, 45]);
    assert.equal(arbitrary.status, 0, arbitrary.stderr);
    assert.equal(JSON.parse(arbitrary.stdout).poses[1].exactPlacement, true);
    const undecided = run([0, 45], true);
    assert.equal(undecided.status, 2, undecided.stderr);
    assert.equal(JSON.parse(undecided.stdout).poses[1].pairs[0].kind, 'refused');
    const refused = run([0, 500]);
    assert.equal(refused.status, 1);
    assert.equal(JSON.parse(refused.stdout).error.code, 'motion/sample-out-of-range');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- GIF: encoder against an independent decoder, and the rendered animation

// A GIF89a reader written from the format (LZW with the decoder-side code-size rule).
function decodeGif(bytes) {
  assert.equal(bytes.toString('latin1', 0, 6), 'GIF89a');
  const width = bytes.readUInt16LE(6), height = bytes.readUInt16LE(8), packed = bytes[10];
  let at = 13, palette = [];
  if (packed & 0x80) { const size = 3 << ((packed & 7) + 1); for (let k = 0; k < size; k += 3) palette.push([bytes[at + k], bytes[at + k + 1], bytes[at + k + 2]]); at += size; }
  const frames = [];
  let loop = null;
  const blocks = () => { const parts = []; for (let n = bytes[at++]; n; n = bytes[at++]) { parts.push(bytes.subarray(at, at + n)); at += n; } return Buffer.concat(parts); };
  while (bytes[at] !== 0x3b) {
    if (bytes[at] === 0x21) {
      const label = bytes[at + 1]; at += 2;
      const data = blocks();
      if (label === 0xff && data.toString('latin1', 0, 11) === 'NETSCAPE2.0') loop = data.readUInt16LE(12);
    } else {
      assert.equal(bytes[at], 0x2c);
      assert.deepEqual([bytes.readUInt16LE(at + 5), bytes.readUInt16LE(at + 7), bytes[at + 9]], [width, height, 0], 'full-frame images, no local table');
      const minCode = bytes[at + 10]; at += 11;
      const data = blocks();
      const clear = 1 << minCode, eoi = clear + 1, out = new Uint8Array(width * height);
      let size = minCode + 1, table = [], previous = null, filled = 0, buffer = 0, held = 0, cursor = 0, done = false;
      const reset = () => { table = Array.from({ length: clear + 2 }, (_, k) => (k < clear ? [k] : null)); size = minCode + 1; previous = null; };
      reset();
      while (!done) {
        while (held < size) { assert.ok(cursor < data.length, 'end code missing'); buffer |= data[cursor++] << held; held += 8; }
        const code = buffer & ((1 << size) - 1); buffer >>>= size; held -= size;
        if (code === clear) { reset(); continue; }
        if (code === eoi) break;
        let entry;
        if (code < table.length && table[code]) entry = table[code];
        else { assert.ok(previous && code === table.length, 'code outside the table'); entry = [...previous, previous[0]]; }
        for (const v of entry) out[filled++] = v;
        if (previous) table.push([...previous, entry[0]]);
        previous = entry;
        if (table.length === (1 << size) && size < 12) size++;
      }
      assert.equal(filled, width * height, 'every pixel decoded');
      frames.push(out);
    }
  }
  return { width, height, palette, frames, loop };
}
const rgbAt = (gif, frame, x, y) => gif.palette[gif.frames[frame][y * gif.width + x]];
let seed = 12345;
const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

test('the GIF encoder round-trips exact indices and colours through an independent decoder, across code-table resets', () => {
  // noise forces 12-bit codes and several clear codes; the sizes sweep the end-code boundary
  for (const [width, height, colors] of [[1, 1, 2], [3, 5, 4], [64, 64, 256], [97, 83, 200], [130, 130, 256]]) {
    const palette = { colors: Array.from({ length: colors }, (_, k) => (k * 65793) & 0xffffff), exact: true, distinct: colors };
    const frames = [0, 1].map(() => {
      const rgba = Buffer.alloc(width * height * 4);
      for (let i = 0; i < width * height; i++) { const c = palette.colors[Math.floor(random() * colors)]; rgba.set([c >> 16, (c >> 8) & 255, c & 255, 255], i * 4); }
      return { rgba };
    });
    const { bytes } = encodeGif({ width, height, frames, palette });
    const gif = decodeGif(bytes);
    assert.deepEqual([gif.width, gif.height, gif.frames.length, gif.loop], [width, height, 2, 0]);
    frames.forEach((frame, k) => {
      let wrong = 0;
      for (let i = 0; i < width * height; i++) {
        const [r, g, b] = gif.palette[gif.frames[k][i]];
        if (r !== frame.rgba[i * 4] || g !== frame.rgba[i * 4 + 1] || b !== frame.rgba[i * 4 + 2]) wrong++;
      }
      assert.equal(wrong, 0, `${width}x${height} frame ${k}: pixels with a wrong colour`);
    });
  }
});

test('a picture with more than 256 colours quantises to a 256-colour palette and says it is not exact, flat colours stay exact', () => {
  const rgba = Buffer.alloc(40 * 40 * 4);
  for (let i = 0; i < 1600; i++) rgba.set([Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256), 255], i * 4);
  const palette = buildPalette([rgba]);
  assert.equal(palette.exact, false);
  assert.equal(palette.colors.length, 256);
  assert.ok(palette.distinct > 256);
  assert.equal(decodeGif(encodeGif({ width: 40, height: 40, frames: [{ rgba }] }).bytes).frames[0].length, 1600);
  // a flat region plus noise: the flat colour must survive quantisation unchanged
  const flatPicture = Buffer.alloc(60 * 60 * 4);
  for (let i = 0; i < 3600; i++) flatPicture.set(i < 2000 ? [242, 166, 25, 255] : [Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256), 255], i * 4);
  const flatGif = decodeGif(encodeGif({ width: 60, height: 60, frames: [{ rgba: flatPicture }] }).bytes);
  assert.deepEqual(rgbAt(flatGif, 0, 0, 0), [242, 166, 25]);
  assert.deepEqual(rgbAt(flatGif, 0, 59, 32), [242, 166, 25]);
});

test('the PNG reader undoes every scanline filter', () => {
  const [width, height] = [9, 6], rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 37 + (i >> 3) * 11) & 255;
  const stride = width * 3, paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  const lines = [];
  for (let y = 0; y < height; y++) {
    const filter = y % 5, line = Buffer.alloc(1 + stride); line[0] = filter;
    for (let x = 0; x < stride; x++) {
      const a = x >= 3 ? rgb[y * stride + x - 3] : 0, b = y ? rgb[(y - 1) * stride + x] : 0, c = y && x >= 3 ? rgb[(y - 1) * stride + x - 3] : 0;
      line[1 + x] = (rgb[y * stride + x] - [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter]) & 255;
    }
    lines.push(line);
  }
  const chunk = (type, body) => { const head = Buffer.alloc(8); head.writeUInt32BE(body.length); head.write(type, 4, 'latin1'); return Buffer.concat([head, body, Buffer.alloc(4)]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(lines))), chunk('IEND', Buffer.alloc(0))]);
  const decoded = decodePng(png);
  assert.deepEqual([decoded.width, decoded.height], [width, height]);
  let wrong = 0;
  for (let i = 0; i < width * height; i++) for (let k = 0; k < 3; k++) if (decoded.rgba[i * 4 + k] !== rgb[i * 3 + k]) wrong++;
  assert.equal(wrong, 0);
});

const playwright = process.env.WONKY_PLAYWRIGHT ?? join(homedir(), '.dev-browser/node_modules/playwright-core/index.mjs');
// shaded body colours by hue: red (interference), amber (abutment), violet (refused)
const isRed = ([r, g, b]) => r > 160 && g < 90 && b < 70;
const isAmber = ([r, g, b]) => r > 200 && g > 130 && g < 190 && b < 80;
const isViolet = ([r, g, b]) => b > 140 && r > 90 && r < 190 && g < 110;
const isGrey = ([r, g, b]) => r >= 110 && r <= 205 && b >= r && b - r <= 30 && Math.abs(g - r) <= 15;
const share = (gif, frame, isColor) => { let n = 0; for (const k of gif.frames[frame]) if (isColor(gif.palette[k])) n++; return n; };

test('the animation has one decodable frame per pose, colliding bodies highlighted, refused poses shown as such', { skip: existsSync(playwright) ? false : `no playwright-core at ${playwright} (set WONKY_PLAYWRIGHT)`, timeout: 300000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-motion-gif-'));
  try {
    const { report, posed } = runMotion(doorModel, tightSpec([0, 90, 180, 270, 45]));
    const written = await writeMotionGif(doorModel, report, posed, join(dir, 'door.gif'));
    const gif = decodeGif(readFileSync(join(dir, 'door.gif')));
    assert.equal(gif.frames.length, report.poses.length);
    assert.equal(written.frames, report.poses.length);
    assert.deepEqual([gif.width, gif.height], [written.width, written.height]);
    assert.ok(gif.width > 300 && gif.height > 300);
    const reds = report.poses.map((_, k) => share(gif, k, isRed)), ambers = report.poses.map((_, k) => share(gif, k, isAmber)), violets = report.poses.map((_, k) => share(gif, k, isViolet));
    assert.deepEqual(reds.map(n => n > 500), [false, false, false, true, false], 'interference (pose 270) is red, no other pose is');
    assert.deepEqual(ambers.map(n => n > 500), [false, false, true, false, false], 'exact contact (pose 180) is amber');
    assert.deepEqual(violets.map(n => n > 500), [false, false, false, false, true], 'the too-tight 45 degree pose is refused, shown violet at rest');
    // One camera for all poses: the fixed stop is grey and unoccluded at 0 and 90
    // degrees, so its largest face covers the same pixels in both frames (a
    // per-pose automatic fit moves it by tens of pixels; IoU was 0.17).
    const counts = new Map();
    for (const k of gif.frames[0]) if (isGrey(gif.palette[k])) counts.set(k, (counts.get(k) ?? 0) + 1);
    const [face, size] = [...counts].sort((p, q) => q[1] - p[1])[0];
    assert.ok(size > 2000, `the stop face is visible (${size} px)`);
    let both = 0, either = 0;
    gif.frames[0].forEach((k, i) => { const x = k === face, y = gif.frames[1][i] === face; if (x && y) both++; if (x || y) either++; });
    assert.ok(both / either > 0.99, `the fixed stop keeps its pixels between poses (IoU ${both / either})`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('without a browser the animation refuses by name and writes no file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-motion-gif-'));
  const before = process.env.WONKY_PLAYWRIGHT;
  process.env.WONKY_PLAYWRIGHT = join(dir, 'no-such-playwright.mjs');
  try {
    const { report, posed } = runMotion(doorModel, doorSpec([0, 90]));
    await assert.rejects(writeMotionGif(doorModel, report, posed, join(dir, 'x.gif')), e => e instanceof MotionRefusal && e.code === 'motion/gif-no-browser');
    assert.equal(existsSync(join(dir, 'x.gif')), false);
  } finally {
    if (before === undefined) delete process.env.WONKY_PLAYWRIGHT; else process.env.WONKY_PLAYWRIGHT = before;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: --gif writes the animation next to the report, one frame per pose', { skip: existsSync(playwright) ? false : `no playwright-core at ${playwright} (set WONKY_PLAYWRIGHT)`, timeout: 300000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-motion-'));
  try {
    writeFileSync(join(dir, 'door.fs'), doorSource);
    writeFileSync(join(dir, 'spec.json'), JSON.stringify(doorSpec([0, 90, 180, 270])));
    const run = spawnSync(process.execPath, ['bin/wonky-motion.mjs', join(dir, 'spec.json'), '--json', '--gif', join(dir, 'door.gif')], { cwd: root, encoding: 'utf8', env: { ...process.env, WONKY_BACKEND: 'rust' } });
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    const gif = decodeGif(readFileSync(join(dir, 'door.gif')));
    assert.equal(gif.frames.length, report.poses.length);
    assert.equal(report.gif.frames, gif.frames.length);
    assert.deepEqual([report.gif.width, report.gif.height], [gif.width, gif.height]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// End-to-end angle/transport contract: these all refused on the quarter-turn-only
// implementation. Expected collision states are the door's analytic intervals.
test('fifteen-degree door samples use rational rigid poses, with exact contact and volume retained', () => {
  const samples = Array.from({ length: 19 }, (_, i) => i * 15);
  const { report } = runMotion(doorModel, doorSpec(samples));
  assert.equal(report.summary.refused, 0);
  assert.equal(report.summary.pairChecks, 19);
  assert.equal(report.sampling.largestSampleStep[0].step, 15);
  assert.deepEqual(report.poses.map(p => p.pairs[0].kind), [
    ...Array(7).fill('clear'), ...Array(5).fill('interference'), 'abutment',
    ...Array(3).fill('clear'), ...Array(3).fill('interference'),
  ]);
  assert.equal(report.poses[12].pairs[0].distanceMm, 0);
  near(report.poses[18].pairs[0].volumeMm3, 5000, report.poses[18].pairs[0].volumeBoundMm3);
  for (const pose of report.poses) {
    const r = pose.values.hinge.rotation;
    assert.equal(r.requestedDegrees, samples[pose.index]);
    assert.ok(r.angularErrorUpperDegrees <= r.toleranceDegrees);
    assert.ok(Math.abs(r.deviationDegrees) <= r.angularErrorUpperDegrees + 1e-12);
  }
});

test('a rational motion post map preserves an ordinary interpreter source frame without requiring its Gram matrix to be ideal', async () => {
  const model = await build(source(box('door', '0,0,0', '100,10,50') +
    'opTransform(context,id+"turn",{"bodies":qCreatedBy(id+"door",EntityType.BODY),"transform":toWorld(coordSystem(vector(0,0,0)*meter,vector(12,5,0),vector(0,0,1)))});' +
    box('stop', '1000,1000,1000', '1100,1100,1100')), { feature: 'f' });
  const { report } = runMotion(model, doorSpec([0, 15, 90]));
  assert.equal(report.summary.refused, 0);
  assert.deepEqual(report.poses.map(p => p.exactPlacement), [true, true, true]);
  assert.deepEqual(report.poses.map(p => p.pairs[0].kind), ['clear', 'clear', 'clear']);
  assert.ok(report.poses.every(p => p.pairs[0].distanceMm > p.pairs[0].distanceBoundMm));
});

test('equal composed frames retain interference, containment, contact and clearance in the general planar Boolean path', async () => {
  const cube = (id, lo, hi) => `fCuboid(context,id+"${id}",{"corner1":vector(${lo})*meter,"corner2":vector(${hi})*meter});`;
  for (const [lo, hi, kind, volume, distance] of [
    ['1,1,1', '3,3,3', 'interference', 1e9, 0],
    ['0.5,0.5,0.5', '1.5,1.5,1.5', 'interference', 1e9, 0],
    ['2,0,0', '3,2,2', 'abutment', 0, 0],
    ['3,0,0', '4,2,2', 'clear', 0, 1000],
  ]) {
    const model = await build(source(cube('a', '0,0,0', '2,2,2') + cube('b', lo, hi)), { feature: 'f' });
    const spec = { ...doorSpec([0, 15, 90]), units: { length: 'm' }, joints: ['a', 'b'].map(body => ({
      ...doorSpec([0, 15, 90]).joints[0], id: body, body, axis: { point: [0, 0, 0], direction: [0, 0, 1] },
    })) };
    const { report } = runMotion(model, spec);
    assert.equal(report.summary.refused, 0);
    for (const pose of report.poses) {
      const pair = pose.pairs[0];
      assert.equal(pose.exactPlacement, true);
      assert.equal(pair.kind, kind);
      assert.ok(Math.abs(pair.volumeMm3 - volume) <= pair.volumeBoundMm3);
      assert.ok(Math.abs(pair.distanceMm - distance) <= pair.distanceBoundMm);
    }
  }
});

test('irrational angles and a 0–30 degree five-degree sweep disclose a Pythagorean realization and deviation', () => {
  const samples = [0, 5, 10, 15, 20, 25, 30, Math.sqrt(2)];
  const { report } = runMotion(doorModel, doorSpec(samples));
  assert.equal(report.summary.refused, 0);
  assert.equal(report.poses.every(p => p.exactPlacement && p.pairs[0].type === 'NONE'), true);
  const r = report.poses.at(-1).values.hinge.rotation;
  assert.equal(r.requestedDegrees, Math.sqrt(2));
  assert.notEqual(r.deviationDegrees, 0);
  assert.ok(r.angularErrorUpperDegrees < 1e-6);
  const p = BigInt(r.tanHalfAngle.numerator), q = BigInt(r.tanHalfAngle.denominator);
  const d = q*q+p*p, c = q*q-p*p, sn = 2n*p*q;
  assert.equal(c*c+sn*sn, d*d);
  near(r.realizedDegrees, r.quarterTurns*90+360/Math.PI*Math.atan(Number(p)/Number(q)), 1e-12);
});

test('public point measurement keeps exact millimetre coordinates through rational wrappers and chained translations', async () => {
  const { placeRustBody, rustModelKernel, measureRustBody } = await import('../src/native/rust-host.mjs');
  const model = await build(source('fCuboid(context,id+"cube",{"corner1":vector(0,0,0)*meter,"corner2":vector(1,1,1)*meter});'), { feature: 'f' });
  const kernel = rustModelKernel(model);
  const identity = { rational: { rows: [[1,0,0],[0,1,0],[0,0,1]], denominator: 1 } };
  const translation = x => ({ origin: [x,0,0], x: [1,0,0], z: [0,0,1] });
  for (const wrapped of [false, true]) {
    let cube = wrapped ? placeRustBody(kernel, model.bodies[0], identity) : model.bodies[0];
    cube = placeRustBody(kernel, placeRustBody(kernel, cube, translation(0.001)), translation(-(2 ** -66)));
    const [outside, inside] = measureRustBody(kernel, cube, { probes: [[1,500,500],[2,500,500]] }).probes;
    if (!wrapped) {
      assert.match(outside.refused, /^observe\/(interior-probe-within-mapping-budget|probe-within-mapping-budget)$/);
      assert.equal(inside.inside, true);
      continue;
    }
    assert.equal(outside.inside, false);
    // Exact minimum x = 1 + 67/2^63 mm; the dyadic distance is representable.
    const expected = 67 * 2 ** -63;
    assert.ok(outside.distanceMm > outside.boundMm);
    assert.ok(Math.abs(outside.distanceMm - expected) <= outside.boundMm);
    assert.equal(inside.inside, true);
    assert.equal(inside.distanceMm, 0);
  }
});

test('rational 5-12-13 placement exports mesh, STL and all plane carriers, also after its exact inverse', async () => {
  const { placeRustBody, rustModelKernel, rustMesh, rustStl, rustCarriers } = await import('../src/native/rust-host.mjs');
  const model = await build(source('fCuboid(context,id+"cube",{"corner1":vector(0,0,0)*meter,"corner2":vector(1,1,1)*meter});'), { feature: 'f' });
  const kernel = rustModelKernel(model);
  const rational = rows => ({ rational: { rows, denominator: 13 } });
  const rotated = placeRustBody(kernel, model.bodies[0], rational([[12,-5,0],[5,12,0],[0,0,13]]));
  const restored = placeRustBody(kernel, rotated, rational([[12,5,0],[-5,12,0],[0,0,13]]));
  for (const body of [rotated, restored]) {
    const mesh = rustMesh(kernel, [body]);
    assert.equal(mesh.bodies.length, 1);
    const xyz = mesh.bodies[0].vertices;
    assert.equal(xyz.length, 24);
    const xs = xyz.filter((_, i) => i % 3 === 0), ys = xyz.filter((_, i) => i % 3 === 1);
    for (const [actual, expected] of body === rotated ? [[Math.min(...xs), -5000/13], [Math.max(...xs),12000/13], [Math.max(...ys),17000/13]] : [[Math.min(...xs),0], [Math.max(...xs),1000], [Math.max(...ys),1000]]) {
      assert.ok(Math.abs(actual-expected) <= 1e-12);
    }
    const stl = rustStl(kernel, [body]);
    assert.equal(stl.readUInt32LE(80), 12);
    assert.equal(stl.length, 84+12*50);
    const carriers = rustCarriers(kernel, [body]);
    assert.equal(carriers[0].faces.length, 6);
    assert.ok(carriers[0].faces.every(s => !s.refused && s.kind === 'plane'));
    const basis = body === rotated ? [[12/13,5/13,0],[-5/13,12/13,0],[0,0,1]] : [[1,0,0],[0,1,0],[0,0,1]];
    for (const face of carriers[0].faces) assert.ok(basis.some(v => [1,-1].some(sign => v.every((x,k) => Math.abs(sign*x-face.normal[k]) <= 1e-15))));
  }
  assert.throws(() => rustMesh(kernel, [rotated], 1e-15), /vertex-precision-budget/);
});

test('tiny accepted rotations report an angular bound within the accepted tolerance', () => {
  for (const value of [1e-100, -1e-100, Number.MIN_VALUE]) {
    const spec = doorSpec([value]);
    spec.joints[0].range = [-1, 1];
    spec.joints[0].rotationToleranceDegrees = value === Number.MIN_VALUE ? 1e-320 : 1e-99;
    const { report } = runMotion(doorModel, spec);
    assert.equal(report.summary.refused, 0);
    const r = report.poses[0].values.hinge.rotation;
    assert.ok(r.angularErrorUpperDegrees >= Math.abs(value));
    assert.ok(r.angularErrorUpperDegrees <= r.toleranceDegrees);
  }
});


test('exactly representable tiny angular errors may equal their accepted tolerance', () => {
  for (const value of [1e-100, -1e-100, Number.MIN_VALUE]) {
    const spec = doorSpec([value]);
    spec.joints[0].range = [-1, 1];
    spec.joints[0].rotationToleranceDegrees = Math.abs(value);
    const { report } = runMotion(doorModel, spec);
    assert.equal(report.summary.refused, 0);
    assert.equal(report.poses[0].values.hinge.rotation.angularErrorUpperDegrees, Math.abs(value));
  }
});


test('count drivers keep finite extreme ranges finite without overflowing the span or intermediate product', () => {
  for (const range of [[-Number.MAX_VALUE, Number.MAX_VALUE], [0, Number.MAX_VALUE], [-1e308, 1e308], [1e308, 1.5e308]]) {
    for (const count of [2, 3, 5, 9]) {
      const spec = sliderSpec([0]);
      spec.joints[0].range = range;
      spec.joints[0].driver = { count };
      const values = normalizeMotionSpec(spec).joints[0].samples;
      assert.equal(values[0], range[0]);
      assert.equal(values.at(-1), range[1]);
      assert.ok(values.every(Number.isFinite));
      assert.ok(values.every((v, i) => v >= range[0] && v <= range[1] && (!i || values[i - 1] <= v)));
      if (count % 2 && range[0] === -range[1]) assert.equal(values[(count - 1) / 2], 0);
    }
  }
});

test('resolved body aliases cannot bypass the one-joint-per-body contract', async () => {
  const full = doorModel.bodies.find(b => b.id.endsWith('/door')).id;
  const spec = doorSpec([90]);
  spec.joints.push({ ...spec.joints[0], id: 'alias', body: full, driver: { samples: [0] } });
  const rejects = run => assert.throws(() => run(doorModel, spec), e => e.code === 'motion/body-moved-twice');
  rejects(runMotion);
  // Removing the canonical-ID check reproduces the silent pose overwrite on
  // the same real door model. The regression assertion must detect it.
  const planted = await plantedModule('if (mover.has(id)) refuse(', 'if (false) refuse(');
  const overwritten = planted.runMotion(doorModel, spec);
  assert.equal(overwritten.report.poses[0].exactPlacement, true);
  const index = doorModel.bodies.findIndex(b => b.id === full);
  assert.equal(overwritten.posed[0][index], doorModel.bodies[index], 'the zero-angle alias silently replaced the requested 90-degree pose');
  assert.throws(() => rejects(planted.runMotion), { code: 'ERR_ASSERTION' });
  const duplicate = doorSpec([90]);
  delete duplicate.joints[0].body;
  duplicate.joints[0].bodies = ['door', full];
  assert.throws(() => runMotion(doorModel, duplicate), e => e.code === 'motion/body-moved-twice');
});
