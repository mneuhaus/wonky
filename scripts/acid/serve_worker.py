"""Warm worker loop for the CAD-Acid STEP round-trip checks (measure.py,
validate-step.py). One long-lived interpreter with OCP loaded replaces one
uv/Python/OCP process per cell; each request runs the script's unchanged CLI
entry point with the given argv and is answered with what a fresh process
would have produced: exit status, stdout and stderr (captured at the file
descriptor level, so OpenCascade's native output is included as before).

Protocol: one JSON object per line on stdin, {"id", "argv", "perfFile"?};
one JSON line per answer on the original stdout, {"id", "status", "stdout",
"stderr", "maxRssBytes"}. The first answer line is {"ready": true, "pid"}.
EOF on stdin ends the worker. A crash or hang is detected by the caller
(scripts/acid/roundtrip-worker.mjs), never answered here.
"""
import ctypes
import faulthandler
import gc
import json
import os
import resource
import sys
import tempfile
import traceback
from time import perf_counter_ns

_libc = ctypes.CDLL(None)


def _flush():
    sys.stdout.flush()
    sys.stderr.flush()
    _libc.fflush(None)


def _status(code):
    # Mirrors the interpreter's own SystemExit handling.
    if code is None:
        return 0
    if isinstance(code, int):
        return code & 0xff
    print(code, file=sys.stderr)
    return 1


def _timing(file, start, cpu_start, overhead_ns):
    end_start = perf_counter_ns()
    usage = resource.getrusage(resource.RUSAGE_SELF)
    data = {'wallMs': (end_start - start) / 1e6,
            'cpuMs': (usage.ru_utime + usage.ru_stime) * 1000 - cpu_start,
            'cpuScope': 'warm Python observer worker, this request only, including native threads; excludes interpreter startup and uv launcher',
            'timingOverheadMs': overhead_ns / 1e6}
    data['timingOverheadMs'] += (perf_counter_ns() - end_start) / 1e6
    with open(file, 'w') as f:
        f.write(json.dumps(data) + '\n')


def serve(program, entry):
    """Answer requests on stdin by running entry() with sys.argv = [program, *argv]."""
    channel = os.fdopen(os.dup(1), 'w', buffering=1)
    # A native crash inside a request reaches the caller's diagnostics, not
    # the request's captured stderr, which dies with the process.
    crash_log = os.fdopen(os.dup(2), 'w')
    faulthandler.enable(file=crash_log)
    channel.write(json.dumps({'ready': True, 'pid': os.getpid()}) + '\n')
    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        setup_start = perf_counter_ns()
        usage = resource.getrusage(resource.RUSAGE_SELF)
        cpu_start = (usage.ru_utime + usage.ru_stime) * 1000
        _flush()
        saved = os.dup(1), os.dup(2)
        with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
            os.dup2(out.fileno(), 1)
            os.dup2(err.fileno(), 2)
            start = perf_counter_ns()
            overhead_ns = start - setup_start
            sys.argv = [program, *request['argv']]
            try:
                entry()
                status = 0
            except SystemExit as exit:
                status = _status(exit.code)
            except BaseException:
                traceback.print_exc()
                status = 1
            _flush()
            stop = perf_counter_ns()
            os.dup2(saved[0], 1)
            os.dup2(saved[1], 2)
            os.close(saved[0])
            os.close(saved[1])
            out.seek(0)
            err.seek(0)
            answer = {'id': request['id'], 'status': status,
                      'stdout': out.read().decode('utf-8', 'replace'),
                      'stderr': err.read().decode('utf-8', 'replace')}
        if request.get('perfFile'):
            _timing(request['perfFile'], start, cpu_start, overhead_ns + perf_counter_ns() - stop)
        gc.collect()
        answer['maxRssBytes'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        channel.write(json.dumps(answer) + '\n')
