"""Executable TW5 observations against pinned backend code, never certification.

uv run --project twin python -m wonky_twin.sc_acceptance --output <path>
Uses its own PTYs and sandboxed child; no HTTP server or production hardware.
Exits 1 when upstream acceptance remains blocked; evidence is still retained.
"""
import argparse
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import time

from .backend import BACKEND, prepare_backend, thermal_ready
from .runtime import Twin
from .sc_trace import check_trace, stroke_measurements


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    thermal_ready()
    sys.setswitchinterval(.0001)
    report = {"backend_revision": "8bd54541", "proof_class": "PTY + real controller component; synthetic perception counts"}
    with Twin() as twin:
        ports = [endpoint.path for endpoint in twin.endpoints.values()]
        state, profile, env = prepare_backend(ports, "sc-probe-" + twin.clock.epoch, twin.sc_endpoint.path, twin.sc)
        env["PYTHONPATH"] = str(BACKEND)
        script = Path(__file__).resolve().parents[1] / "scripts/probe_sc_backend.py"
        command = ["/usr/bin/env", "-C", str(state), "/usr/bin/sandbox-exec", "-f", str(profile),
                   "uv", "run", "--project", str(BACKEND), "--no-sync", "--offline", "python", str(script),
                   twin.sc_endpoint.path, ports[0]]
        log_path = state / "controller.log"
        with log_path.open("w") as log:
            child = subprocess.Popen(command, env=env, close_fds=False, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=log, text=True, start_new_session=True)
            try:
                deadline = time.monotonic() + 70
                while child.poll() is None:
                    if time.monotonic() > deadline:
                        raise TimeoutError(f"SC backend probe timed out; {log_path}")
                    if not select.select([child.stdout], [], [], .1)[0]:
                        continue
                    line = child.stdout.readline()
                    if not line:
                        continue
                    event = json.loads(line)
                    with twin.lock:
                        twin.synchronize()
                        if event["op"] == "inject":
                            twin.sc.inject(event["id"], event["kind"], event.get("count", 1))
                        elif event["op"] == "result":
                            report.update(event["report"])
                        elif event["op"] != "mark":
                            raise ValueError(event)
                        reply = {"sim_ns": twin.sim_ns}
                    child.stdin.write(json.dumps(reply) + "\n")
                    child.stdin.flush()
                assert child.returncode == 0, f"SC child failed ({child.returncode}); {log_path}"
            finally:
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGTERM)
                    try:
                        child.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait(timeout=5)
                child.stdin.close()
                child.stdout.close()
        report["state"] = str(state)
        report["controller_log"] = str(log_path)
        report["calibration"] = twin.sc.snapshot()["servos"]
        # Stop the 1kHz owner before materializing/serializing long histories.
        twin.clock.close()
        transactions, samples = list(twin.sc_trace), list(twin.sc.samples)
        report["clock"] = twin.clock.metrics()
        report["transport_errors"] = list(twin.sc_endpoint.errors)
    trace_path = args.output.with_suffix(".trace.json")
    trace_path.parent.mkdir(parents=True, exist_ok=True)
    trace_path.write_text(json.dumps({"transactions": transactions, "samples": samples, "calibration": report["calibration"]}))
    report["trace_path"] = str(trace_path)
    for case in report["cases"].values():
        case["trace_check"] = check_trace(transactions, samples, report["calibration"], case["start_ns"], case["end_ns"])
    stroke = report["cases"]["component_stroke"]
    segments = {row["segment"]: row["sim_ns"] for row in stroke["segments"]}
    stroke["segment_seconds"] = {f"{a}_to_{b}": (segments[b] - segments[a]) / 1e9
                                  for a, b in (("lift", "dump"), ("dump", "lower"), ("lower", "home"))}
    for label, begin, end in (("lift", segments["lift"], segments["dump"]),
                              ("dump", segments["dump"], segments["lower"]),
                              ("lower", segments["lower"], segments["home"])):
        stroke[label + "_check"] = check_trace(transactions, samples, report["calibration"], begin, end)
    stroke["measurements"] = stroke_measurements(transactions, samples, stroke)
    report["acceptance"] = {
        "A1_discovery": report["ids"] == [2, 15, 16, 18],
        "A1_safe_home": "separate full-application test_live_backend.py evidence required",
        "A2": report["cases"]["normal_reject"]["status"].get("hopper_returns", 0) == 1,
        "A3_nack_faults": report["cases"]["nack_goal"]["status"]["phase"] == "fault",
        "A3_no_reply_faults": report["cases"]["no_reply_goal"]["status"]["phase"] == "fault",
        "component_coupling_all_ticks": stroke["trace_check"]["coupling_ok"],
        "component_interpolation": stroke["trace_check"]["interpolation_ok"],
        "component_actual_dwell_1s": stroke["measurements"]["longest_dump_pose_within_0_5_deg_s"] >= 1.0,
        "A3_uncalibrated_refused": "not calibrated" in report["cases"]["uncalibrated"]["status"].get("servo_error", ""),
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), "acceptance": report["acceptance"],
                      "stroke": stroke["trace_check"], "segment_seconds": stroke["segment_seconds"]}, indent=2))
    raise SystemExit(0 if all(value is True for key, value in report["acceptance"].items() if key != "A1_safe_home") else 1)


if __name__ == "__main__":
    main()
