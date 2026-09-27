// Artifact consistency checks. Only live execution (run.mjs) admits wonky rows.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync, execFileSync} from 'node:child_process';
import {ROOT, CATALOG, sha256, readJSON} from './common.mjs';
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);

export function codeIdentity(root = ROOT) {
  // Hash actual tracked + untracked source bytes, including dirty/deleted files.
  // Not git diff alone (which omits untracked files), nor HEAD (which omits dirt).
  // Include all scripts conservatively: validate-step.py and transitive R20
  // imports execute outside scripts/acid/ and can change live admission.
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'rust/', 'src/', 'scripts/'], {cwd:root, encoding:'utf8'}).split('\0').filter(Boolean);
  const entries = [...new Set(files)].sort().map(file => {
    const target = path.join(root, file);
    if (!fs.existsSync(target)) return [file, 'deleted'];
    const st = fs.lstatSync(target);
    return [file, st.mode & 0o111, sha256(st.isSymbolicLink() ? fs.readlinkSync(target) : fs.readFileSync(target))];
  });
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {cwd:root, encoding:'utf8'});
  return {head:head.status === 0 ? head.stdout.trim() : null, treeSha256:sha256(canonical(entries))};
}

export function artifactHashes(dir) {
  return Object.fromEntries(['request.json', 'build.json', 'model.brep.json', 'model.step', 'measure.json']
    .filter(file => fs.existsSync(path.join(dir, file)) && fs.statSync(path.join(dir, file)).isFile())
    .map(file => [file, sha256(fs.readFileSync(path.join(dir, file)))]));
}

export function observationProbes(zone) {
  const definitions = [...(zone.closedForm.measurements ?? []), ...zone.expected.outcomes.flatMap(o => typeof o.closedForm === 'object' ? o.closedForm.measurements ?? [] : [])];
  return [...new Map(definitions.map(m => [m.name, m])).values()];
}

// Selector probes are native observations too; bbox extents have no point probes.
export function observationPoints(zone) {
  return observationProbes(zone).flatMap(({name,definition:d}) =>
    d.kind === 'probeDistance' ? [{name,point:d.point}] :
    d.kind === 'bodyDistance' ? [{name:name+'-a',point:d.bodyA},{name:name+'-b',point:d.bodyB}] : []);
}

export function verifyExactObservation(zone, row, {artifactRoot = ROOT, code = null} = {}) {
  const fail = reason => ({ok:false, reason:`EXACT_OBSERVATION_UNVERIFIED: ${reason}`});
  const native = row.nativeObservation;
  if (row.metrics?.basis !== 'native-f64-construction' || !native || !hash(row.backend?.sourceHash) || native.sourceHash !== row.backend.sourceHash)
    return fail('native observation/backend sourceHash binding missing');
  if (!Array.isArray(native.bodies) || native.bodies.some(b => b?.boundToConstruction !== true))
    return fail('every native body must be bound to construction');
  const definitions = observationProbes(zone), probes = observationPoints(zone);
  for (const body of native.bodies) {
    if (!Array.isArray(body.probes) || body.probes.length !== probes.length || new Set(body.probes.map(p => p?.name)).size !== probes.length)
      return fail('incomplete native probe coverage');
    for (const probe of probes) {
      const response = body.probes.find(p => p?.name === probe.name);
      if (!response || response.refused || typeof response.inside !== 'boolean' || !Number.isFinite(response.distanceMm) || response.distanceMm < 0)
        return fail(`native response missing for probe ${probe.name}`);
    }
  }
  if (typeof row.artifacts !== 'string') return fail('artifact location missing');
  const dir = path.resolve(artifactRoot, row.artifacts), hashes = row.artifactHashes;
  for (const name of ['request.json', 'build.json', 'model.brep.json', 'model.step', 'measure.json'])
    if (!hash(hashes?.[name])) return fail(`artifact hash missing: ${name}`);
  try {
    for (const [name, expected] of Object.entries(hashes)) {
      if (path.basename(name) !== name || !hash(expected)) return fail('invalid artifact manifest');
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) return fail(`artifact unavailable: ${name}`);
      if (sha256(fs.readFileSync(file)) !== expected) return fail(`artifact hash mismatch: ${name}`);
    }
    const brep = readJSON(path.join(dir, 'model.brep.json')), build = readJSON(path.join(dir, 'build.json'));
    const request = readJSON(path.join(dir, 'request.json')), measured = readJSON(path.join(dir, 'measure.json'));
    if (code && (!hash(code.treeSha256) || row.code?.treeSha256 !== code.treeSha256)) return fail('row/run code identity mismatch');
    if (request.zone !== zone.id || request.variant !== row.variant || request.sourceSha256 !== build.stamp?.sourceSha256 || request.zonesSha256 !== build.stamp?.zonesSha256 || request.zonesSha256 !== sha256(fs.readFileSync(CATALOG)))
      return fail('request/build provenance mismatch');
    const source = path.resolve(ROOT, build.stamp?.source ?? '');
    if (!hash(request.sourceSha256) || sha256(fs.readFileSync(source)) !== request.sourceSha256) return fail('twin source hash mismatch');
    if (row.nativeValidity !== build.nativeValidity) return fail('native validity differs from hashed build');
    if (measured.stepSha256 !== hashes['model.step'] || row.stepSha256 !== hashes['model.step']) return fail('STEP observer hash mismatch');
    if (canonical(row.stepRoundTrip) !== canonical(measured.stepRoundTrip)) return fail('STEP observation differs from hashed artifact');
    if (canonical(native) !== canonical(build.nativeObservation) || row.backend.sourceHash !== build.backend?.sourceHash || row.backend.sourceHash !== brep.backend?.sourceHash)
      return fail('native observation differs from hashed construction');
    const matches = bodies => Array.isArray(bodies) && bodies.length === native.bodies.length && bodies.every((b, i) => b.id === native.bodies[i].id);
    if (!matches(brep.bodies) || !matches(build.bodies) || !matches(row.bodies) || (row.nativeBodies && !matches(row.nativeBodies)) || new Set(native.bodies.map(b => b.id)).size !== native.bodies.length ||
        native.bodies.some((b, i) => !hash(b.wc0Sha256) || b.wc0Sha256 !== brep.bodies[i].wc0Sha256) || row.metrics.bodies?.length !== native.bodies.length || row.metrics.topology?.bodies !== native.bodies.length)
      return fail('incomplete native body coverage or WC0 binding mismatch');
    const {nativeBodyCount, ...metrics} = row.metrics;
    if (canonical(metrics) !== canonical(native.metrics)) return fail('scored metrics differ from native observation');
    for (const {name,definition:d} of definitions) {
      let value;
      const evidence = native.measurementEvidence?.[name];
      if (d.kind === 'probeDistance') {
        const responses = native.bodies.map(b => b.probes.find(r => r.name === name));
        value = responses.some(r => r.inside) ? 0 : Math.min(...responses.map(r => r.distanceMm));
      } else if (d.kind === 'bodyDistance') {
        const a = native.bodies.filter(b => b.probes.find(p => p.name === name+'-a')?.inside);
        const b = native.bodies.filter(b => b.probes.find(p => p.name === name+'-b')?.inside);
        // A decided wrong selector is observed geometry, not missing evidence.
        // Preserve it for the scorer to reject the missing mandatory measurement.
        if (a.length !== 1 || b.length !== 1) {
          if (Object.hasOwn(native.metrics.measurements ?? {}, name) || evidence ||
              native.metrics.measurementErrors?.[name] !== 'bodyDistance selector must identify one solid')
            return fail(`unbound native selector ${name}`);
          continue;
        }
        if (evidence?.kind !== d.kind || evidence.bodyA !== a[0].id || evidence.bodyB !== b[0].id ||
            !Number.isFinite(evidence.boundMm) || evidence.boundMm < 0 || evidence.distanceMm < 0)
          return fail(`unbound native distance ${name}`);
        value = evidence.distanceMm;
      } else if (d.kind === 'bboxExtent') {
        const axis = ['local x','local y','local z'].indexOf(d.axis);
        if (axis < 0 || native.bodies.length !== 1 || evidence?.kind !== d.kind || evidence.body !== native.bodies[0].id ||
            evidence.axis !== axis || !Array.isArray(evidence.extentsMm) || evidence.extentsMm.length !== 3 ||
            evidence.extentsMm.some(x => !Number.isFinite(x) || x <= 0)) return fail(`unbound native extent ${name}`);
        value = evidence.extentsMm[axis];
      } else return fail(`unsupported native measurement ${d.kind}`);
      if (!Number.isFinite(value) || native.metrics.measurements?.[name] !== value) return fail(`unbound native measurement ${name}`);
    }
    return {ok:true};
  } catch (error) { return fail(`artifacts unreadable: ${error.message}`); }
}
