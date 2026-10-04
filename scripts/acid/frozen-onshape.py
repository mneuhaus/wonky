"""Offline reader of the push script's immutable raw Onshape freeze. Never HTTP.

Caller MUST check SHA256SUMS, zones SHA and all source SHAs before invocation
and pass the capture's active (zone, variant) keys (per-zone binding): only those
rows are observed. Group membership of an ALL feature comes from the capture's
own catalog copy (inputs/zones.json); observation uses the current catalog.
One Part Studio per variant holds every group feature, so parts, mass
properties and the STEP file are shared by the feature states of a variant.
STEP solids are attributed to zones by the solid name Onshape writes
(MANIFOLD_SOLID_BREP('<part name>')), never by list order. Without a material
Onshape reports no centroid, so native and STEP bodies are paired per zone by
volume only.

Volume basis: Onshape's REST mass properties are an estimate with declared
[min, max] bounds (up to 4e-2 relative on the AC07 helix sweep, 2.7e-3 on the
AC19 Steinmetz solid, 1e-14 on planar bodies). The scored volume is the OCCT
volume of the exported B-rep, admitted only if every body lies inside
Onshape's own bounds; the native value and bounds are kept in the row.
"""
import json
from pathlib import Path
import re
import sys
import tempfile
from OCP.BRep import BRep_Builder
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.TopoDS import TopoDS_Compound
from OCP.TopAbs import TopAbs_SOLID
from measure import entities, observe, measure, export_step, props

ZONE_NAME = re.compile(r'^(AC\d{2,})(?=_|\s|$)')


def compound(solids):
    builder = BRep_Builder()
    shape = TopoDS_Compound()
    builder.MakeCompound(shape)
    for solid in solids:
        builder.Add(shape,solid)
    return shape


def mass_values(payload, part_id):
    body = payload.get('bodies',{}).get(part_id)
    if not body:
        raise ValueError(f'ONSHAPE_MASS_BODY_MISSING: {part_id}')
    # REST massproperties uncertainty triples are value/min/max, not min/mean/max.
    value, low, high = (x*1e9 for x in body['volume'])
    if not low <= value <= high:
        raise ValueError(f'ONSHAPE_MASS_TRIPLE_UNEXPECTED: {part_id}')
    return value, low, high


def named_solids(file):
    reader = STEPControl_Reader()
    if reader.ReadFile(str(file)) != IFSelect_RetDone or reader.TransferRoots() < 1:
        raise ValueError(f'STEP_IMPORT_FAILED: {file}')
    transfer = reader.WS().TransferReader()
    result = []
    for solid in entities(reader.OneShape(), TopAbs_SOLID):
        entity = transfer.EntityFromShapeResult(solid, 1)
        name = entity.Name().ToCString() if entity is not None and hasattr(entity,'Name') else ''
        zone = ZONE_NAME.match(name)
        if not zone:
            raise ValueError(f'ONSHAPE_STEP_BODY_UNNAMED: {name!r} in {file}')
        result.append({'zone':zone[1],'name':name,'solid':solid,'volume':props(solid)['volume']})
    return result


def plain(value):
    """Decode a BTFSValue tree (FS evaluation result) to plain JSON."""
    if not isinstance(value, dict):
        return value
    kind = value.get('btType','')
    if kind.endswith('BTFSValueMap'):
        return {plain(e['key']):plain(e['value']) for e in value['value']}
    if kind.endswith('BTFSValueArray'):
        return [plain(x) for x in value['value']]
    if 'value' in value:
        return f"{value['typeTag']}.{value['value']}" if value.get('typeTag') else value['value']
    return value


def main():
    directory, catalog_file, output = map(Path,sys.argv[1:4])
    active = set(json.loads(Path(sys.argv[4]).read_text())) if len(sys.argv) > 4 else None
    cat = json.loads(catalog_file.read_text())
    provenance = json.loads((directory/'provenance.json').read_text())
    frozen_catalog = directory/'inputs/zones.json'
    captured = json.loads(frozen_catalog.read_text()) if frozen_catalog.is_file() else cat
    zones = {z['id']:z for z in cat['zones']}
    groups = {g['id']:g for g in captured['groups']}
    wanted = lambda zid, variant: active is None or f'{zid}/{variant}' in active
    errors = {}
    for studio in provenance.get('partStudios',[]):
        if studio.get('featureErrors'):
            errors.update(plain(json.loads((directory/studio['featureErrors']).read_text())['result']))
    steps, claimed, rows = {}, {}, []
    for state in provenance['studios']:
        ids = groups[state['group']]['zoneIds'] if state['zone']=='ALL' else [state['zone']]
        if state['featureStatus']!='OK':
            # Failed group rows are superseded by isolated fallback observations.
            if state['zone']!='ALL' and wanted(state['zone'],state['variant']):
                enum = (errors.get(state['featureId']) or {}).get('error')
                rows.append({'kernel':'onshape','zone':state['zone'],'variant':state['variant'],'outcome':'error','onshapeError':enum,
                             'reason':f'ONSHAPE_FEATURE_STATUS_{state["featureStatus"]} ({enum}): no predeclared mapping from Onshape errors to refusal categories'})
            continue
        for zid in ids:
            if claimed.setdefault((state['element'],zid),state['featureId'])!=state['featureId']:
                raise ValueError(f'ONSHAPE_ZONE_CLAIMED_TWICE: {zid} in {state["element"]}')
        parts = json.loads((directory/state['parts']).read_text())
        if state['step'] not in steps:
            steps[state['step']] = named_solids(directory/state['step'])
            if len(steps[state['step']])!=sum(p.get('bodyType')=='solid' for p in parts):
                raise ValueError('ONSHAPE_STEP_BODY_COUNT_MISMATCH')
        for zid in ids:
            if not wanted(zid,state['variant']):
                continue
            z = zones[zid]
            native = []
            for part in parts:
                name = ZONE_NAME.match(part['name'])
                if not name:
                    raise ValueError(f'ONSHAPE_BODY_ATTRIBUTION: {part["name"]}')
                if name[1]==zid:
                    value,low,high = mass_values(json.loads((directory/state['mass'][part['partId']]).read_text()),part['partId'])
                    native.append({'value':value,'min':low,'max':high,'part':part})
            solids = [s for s in steps[state['step']] if s['zone']==zid]
            if len(native)!=len(solids):
                raise ValueError(f'ONSHAPE_STEP_BODY_COUNT_MISMATCH: {zid} {state["variant"]}')
            native.sort(key=lambda n:n['value'])
            solids.sort(key=lambda s:s['volume'])
            for n,s in zip(native,solids):
                if not n['min']<=s['volume']<=n['max']:
                    raise ValueError(f'ONSHAPE_STEP_BODY_MATCH_FAILED: {zid} {state["variant"]} STEP volume {s["volume"]} outside Onshape [{n["min"]}, {n["max"]}]')
            shape = compound([s['solid'] for s in solids])
            row = {'kernel':'onshape','zone':zid,'variant':state['variant'],'outcome':'built',
                   'nativeValidity':all(n['part'].get('bodyType')=='solid' for n in native),
                   'nativeVolume':{'value':sum(n['value'] for n in native),'min':sum(n['min'] for n in native),'max':sum(n['max'] for n in native),
                                   'basis':'Onshape REST massproperties value/min/max; scored volume is the OCCT volume of the exported B-rep inside these bounds'},
                   'source':{'element':state['element'],'featureId':state['featureId'],'featureZone':state['zone'],'microversion':state['microversion'],'step':state['step']}}
            row['metrics'] = observe(shape,z,cat,state['variant'],reference_surface_semantics=True)
            with tempfile.TemporaryDirectory(prefix='acid-onshape-') as tmp:
                step = Path(tmp)/'zone.step'
                export_step(shape,step)
                measured = measure(step,z,cat,state['variant'],reference_surface_semantics=True)
                row['stepRoundTrip'] = {'ok':True,'metrics':measured['metrics'],'secondImport':measured['stepRoundTrip']}
            rows.append(row)
    output.write_text(json.dumps({'zonesSha256':provenance['zonesSha256'],'rows':rows},indent=2,allow_nan=False)+'\n')

if __name__=='__main__':
    main()
