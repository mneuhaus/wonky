"""Isolated build123d twin runner. Run only with uv and the reference venv."""
import hashlib
import importlib.metadata
import importlib.util
import json
import re
from pathlib import Path
import sys
import traceback

from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_Compound
from measure import observe, measure, export_step


def main():
    req = json.loads(Path(sys.argv[1]).read_text())
    out = Path(req['out'])
    out.mkdir(parents=True,exist_ok=True)
    result = {}
    stage = 'build'
    try:
        source = Path(req['source'])
        if hashlib.sha256(source.read_bytes()).hexdigest()!=req['sourceSha256']:
            raise ValueError('SOURCE_CHANGED_DURING_RUN')
        sys.path.insert(0,str(source.parent))
        spec = importlib.util.spec_from_file_location(source.stem,source)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module  # dataclass forward references need the actual module
        spec.loader.exec_module(module)
        if hasattr(module,'build'):
            built = module.build(req['variant'],zone=req['zone'])
            entrypoint = 'build'
        elif req['zone']=='ALL' and hasattr(module,'build_group'):
            built = module.build_group(req['variant'])
            entrypoint = 'build_group'
        elif hasattr(module,'build_zone'):
            built = module.build_zone(req['zone'],req['variant'])
            entrypoint = 'build_zone'
        elif req['zone'] in getattr(module,'BUILDERS',{}):
            built = module.BUILDERS[req['zone']](req['variant'])
            entrypoint = 'BUILDERS[zone]'
        else:
            raise TypeError('TWIN_CONTRACT: no isolated zone entrypoint')
        if hasattr(built,'solids'):
            built = list(built.solids())
        labelled = [(item[0],item[1]) if isinstance(item,tuple) and len(item)==2 else (item.label,item) for item in built]
        for label,solid in labelled:
            if req['zone']!='ALL' and (not re.match(r'^AC\d{2,}(?=_|$)', label) or re.match(r'^AC\d{2,}(?=_|$)', label)[0]!=req['zone']):
                raise ValueError(f'BODY_ATTRIBUTION: expected {req["zone"]}, got {label}')
            if not hasattr(solid,'wrapped'):
                raise TypeError('TWIN_CONTRACT: a labelled body is not a build123d shape')
        builder = BRep_Builder()
        shape = TopoDS_Compound()
        builder.MakeCompound(shape)
        for _,solid in labelled:
            builder.Add(shape,solid.wrapped)
        cat = json.loads(Path(req['catalog']).read_text())
        result = {'outcome':'built','versions':{p:importlib.metadata.version(p) for p in ('build123d','cadquery-ocp')},'nativeValidity':all(s.is_valid for _,s in labelled),'labels':[n for n,_ in labelled],'entrypoint':entrypoint,
                  'stamp':{'zonesSha256':req['zonesSha256'],'sourceSha256':req['sourceSha256'],'variant':req['variant'],'zone':req['zone']}}
        stage = 'observe'
        if req['zone']!='ALL':
            zone = next(z for z in cat['zones'] if z['id']==req['zone'])
            result['metrics'] = observe(shape,zone,cat,req['variant'])
        stage = 'export'
        export_step(shape,out/'model.step')
        if req['zone']!='ALL':
            measured = measure(out/'model.step',zone,cat,req['variant'])
            result['stepImport'] = measured['metrics']
            result['stepRoundTrip'] = {'ok':True,'metrics':measured['metrics'],'secondImport':measured['stepRoundTrip']}
    except Exception as exc:
        traceback.print_exc()
        capability = type(exc).__name__ in ('NotImplementedError','UnsupportedFeatureError','NativeCapabilityError')
        named = capability or bool(getattr(exc,'refusal_category',None))
        # If geometry was returned and its export is broken, retain the built claim
        # so the scorer can report WRONG/validity, not hide it behind ERROR.
        if result.get('outcome')=='built' and stage=='export':
            result['stepRoundTrip'] = {'ok':False,'reason':f'{type(exc).__name__}: {exc}'}
        else:
            result = {'outcome':'refused' if named else 'error','stage':stage,'error':{'name':type(exc).__name__,'message':str(exc)},'builtBeforeFailure':result.get('outcome')=='built'}
            if named:
                result['refusal'] = {'name':type(exc).__name__,'category':getattr(exc,'refusal_category','capability'),
                                     'capability':capability,'operationUnderTest':stage=='build' and getattr(exc,'operation_under_test',False) is True}
    (out/'build.json').write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')

if __name__=='__main__':
    main()
