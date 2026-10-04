"""Sequential warm build123d benchmark worker; invoke ONLY through uv run.

Imports happen once outside samples. observe() is measure.py's in-memory
observation, NOT its STEP import/export/reimport CLI validation pipeline.
"""
import hashlib
import importlib.metadata
import importlib.util
import json
from pathlib import Path
import re
import resource
import sys
from time import perf_counter_ns, process_time_ns
import os
import socket
import traceback

from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_Compound
from measure import observe, export_step


def elapsed_ms(start):
    return (perf_counter_ns() - start) / 1_000_000


def main():
    req = json.loads(Path(sys.argv[1]).read_text())
    source = Path(req['source'])
    if req.get('sourceSha256') and hashlib.sha256(source.read_bytes()).hexdigest() != req['sourceSha256']:
        raise ValueError('SOURCE_CHANGED_DURING_RUN')
    sys.path.insert(0, str(source.parent))
    spec = importlib.util.spec_from_file_location(source.stem, source)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    catalog = json.loads(Path(req['catalog']).read_text())
    zone = next(z for z in catalog['zones'] if z['id'] == req['zone'])
    if hasattr(module, 'build'):
        build = lambda: module.build(req['variant'], zone=req['zone'])
    elif hasattr(module, 'build_zone'):
        build = lambda: module.build_zone(req['zone'], req['variant'])
    elif req['zone'] in getattr(module, 'BUILDERS', {}):
        build = lambda: module.BUILDERS[req['zone']](req['variant'])
    else:
        raise TypeError('TWIN_CONTRACT: no isolated zone entrypoint')

    live = req.get('livePerf', False)
    context = {'host': socket.gethostname(), 'logicalCpus': os.cpu_count(), 'load1': os.getloadavg()[0],
               'parallelCells': req.get('jobs'), 'slotCount': int(os.environ['WONKY_HOST_SLOTS']) if os.environ.get('WONKY_HOST_SLOTS') else None,
               'addonWarm': None}
    samples = []
    warmup = None
    for i in range(0 if live else -1, req['reps']):
        start = perf_counter_ns()
        cpu_start = process_time_ns()
        built = build()
        twin_call_ms = elapsed_ms(start)
        if hasattr(built, 'solids'):
            built = list(built.solids())
        labelled = [(item[0], item[1]) if isinstance(item, tuple) and len(item) == 2
                    else (item.label, item) for item in built]
        builder = BRep_Builder()
        shape = TopoDS_Compound()
        builder.MakeCompound(shape)
        for label, solid in labelled:
            match = re.match(r'^AC\d{2,}(?=_|$)', label)
            if not match or match[0] != req['zone']:
                raise ValueError(f'BODY_ATTRIBUTION: {label}')
            builder.Add(shape, solid.wrapped)
        construction_ms = elapsed_ms(start)
        construction_cpu_ms = (process_time_ns() - cpu_start) / 1e6

        start = perf_counter_ns()
        cpu_start = process_time_ns()
        metrics = observe(shape, zone, catalog, req['variant'])
        measurement_ms = elapsed_ms(start)
        measurement_cpu_ms = (process_time_ns() - cpu_start) / 1e6
        if not all(metrics['validity'].values()):
            raise ValueError('TIMED_OCCT_OBSERVATION_INVALID')
        step = Path(req['out']) / 'model.step'
        start = perf_counter_ns()
        cpu_start = process_time_ns()
        export_step(shape, step)
        export_ms = elapsed_ms(start)
        export_cpu_ms = (process_time_ns() - cpu_start) / 1e6
        peak_bytes = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        if sys.platform != 'darwin':
            peak_bytes *= 1024
        sample = {
            'observation': metrics,
            'constructionCpuMs': construction_cpu_ms, 'measurementCpuMs': measurement_cpu_ms, 'exportCpuMs': export_cpu_ms,
            'constructionMs': construction_ms, 'twinCallMs': twin_call_ms,
            'measurementMs': measurement_ms, 'exportMs': export_ms,
            'warmPipelineMs': construction_ms + measurement_ms + export_ms,
            'nativeBoundaryMs': None, 'kernelOnlyMs': None,
            'peakRssMiB': peak_bytes / (1024 * 1024),
            'bodies': len(metrics['bodies']), 'volume': metrics['volume'],
            'stepBytes': step.stat().st_size,
        }
        if i < 0:
            warmup = sample
        else:
            samples.append(sample)
        # Loop variables retain the last native shape even after its list is dropped.
        if labelled:
            del solid
        # Release this iteration before the next construction timer starts.
        del built, labelled, shape, builder, metrics
    Path(req['result']).write_text(json.dumps({
        'kernel': 'occt', 'python': sys.version, 'context': context, 'outcome': 'built',
        'versions': {p: importlib.metadata.version(p) for p in ('build123d', 'cadquery-ocp')},
        'warmup': warmup, 'samples': samples,
    }, indent=2, allow_nan=False) + '\n')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        req = json.loads(Path(sys.argv[1]).read_text())
        if not req.get('livePerf'):
            raise
        traceback.print_exc()
        Path(req['result']).write_text(json.dumps({'outcome': 'refused' if isinstance(exc, NotImplementedError) else 'error',
            'error': {'name': type(exc).__name__, 'message': str(exc)}, 'samples': [],
            'context': {'host': socket.gethostname(), 'load1': os.getloadavg()[0], 'logicalCpus': os.cpu_count(),
                        'parallelCells': req.get('jobs'), 'slotCount': int(os.environ['WONKY_HOST_SLOTS']) if os.environ.get('WONKY_HOST_SLOTS') else None}}) + '\n')
