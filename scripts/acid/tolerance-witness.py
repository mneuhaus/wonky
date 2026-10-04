# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["cadquery-ocp==8.0.1.0.0"]
# ///
"""Observe independent analytic STEP supports; optionally freeze archived OCCT evidence.

uv run --no-project <reference-venv>/bin/python scripts/acid/tolerance-witness.py inspect
    --step model.step --zone AC22 --variant V0 --out witness.json
uv run --no-project <reference-venv>/bin/python scripts/acid/tolerance-witness.py freeze
    --archive-root <historical-fix-run-directory>
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile

from measure import ROOT, export_step, physical_witness, read_step, observe

OCCT = ROOT / 'fixtures/cad-acid/occt'
TARGETS = {'AC20', 'AC22', 'AC44'}
ARCHIVE_PREFIX = 'tmp/acid/fix/run/'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def frozen_row_digests(rows):
    """Use JS number serialization, not Python's different float JSON format."""
    script = '''let text=''; process.stdin.on('data', d => text+=d);
process.stdin.on('end', () => {
 const ordered = x => Array.isArray(x) ? x.map(ordered) :
   x !== null && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k,ordered(x[k])])) : x;
 const crypto=require('node:crypto');
 console.log(JSON.stringify(JSON.parse(text).map(row => crypto.createHash('sha256')
   .update(JSON.stringify(ordered({metrics:row.metrics,stepRoundTrip:row.stepRoundTrip,
                                   nativeValidity:row.nativeValidity}))).digest('hex'))));
});'''
    proc = subprocess.run(['node', '-e', script], input=json.dumps(rows), text=True,
                          capture_output=True, check=True)
    return json.loads(proc.stdout)


def near(expected, actual, path, relative=1e-9, absolute=1e-7):
    if isinstance(expected, dict):
        if not isinstance(actual, dict) or set(expected) != set(actual):
            raise ValueError(f'OBSERVATION_DISAGREEMENT {path}: keys differ')
        for key in expected:
            near(expected[key], actual[key], f'{path}.{key}', relative, absolute)
    elif isinstance(expected, list):
        if not isinstance(actual, list) or len(expected) != len(actual):
            raise ValueError(f'OBSERVATION_DISAGREEMENT {path}: length differs')
        for index, (a, b) in enumerate(zip(expected, actual)):
            near(a, b, f'{path}[{index}]', relative, absolute)
    elif isinstance(expected, (int, float)) and not isinstance(expected, bool):
        if not isinstance(actual, (int, float)) or not math.isclose(expected, actual, rel_tol=relative, abs_tol=absolute):
            raise ValueError(f'OBSERVATION_DISAGREEMENT {path}: {expected} vs {actual}')
    elif expected != actual:
        raise ValueError(f'OBSERVATION_DISAGREEMENT {path}: {expected} vs {actual}')


def verify_stage(expected, actual, label):
    # Topology/validity are exact. Numeric drift is bounded solely for independent
    # OCCT-version re-observation, never used as a scoring tolerance.
    for field in ('topology', 'rawTopology', 'surfaceTypes', 'validity'):
        near(expected[field], actual[field], f'{label}.{field}', relative=0, absolute=0)
    for field in ('volume', 'area', 'bbox', 'localBbox', 'measurements'):
        near(expected[field], actual[field], f'{label}.{field}')
    if len(expected['bodies']) != len(actual['bodies']):
        raise ValueError(f'OBSERVATION_DISAGREEMENT {label}.bodies count')
    for index, (original, fresh) in enumerate(zip(expected['bodies'], actual['bodies'])):
        for field in ('rawTopology', 'topology', 'valid'):
            near(original[field], fresh[field], f'{label}.bodies[{index}].{field}', relative=0, absolute=0)
        for field in ('volume', 'area', 'centroid', 'bbox'):
            near(original[field], fresh[field], f'{label}.bodies[{index}].{field}')


def staged_witness(file, zone, catalog, variant, original=None):
    source = read_step(file)
    source_metrics = observe(source, zone, catalog, variant)
    stages = [('stepImport', source, source_metrics)]
    with tempfile.TemporaryDirectory(prefix='acid-witness-') as directory:
        roundtrip_file = Path(directory) / 'roundtrip.step'
        export_step(source, roundtrip_file)
        roundtrip = read_step(roundtrip_file)
        stages.append(('stepRoundTrip', roundtrip, observe(roundtrip, zone, catalog, variant)))
        if original is not None:
            verify_stage(original['stepImport'], stages[0][2], 'stepImport')
            verify_stage(original['stepRoundTrip']['metrics'], stages[0][2], 'stepRoundTrip.firstImport')
            verify_stage(original['stepRoundTrip']['secondImport']['metrics'], stages[1][2], 'stepRoundTrip.secondImport')
            if not original['stepRoundTrip']['ok'] or not original['stepRoundTrip']['secondImport']['ok']:
                raise ValueError('ORIGINAL_ROUNDTRIP_FAILED')
        return {name: physical_witness(shape, zone, catalog, variant) for name, shape, _ in stages}


def freeze(archive_root):
    catalog = json.loads((ROOT / 'fixtures/cad-acid/zones.json').read_text())
    frozen = OCCT / 'observations.json'
    observations = json.loads(frozen.read_text())
    zones = {zone['id']: zone for zone in catalog['zones']}
    # Per-zone binding: the witnessed zones must be unchanged since the frozen OCCT catalog.
    if digest(ROOT / 'fixtures/cad-acid/zones.json') != observations['zonesSha256']:
        history = ROOT / 'fixtures/cad-acid/catalog-history' / f"{observations['zonesSha256']}.json"
        if not history.is_file() or digest(history) != observations['zonesSha256']:
            raise ValueError('ZONES_CHANGED_SINCE_FREEZE')
        frozen_zones = {zone['id']: zone for zone in json.loads(history.read_text())['zones']}
        if any(json.dumps(frozen_zones.get(t), sort_keys=True) != json.dumps(zones.get(t), sort_keys=True) for t in TARGETS):
            raise ValueError('ZONES_CHANGED_SINCE_FREEZE')
    rows = [row for row in observations['rows'] if row['kernel'] == 'occt' and row['zone'] in TARGETS]
    if len(rows) != 12 or len({(r['zone'], r['variant']) for r in rows}) != 12:
        raise ValueError('INCOMPLETE_OCCT_ARCHIVE')
    observation_hashes = frozen_row_digests(rows)
    witness_rows, provenance_files = [], []
    for row, observation_hash in zip(rows, observation_hashes):
        artifact = row['artifacts']
        if not isinstance(artifact, str) or not artifact.startswith(ARCHIVE_PREFIX):
            raise ValueError(f'ARCHIVE_PATH_NOT_RECOGNIZED: {artifact}')
        archived_relative = Path(artifact.removeprefix(ARCHIVE_PREFIX))
        if '..' in archived_relative.parts or archived_relative.parts[0] not in ('occt-a', 'occt-b'):
            raise ValueError(f'ARCHIVE_PATH_UNSAFE: {artifact}')
        original = archive_root / archived_relative / 'model.step'
        if not original.is_file():
            raise FileNotFoundError(original)
        sha, size = digest(original), original.stat().st_size
        # Historical OCCT rows record no STEP digest or size, but enforce either
        # field if subsequently present; identity otherwise rests on observation agreement.
        for key in ('stepSha256', 'sourceSTEPsha256'):
            if row.get(key) is not None and row[key] != sha:
                raise ValueError(f'HISTORICAL_HASH_MISMATCH: {artifact}')
        if row.get('stepSize') is not None and row['stepSize'] != size:
            raise ValueError(f'HISTORICAL_SIZE_MISMATCH: {artifact}')
        witnesses = staged_witness(original, zones[row['zone']], catalog, row['variant'], row)
        target_relative = Path('artifacts') / archived_relative / 'model.step'
        target = OCCT / target_relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and digest(target) != sha:
            raise ValueError(f'FROZEN_ARTIFACT_CHANGED: {target_relative}')
        shutil.copyfile(original, target)
        if digest(target) != sha or target.stat().st_size != size:
            raise ValueError(f'FROZEN_COPY_MISMATCH: {target_relative}')
        native_raw = []
        for body in row['metrics']['bodies']:
            topology = body['rawTopology']
            euler = topology['vertices'] - topology['edges'] + 2 * topology['faces'] - topology['loops']
            native_raw.append({'rawTopology': topology, 'rawEuler': euler,
                               'rawGenus': (2 * topology['shells'] - euler) / 2})
        witness_rows.append({'kernel': 'occt', 'zone': row['zone'], 'variant': row['variant'],
                             'observationSha256': observation_hash, 'sourceSTEPsha256': sha,
                             'stepFile': target_relative.as_posix(),
                             'nativeRawFromFrozenObservationOnly': native_raw,
                             'witness': witnesses})
        provenance_files.append({'sourceArtifact': artifact + '/model.step',
                                 'archivePath': ('local-development-evidence
                                                 + archived_relative.as_posix() + '/model.step'),
                                 'frozenPath': target_relative.as_posix(), 'sha256': sha,
                                 'bytes': size, 'observationSha256': observation_hash,
                                 'identity': 'observation-agreement; no historical STEP hash or size'
                                 if row.get('stepSha256') is None and row.get('stepSize') is None
                                 else 'recorded hash/size verified and observation agreement'})
        print(f'{row["zone"]} {row["variant"]}: {sha} {size} bytes; original STEP observations agree', flush=True)
    witness = {'schema': 'wonky/cad-acid-tolerance-witness/1',
               'frozenObservationsSha256': digest(frozen), 'rows': witness_rows}
    provenance = {'schema': 'wonky/cad-acid-tolerance-provenance/1',
                  'frozenObservations': 'observations.json',
                  'frozenObservationsSha256': digest(frozen),
                  'method': 'Unmodified archived STEP bytes; independent analytic support and raw Euler witness, original STEP import and round-trip observations checked per file; not proof of historical byte identity where no historical digest exists.',
                  'limitations': 'Native raw genus is calculated from frozen per-body rawTopology only, not independently observed native BRep. AC44 sub-resolution positive gap is not certified (in V1 local cylinder axes coincide under OCCT tolerance); this witness proves two valid cylinders, not a preserved E9 gap. AC20 quartic C1 continuity remains pending, not upgraded by this witness.',
                  'files': provenance_files}
    witness_file, provenance_file = OCCT / 'tolerance-witness.json', OCCT / 'tolerance-provenance.json'
    witness_file.write_text(json.dumps(witness, indent=2, allow_nan=False) + '\n')
    provenance_file.write_text(json.dumps(provenance, indent=2, allow_nan=False) + '\n')
    paths = [witness_file, provenance_file, *(OCCT / row['stepFile'] for row in witness_rows)]
    (OCCT / 'tolerance-SHA256SUMS').write_text(''.join(
        f'{digest(path)}  {path.relative_to(OCCT).as_posix()}\n' for path in paths))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    inspect = commands.add_parser('inspect')
    for option in ('step', 'zone', 'variant', 'out'):
        inspect.add_argument('--' + option, required=True)
    freezing = commands.add_parser('freeze')
    freezing.add_argument('--archive-root', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'freeze':
        freeze(args.archive_root)
    else:
        catalog = json.loads((ROOT / 'fixtures/cad-acid/zones.json').read_text())
        zone = next(z for z in catalog['zones'] if z['id'] == args.zone)
        result = {'schema': 'wonky/cad-acid-physical-witness/1',
                  'sourceSTEPsha256': digest(Path(args.step)),
                  'witness': staged_witness(Path(args.step), zone, catalog, args.variant)}
        Path(args.out).write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')


if __name__ == '__main__':
    main()
