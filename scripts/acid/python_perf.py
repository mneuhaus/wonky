"""Optional diagnostics in the existing observer process; no command/exit changes."""
from time import perf_counter_ns
_import_start = perf_counter_ns()
import atexit
import json
import resource
from pathlib import Path

_import_ms = (perf_counter_ns() - _import_start) / 1e6

def start_timing(file):
    start = perf_counter_ns()
    def finish():
        end_start = perf_counter_ns()
        usage = resource.getrusage(resource.RUSAGE_SELF)
        data = {'wallMs': (end_start - start) / 1e6,
                'cpuMs': (usage.ru_utime + usage.ru_stime) * 1000,
                'cpuScope': 'Python observer process, including interpreter startup and native threads; excludes uv launcher',
                'timingOverheadMs': _import_ms}
        data['timingOverheadMs'] += (perf_counter_ns() - end_start) / 1e6
        Path(file).write_text(json.dumps(data) + '\n')
    atexit.register(finish)
