"""One command starts the complete twin; SIGINT/SIGTERM reap only its children."""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import signal
import sys
import threading
from aiohttp import web
from .backend import BackendProcess, TMP_ROOT
from .runtime import Twin
from .server import application


def revision():
    digest = hashlib.sha256()
    for path in sorted(Path(__file__).parent.glob("*.py")):
        digest.update(path.name.encode() + path.read_bytes())
    return digest.hexdigest()[:12]


async def up(args):
    run_dir = TMP_ROOT / "twin-run"
    run_dir.mkdir(parents=True, exist_ok=True)
    twin = Twin(revision=revision(), seed=args.seed, reboot_seconds=args.reboot_seconds, tray_id=args.tray_id)
    runner = web.AppRunner(application(twin), shutdown_timeout=1)
    backend = None
    run_file = run_dir / f"run-{twin.clock.epoch}.json"
    stopped = asyncio.Event()
    cancel_startup = threading.Event()
    def stop():
        stopped.set()
        cancel_startup.set()
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signum, stop)
    try:
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", args.port)
        await site.start()
        port = runner.addresses[0][1]
        if args.with_backend:
            try:
                backend = await asyncio.to_thread(BackendProcess, [e.path for e in twin.endpoints.values()],
                                                  twin.clock.epoch, cancel_startup, twin.sc_endpoint.path, twin.sc)
            except InterruptedError:
                if stopped.is_set():
                    return
                raise
        run = {"pid": os.getpid(), "epoch": twin.clock.epoch,
               "ptys": {**{role: e.path for role, e in twin.endpoints.items()}, "sc": twin.sc_endpoint.path},
               "snapshot_url": f"http://127.0.0.1:{port}/snapshot", "websocket_url": f"ws://127.0.0.1:{port}/twin",
               "backend_launcher_pid": backend.process.pid if backend else None,
               "backend_url": "http://127.0.0.1:8000" if backend else None,
               "backend_state": str(backend.state) if backend else None,
               "state": "running"}
        # Per-epoch file prevents one launch from overwriting another's PTYs.
        run_file.write_text(json.dumps(run, indent=2) + "\n")
        print(json.dumps({"run_file": str(run_file), **run}), flush=True)
        while not stopped.is_set():
            if backend and backend.process.poll() is not None:
                raise RuntimeError(f"Backend exited {backend.process.returncode}; see {backend.state / 'backend.log'}")
            if twin.clock.error:
                raise RuntimeError(twin.clock.error)
            try:
                await asyncio.wait_for(stopped.wait(), timeout=.2)
            except asyncio.TimeoutError:
                pass
    finally:
        if backend:
            await asyncio.to_thread(backend.close)
        await runner.cleanup()
        twin.close()
        metrics = twin.clock.metrics()
        (run_dir / f"metrics-{twin.clock.epoch}.json").write_text(json.dumps(metrics, indent=2) + "\n")
        (run_dir / f"trace-{twin.clock.epoch}.json").write_text(json.dumps(list(twin.trace), indent=2) + "\n")
        (run_dir / f"sc-trace-{twin.clock.epoch}.json").write_text(json.dumps(list(twin.sc_trace)) + "\n")
        (run_dir / f"sc-samples-{twin.clock.epoch}.json").write_text(json.dumps(list(twin.sc.samples)) + "\n")
        if run_file.exists():
            run["state"] = "stopped"
            run["metrics"] = metrics
            run_file.write_text(json.dumps(run, indent=2) + "\n")
        print(json.dumps({"stopped": twin.clock.epoch, "metrics": metrics}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    start = commands.add_parser("up")
    start.add_argument("--with-backend", action="store_true")
    start.add_argument("--port", type=int, default=0, help="Loopback snapshot port; 0 chooses a free port")
    start.add_argument("--tray-id", type=int, choices=(2, 17), default=2)
    start.add_argument("--seed", type=int, default=0)
    start.add_argument("--reboot-seconds", type=float, default=1.0)
    args = parser.parse_args()
    # The default 5 ms GIL timeslice exceeds five motion periods. Bound
    # contention from HTTP/logging Python work in this dedicated CLI process;
    # native C calls still need bounded work (see clock.metrics).
    switch_interval = sys.getswitchinterval()
    sys.setswitchinterval(min(switch_interval, .0001))
    try:
        asyncio.run(up(args))
    finally:
        sys.setswitchinterval(switch_interval)


if __name__ == "__main__":
    main()
