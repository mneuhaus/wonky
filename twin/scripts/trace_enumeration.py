"""Trace actual comports calls in the frozen backend without replacing them.

This diagnostic is NOT timing evidence (the profiler adds overhead). Exit 1
means USB enumeration occurred, 2 means inconclusive, 0 means no calls from
cold start through startup completion plus a full 10 s inventory interval.
Neither backend source nor callables are changed. runpy executes main.py.
"""
import os
import select
import signal
import subprocess
import time

from wonky_twin.backend import BACKEND, backend_port_available, prepare_backend, thermal_ready
from wonky_twin.runtime import Twin

PROFILE = '''import os, runpy, sys, threading
sys.path.insert(0, {backend!r})
sys.argv = [{main!r}]
def observe(frame, event, arg):
    if event == "return" and frame.f_code.co_name == "setHardwareResetFn" and frame.f_code.co_filename == {shared_state!r}:
        print("BACKEND_STARTUP_COMPLETE", flush=True)
    if event == "call" and frame.f_code.co_name == "comports":
        callers = []
        caller = frame.f_back
        while caller is not None and len(callers) < 5:
            callers.append(caller.f_code.co_filename + ":" + str(caller.f_lineno) + " " + caller.f_code.co_name)
            caller = caller.f_back
        print("USB_ENUMERATION " + repr({{"file": frame.f_code.co_filename, "callers": callers,
              "SORTER_MCU_PORTS": os.environ.get("SORTER_MCU_PORTS"),
              "LEGOSORTER_DISABLE": os.environ.get("LEGOSORTER_DISABLE")}}), flush=True)
sys.setprofile(observe)
threading.setprofile(observe)
runpy.run_path({main!r}, run_name="__main__")
'''


def main():
    thermal_ready()
    backend_port_available()
    observed, complete = False, False
    with Twin() as twin:
        ports = [endpoint.path for endpoint in twin.endpoints.values()]
        state, profile, env = prepare_backend(ports, "enumeration-" + twin.clock.epoch)
        code = PROFILE.format(backend=str(BACKEND), main=str(BACKEND / "main.py"),
                              shared_state=str(BACKEND / "server/shared_state.py"))
        with subprocess.Popen(["sandbox-exec", "-f", str(profile), "uv", "run", "--project", str(BACKEND),
                               "--no-sync", "--offline", "python", "-c", code], cwd=state, env=env,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True) as process:
            output, ready_at = "", None
            try:
                deadline = time.monotonic() + 60
                while time.monotonic() < deadline and process.poll() is None:
                    if select.select([process.stdout], [], [], .2)[0]:
                        text = os.read(process.stdout.fileno(), 65536).decode(errors="replace")
                        print(text, end="", flush=True)
                        output += text
                        if "USB_ENUMERATION " in output:
                            observed = True
                            break
                        if ready_at is None and "BACKEND_STARTUP_COMPLETE" in output:
                            ready_at = time.monotonic()
                    if ready_at is not None and time.monotonic() - ready_at >= 12:
                        complete = True
                        break
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                try:
                    remaining, _ = process.communicate(timeout=12)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    remaining, _ = process.communicate(timeout=5)
                text = remaining.decode(errors="replace")
                print(text, end="", flush=True)
                observed |= "USB_ENUMERATION " in output + text
                print(f"Owned backend group {process.pid} reaped; exit={process.returncode}", flush=True)
    status = "FAILED" if observed else "OBSERVED_NO_CALLS" if complete else "INCONCLUSIVE"
    print("GLOBAL_NO_USB_ENUMERATION: " + status, flush=True)
    raise SystemExit(1 if observed else 0 if complete else 2)


if __name__ == "__main__":
    main()
