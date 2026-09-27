"""Re-runnable live A2-A5 observations, not independent certification.

Run with --run-file from `wonky-twin up --with-backend`. The real backend
routes own initialization/homing/jogs. Missing observations fail, not skip.
"""
import argparse
import asyncio
import json
from pathlib import Path
import re
import subprocess
import time
import urllib.request
import urllib.error

from .backend import BACKEND, TMP_ROOT


def http(url, payload=None):
    request = urllib.request.Request(url, data=json.dumps(payload).encode() if payload is not None else None,
                                     headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=3) as response:
        return json.load(response)


def wait_for(fn, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            result = fn()
            if result:
                return result
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(.05)
    raise AssertionError("Live acceptance condition timed out")


def command(args):
    result = subprocess.run(args, capture_output=True, text=True)
    print("$", " ".join(args), "\n" + result.stdout + result.stderr, flush=True)
    return {"command": args, "code": result.returncode, "stdout": result.stdout, "stderr": result.stderr}


async def websocket_observation(url, epoch):
    import aiohttp
    async with aiohttp.ClientSession() as session:
        async with session.ws_connect(url) as ws:
            samples = []
            start = time.monotonic()
            for _ in range(31):
                message = await ws.receive_json(timeout=2)
                assert message["schema"] == "wonky.twin-snapshot/1" and message["epoch"] == epoch
                samples.append(message["sim_ns"])
            assert all(a < b for a, b in zip(samples, samples[1:]))
            return {"frames": len(samples), "elapsed_s": time.monotonic()-start,
                    "first_sim_ns": samples[0], "last_sim_ns": samples[-1]}


def safety_observation(run, report):
    api, pid = run["backend_url"], str(report["backend_pid"])
    report["network"] = command(["lsof", "-nP", "-a", "-p", pid, "-i"])
    fields = command(["lsof", "-nP", "-a", "-p", pid, "-i", "-Fn"])
    assert fields["code"] == 0, fields
    sockets = [line[1:] for line in fields["stdout"].splitlines() if line.startswith("n")]
    assert sockets, "No live backend sockets observed"
    for connection in sockets:
        for endpoint in connection.split("->"):
            assert re.fullmatch(r"(?:127\.0\.0\.1|\[::1\]):\d+", endpoint), connection
    report["files"] = command(["lsof", "-nP", "-p", pid])
    files = report["files"]["stdout"]
    assert report["files"]["code"] == 0
    actual_ptys = set(re.findall(r"/dev/ttys\d+", files))
    assert actual_ptys == set(run["ptys"].values()), actual_ptys
    assert not re.search(r"/dev/(?:cu|tty)\.", files), "Real serial device opened"
    # Inspect regular writable descriptors, not read-only dylibs and source.
    for line in files.splitlines()[1:]:
        columns = line.split(None, 8)
        if len(columns) == 9 and columns[4] == "REG" and columns[3].endswith(("w", "u")):
            assert Path(columns[8]).is_relative_to(TMP_ROOT), line
    report["environment"] = command(["ps", "eww", "-p", pid, "-o", "command="])
    env_text = report["environment"]["stdout"]
    for name in ("HOME", "TMPDIR", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "LOCAL_STATE_DB_PATH",
                 "LOCAL_METRICS_DB_PATH", "DIAGNOSTICS_DB_PATH"):
        assert f"{name}={run['backend_state']}/" in env_text, name
    assert "SORTER_BASE_REPORTING_OFF=1" in env_text
    assert "LEGOSORTER_DISABLE=servos" not in env_text, "SC acceptance must not disable servos"
    assert "SORTER_MCU_BAUD=115200" in env_text
    report["camera_config"] = http(api + "/api/cameras/config")
    assert all(value in (None, -1) for role, value in report["camera_config"].items() if role != "layout")
    report["camera_health"] = http(api + "/api/cameras/health")
    assert report["camera_health"], "No camera-health observation"
    assert all(value["status"] == "unassigned" and value["last_frame_at"] is None
               for value in report["camera_health"].values()), report["camera_health"]
    report["hive_targets"] = http(api + "/api/hive/targets")
    assert report["hive_targets"] == []
    report["sandbox_profile"] = (Path(run["backend_state"]) / "backend.sb").read_text()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-file", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--home-runs", type=int, default=1)
    args = parser.parse_args()
    if args.home_runs < 1:
        parser.error("--home-runs must be positive")
    run = json.loads(args.run_file.read_text())
    assert run["state"] == "running" and run["backend_url"]
    api, snapshot = run["backend_url"], run["snapshot_url"]
    report = {"epoch": run["epoch"], "run_file": str(args.run_file), "stages": [], "samples": []}
    try:
        # Establish process ownership before sending any hardware API command.
        pids = command(["pgrep", "-P", str(run["backend_launcher_pid"])])["stdout"].split()
        assert len(pids) == 1, pids
        report["backend_pid"] = int(pids[0])
        identity = command(["ps", "-p", pids[0], "-o", "command="])
        assert str(BACKEND / "main.py") in identity["stdout"], identity
        wait_for(lambda: http(api + "/health"))
        report["metrics_before"] = http(snapshot.replace("/snapshot", "/metrics"))
        report["initial"] = http(snapshot)
        assert report["initial"]["epoch"] == run["epoch"]
        previous_resets = (-1, -1)
        report["homing_runs"] = []
        for action, state in [("initialize", "initialized")] + [("home", "ready")] * args.home_runs:
            def start_action():
                response = http(api + "/api/system/" + action, {})
                # /health is served before main registers its hardware hooks.
                # Only retry this side-effect-free refusal, never an accepted
                # operation or an arbitrary failure.
                if (action == "initialize" and response.get("ok") is False
                        and response.get("message") == "No hardware initialize function registered."):
                    return None
                return response
            response = wait_for(start_action)
            print(action, json.dumps(response), flush=True)
            assert response["ok"], response
            def completed():
                status = http(api + "/api/system/status")
                assert status["hardware_state"] != "error", status
                return status if status["hardware_state"] == state else None
            done = wait_for(completed)
            observed = http(snapshot)
            report["stages"].append({"action": action, "response": response, "completed": done,
                                     "snapshot": observed})
            if action == "home":
                report["servo_feedback"] = http(api + "/api/hardware-config/servo/live")
                # Safe Home must actually move the enabled layer servos, not
                # silently finish in LEGOSORTER_DISABLE/no-power mode.
                assert not done["no_power_development_mode"]
                for sid in ("15", "16"):
                    servo = observed["sc_bus"]["servos"][sid]
                    assert servo["move_start_ns"] > 0 and not servo["moving"], servo
                    assert servo["present_position_raw"] == servo["eeprom_min_max"][0], servo
                resets = tuple(observed["boards"][role]["steppers"][0]["position_reset_ns"]
                               for role in ("feeder", "distribution"))
                assert all(t is not None and t > old for t, old in zip(resets, previous_resets)), resets
                assert resets[0] < resets[1], resets
                previous_resets = resets
                homing = {"run": len(report["homing_runs"]) + 1, "state": done["hardware_state"],
                          "feed_reset_ns": resets[0], "chute_reset_ns": resets[1]}
                report["homing_runs"].append(homing)
                print("HOME_COMPLETED", json.dumps(homing), flush=True)
        report["discovered"] = http(api + "/api/firmware/boards")
        expected = {"feeder": ["c_channel_1_rotor", "c_channel_2_rotor", "c_channel_3_rotor", "carousel"],
                    "distribution": ["chute_stepper", "distribution_aux_1", "distribution_aux_2", "distribution_aux_3"]}
        boards = report["discovered"]["boards"]
        assert {board["role"] for board in boards} == set(expected) and len(boards) == 2
        for board in boards:
            assert board["stepper_names"] == expected[board["role"]], board
            assert board["port"] == run["ptys"][board["role"]]
            assert board["version"]["commit"].startswith("twin-")
        homed = report["stages"][-1]["snapshot"]["boards"]
        feed_reset = homed["feeder"]["steppers"][0]["position_reset_ns"]
        chute_reset = homed["distribution"]["steppers"][0]["position_reset_ns"]
        assert feed_reset is not None and chute_reset is not None and feed_reset < chute_reset
        report["home_order_ns"] = {"feed": feed_reset, "chute": chute_reset}
        live = http(api + "/api/hardware-config/cad-project-041/live")
        assert live["homed"] and live["home_pin_channel"] == 2 and not live["endstop_active_high"], live
        report["homed_live"] = live
        base = http(snapshot)["joints"]["feed"]["value_mm"]
        for degrees in (90, -90):
            response = http(api + "/api/hardware-config/cad-project-041/jog", {"delta_deg": degrees, "speed": 800})
            assert response["ok"], response
            print("jog", degrees, json.dumps(response), flush=True)
            def moved():
                snap = http(snapshot)
                s = snap["boards"]["feeder"]["steppers"][0]
                report["samples"].append({"sim_ns": snap["sim_ns"], "feed_mm": snap["joints"]["feed"]["value_mm"],
                                          "position": s["position"], "state": s["state"]})
                return s["state"] == "STOPPED"
            wait_for(moved, 8)
            report["stages"].append({"action": "jog", "degrees": degrees, "response": response,
                                     "snapshot": http(snapshot)})
        values = [sample["feed_mm"] for sample in report["samples"]]
        end = http(snapshot)["joints"]["feed"]["value_mm"]
        assert max(values) - base > 28, values
        assert abs(end - base) < .001, (base, end)
        assert any(s["state"] != "STOPPED" for s in report["samples"])
        report["movement"] = {"start_mm": base, "peak_mm": max(values), "return_mm": end}
        report["websocket"] = asyncio.run(websocket_observation(run["websocket_url"], run["epoch"]))
        report["metrics_after"] = http(snapshot.replace("/snapshot", "/metrics") +
                                       "?since_tick=" + str(report["metrics_before"]["ticks"]))
        backend_log = (Path(run["backend_state"]) / "backend.log").read_text()
        report["chute_homing_aborts"] = [line for line in backend_log.splitlines()
                                         if "endstop active but firmware still moving" in line]
        assert not report["chute_homing_aborts"], report["chute_homing_aborts"]
        waits = [float(value) for value in re.findall(r"MCU bus blocked caller ([\d.]+)ms", backend_log)]
        errors = [line for line in backend_log.splitlines() if re.search(
            r"MCU bus transient error|Timeout waiting for response|Partial response|MCUBusError", line)]
        report["bus"] = {"observed_calls": len(waits), "max_caller_ms": max(waits) if waits else None,
                         "timeout_or_retry_lines": errors, "source": str(Path(run["backend_state"]) / "backend.log")}
        assert waits and not errors and max(waits) < 250, report["bus"]
        safety_observation(run, report)
        report["A2"] = "observed, not independently verified"
        print("MOVEMENT", json.dumps(report["movement"]), flush=True)
        print("TIMING", json.dumps(report["metrics_after"]), flush=True)
        print("BUS", json.dumps(report["bus"]), flush=True)
        # A successful hardware workflow is not proof of realtime. Include
        # startup via cumulative validity; a clean interval cannot clear it.
        assert report["metrics_after"]["valid"], report["metrics_after"]
        assert report["metrics_after"]["overruns"] == 0, report["metrics_after"]
        report["A5"] = "observed, not independently verified"
    except BaseException as exc:
        report["error"] = repr(exc)
        raise
    finally:
        args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
