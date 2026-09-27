"""Live launch contracts against the frozen, sandboxed Sorter, not a stub.

D4: the API workflow must keep every 1 ms deadline, including cold startup.
The transcript tests exercise commands but never the heavyweight backend.
D5: a profiler observes real comports calls during full backend startup,
including background inventory. An lsof snapshot cannot detect enumeration.
D6: another listener on 8000 must survive while the backend chooses a free
port. This is a launch/ownership contract, absent from wire-level coverage.
No timing mock, backend rewrite or test-only production hook is used. D5/D6
retain their strict upstream-blocker xfails; D4 deadline failures stay failures.
Run explicitly with pytest tests/test_live_backend.py.
"""
from pathlib import Path as _PublicPath
import pytest as _public_pytest
if not (_PublicPath(__file__).resolve().parents[1] / "fixtures/r20.json").is_file():
    _public_pytest.skip("local-only R20 fixtures", allow_module_level=True)

from contextlib import contextmanager
import json
import pytest
from pathlib import Path
import os
import signal
import socket
import subprocess
import time
import urllib.request

from wonky_twin.backend import thermal_ready

PROJECT = Path(__file__).resolve().parents[1]
EVIDENCE = PROJECT / "evidence/fix-round2"


@contextmanager
def launch(name):
    thermal_ready()
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    path = EVIDENCE / f"{name}-launch.txt"
    with path.open("w") as output:
        process = subprocess.Popen(
            ["uv", "run", "--project", str(PROJECT), "--offline", "wonky-twin", "up", "--with-backend"],
            cwd=PROJECT.parent, stdout=output, stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                text = path.read_text()
                for line in text.splitlines():
                    if line.startswith('{"run_file":'):
                        yield json.loads(line)
                        return
                assert process.poll() is None, text
                time.sleep(.05)
            raise AssertionError(f"No run file after 60 s; see {path}")
        finally:
            if process.poll() is None:
                process.send_signal(signal.SIGINT)
            try:
                process.wait(timeout=25)
            except subprocess.TimeoutExpired:
                # The CLI owns its backend group. Do not kill by name or port.
                process.terminate()
                process.wait(timeout=20)


def test_realtime_during_cold_backend_startup_and_a2():
    with launch("d4") as run:
        # Native spawn must retain the private-session lifecycle contract:
        # Ctrl-C may reap this backend group, never the caller's process group.
        launcher_pid = run["backend_launcher_pid"]
        assert os.getpgid(launcher_pid) == os.getsid(launcher_pid) == launcher_pid
        assert launcher_pid != os.getpgrp()
        output = EVIDENCE / "d4-a2.json"
        with (EVIDENCE / "d4-a2.txt").open("w") as log:
            result = subprocess.run(
                ["uv", "run", "--project", str(PROJECT), "--offline", "python", "-m",
                 "wonky_twin.acceptance", "--run-file", run["run_file"], "--output", str(output)],
                cwd=PROJECT.parent, stdout=log, stderr=subprocess.STDOUT, timeout=100,
            )
        assert result.returncode == 0, f"Live acceptance failed; full stdout/stderr: {EVIDENCE / 'd4-a2.txt'}"
        report = json.loads(output.read_text())
        startup = report["metrics_before"]
        assert startup["ticks"] > 0 and startup["valid"] and startup["run_overruns"] == 0, startup
        metrics = report["metrics_after"]
        assert metrics["measured_ticks"] > 1000
        assert metrics["valid"] and metrics["run_overruns"] == 0, metrics
        assert not report["bus"]["timeout_or_retry_lines"]
    finished = json.loads(Path(run["run_file"]).read_text())
    assert finished["state"] == "stopped"
    # Include metrics serialization and teardown: a clean measured interval
    # must not hide a GIL stall caused by reporting that very interval.
    assert finished["metrics"]["valid"], finished["metrics"]
    # Both the launcher and its backend, not just the HTTP listener, are gone.
    for pid in (launcher_pid, report["backend_pid"]):
        result = subprocess.run(["ps", "-p", str(pid), "-o", "pid="], capture_output=True, text=True)
        assert result.returncode == 1 and not result.stdout.strip(), (pid, result.stdout, result.stderr)


@pytest.mark.xfail(strict=True, reason="D5 blocked upstream: the sorter backend (waveshare_inventory.py:227) scans comports() with no gate; remove this mark when the sorter adds the seam")
def test_override_prevents_usb_enumeration_in_all_backend_threads():
    # Thermal waiting is not a backend timeout. Wait before starting the
    # bounded observation too, and let the diagnostic reap its own group if
    # pressure rises again or the observation times out.
    thermal_ready()
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    path = EVIDENCE / "d5-enumeration.txt"
    with path.open("w") as output:
        process = subprocess.Popen(
            ["uv", "run", "--project", str(PROJECT), "--offline", "python",
             str(PROJECT / "scripts/trace_enumeration.py")],
            cwd=PROJECT.parent, stdout=output, stderr=subprocess.STDOUT, start_new_session=True,
        )
        try:
            process.wait(timeout=90)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGINT)
                process.wait(timeout=25)
    assert process.returncode == 0, path.read_text()
    assert "GLOBAL_NO_USB_ENUMERATION: OBSERVED_NO_CALLS" in path.read_text()


@pytest.mark.xfail(strict=True, reason="D6 blocked upstream: the sorter backend hard-codes port 8000 (uvicorn and process guard); remove this mark when the sorter adds a port seam")
def test_occupied_8000_uses_another_backend_port_without_touching_listener():
    with socket.socket() as occupied:
        occupied.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        occupied.bind(("127.0.0.1", 8000))
        occupied.listen()
        try:
            with launch("d6") as run:
                assert run["backend_url"] != "http://127.0.0.1:8000"
                deadline = time.monotonic() + 45
                while True:
                    try:
                        with urllib.request.urlopen(run["backend_url"] + "/health", timeout=2) as response:
                            assert response.status == 200
                        break
                    except OSError:
                        assert time.monotonic() < deadline, "Backend did not serve health on its alternate port"
                        time.sleep(.1)
        finally:
            # Check ownership even when launch refuses: refusal is not D6
            # success, but must still leave the unrelated listener untouched.
            with socket.create_connection(("127.0.0.1", 8000), timeout=1):
                client, _ = occupied.accept()
                client.close()
            print("Owned listener on 8000 still accepts connections after twin shutdown")
