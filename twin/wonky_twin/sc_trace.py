"""Independent command-replay oracle for the SC wire and every 1 ms pose tick.

It derives poses from accepted GOAL_POSITION packets and their arrival times,
not the emulator's goal/position fields. Dump ticks are NEVER silently exempt
from the literal coupling contract (the dump pose itself violates it by 90°).
"""
import struct


def check_trace(transactions, samples, calibration, start_ns=None, end_ns=None):
    if not transactions or not samples:
        raise ValueError("SC trace requires both wire transactions and pose samples")
    if any(b[0] - a[0] != 1_000_000 for a, b in zip(samples, samples[1:])):
        raise ValueError("SC samples have missing, duplicated or non-1ms ticks")
    start_ns = samples[0][0] if start_ns is None else start_ns
    end_ns = samples[-1][0] if end_ns is None else end_ns
    if start_ns < samples[0][0] - 1_000_000 or end_ns > samples[-1][0] + 1_000_000:
        raise ValueError("Requested interval is outside retained SC samples")
    models = {int(sid): dict(raw=float(c["zero_raw"]), goal=float(c["zero_raw"]), start=0,
                            end=0, torque=False, calibration=c) for sid, c in calibration.items()}
    joint_ids = {c["joint"]: int(sid) for sid, c in calibration.items() if c["joint"]}

    def pose(s, ns):
        if not s["torque"] or s["end"] <= s["start"]:
            return s["raw"]
        f = min(1, max(0, (ns - s["start"]) / (s["end"] - s["start"])))
        return s["raw"] + (s["goal"] - s["raw"]) * f

    result = {"ticks": 0, "coupling_violations": 0, "max_coupling_error_deg": 0.0,
              "tick_interpolation_errors": 0, "present_position_reads": 0,
              "in_flight_position_reads": 0, "present_position_errors": 0,
              "max_position_error_raw": 0.0, "torque_releases": [],
              "definition": "all ticks including dump; |rock-max(-135,-return)| <= 5 deg"}
    # Samples and requests have the same SimClock domain; samples at a command
    # timestamp precede the command (Twin catches up before dispatching it).
    events = [(entry["sim_ns"], 1, entry) for entry in transactions]
    events.extend((row[0], 0, row) for row in samples)
    for ns, kind, event in sorted(events, key=lambda e: (e[0], e[1])):
        if kind == 0:
            if not start_ns <= ns <= end_ns:
                continue
            _, rock, arm, *_ = event
            error = abs(rock - max(-135, -arm))
            result["ticks"] += 1
            result["coupling_violations"] += error > 5
            result["max_coupling_error_deg"] = max(result["max_coupling_error_deg"], error)
            for joint, degrees in (("rock", rock), ("return", arm)):
                state = models[joint_ids[joint]]
                c = state["calibration"]
                expected = (pose(state, ns) - c["zero_raw"]) / c["raw_per_deg"]
                result["tick_interpolation_errors"] += abs(expected - degrees) > 1e-7
            continue
        s = models.get(event["id"])
        if s is None:
            continue
        request = bytes.fromhex(event["request"])
        response = bytes.fromhex(event["response"]) if event["response"] else None
        params = request[5:-1]
        if response is None or response[4] != 0:
            continue
        if request[4] == 2 and params[0] <= 56 and params[0] + params[1] >= 58 and start_ns <= ns <= end_ns:
            expected = round(pose(s, ns))
            offset = 5 + 56 - params[0]
            actual = int.from_bytes(response[offset:offset + 2], "big")
            error = abs(actual - expected)
            result["present_position_reads"] += 1
            result["in_flight_position_reads"] += bool(s["torque"] and ns < s["end"] and expected != round(s["goal"]))
            result["present_position_errors"] += error != 0
            result["max_position_error_raw"] = max(result["max_position_error_raw"], error)
        if request[4] != 3:
            continue
        if params[0] == 42 and len(params) == 7:
            goal, duration_ms, _ = struct.unpack(">HHH", params[1:])
            current = pose(s, ns)
            s.update(raw=current, goal=float(goal), start=ns, end=ns + duration_ms * 1_000_000)
        elif params[0] == 40 and len(params) == 2:
            enabled = bool(params[1])
            if not enabled or not s["torque"]:
                current = pose(s, ns)
                if not enabled and s["calibration"]["joint"] == "return":
                    current = float(s["calibration"]["zero_raw"])
                s.update(raw=current, goal=current, start=ns, end=ns)
            s["torque"] = enabled
            if not enabled and start_ns <= ns <= end_ns:
                result["torque_releases"].append({"id": event["id"], "sim_ns": ns})
    if result["ticks"] == 0:
        raise ValueError("No SC ticks in requested interval")
    result["coupling_ok"] = result["coupling_violations"] == 0
    result["interpolation_ok"] = (result["present_position_reads"] > 0
                                  and result["present_position_errors"] == 0
                                  and result["tick_interpolation_errors"] == 0)
    return result


def stroke_measurements(transactions, samples, case):
    """Measured pose dwell uses an explicit 0.5 degree window, not goal time."""
    from statistics import median

    start, end = case["start_ns"], case["end_ns"]
    phases = {row["phase"]: row["sim_ns"] for row in case["phases"]}
    segments = {row["segment"]: row["sim_ns"] for row in case["segments"]}
    start = phases["hopper_return"]
    end = phases["hopper_return_settle"]
    goals = {}
    releases = []
    for event in transactions:
        if not start <= event["sim_ns"] <= end:
            continue
        wire = bytes.fromhex(event["request"])
        if wire[4] != 3:
            continue
        if wire[5] == 42:
            goals.setdefault(event["id"], []).append((event["sim_ns"], int.from_bytes(wire[8:10], "big")))
        elif event["id"] == 18 and wire[5:7] == bytes((40, 0)):
            releases.append(event["sim_ns"])
    cadence = {}
    for sid, commands in goals.items():
        gaps = [(b[0] - a[0]) / 1e6 for a, b in zip(commands, commands[1:])]
        cadence[str(sid)] = {"goals": len(commands), "goal_times_ms": sorted({c[1] for c in commands}),
                             "spacing_ms": {"min": min(gaps), "median": median(gaps), "max": max(gaps)}}
    window = [row for row in samples if start <= row[0] <= end]
    top = next((row[0] for row in window if abs(row[2] - 180) <= .5), None)
    # Longest consecutive physical dwell, not a sum over disjoint visits.
    best = current = 0
    for _, rock, arm, *_ in window:
        current = current + 1 if abs(rock + 45) <= .5 and abs(arm - 180) <= .5 else 0
        best = max(best, current)
    before_release = next((row for row in reversed(window) if releases and row[0] < releases[0]), None)
    return {"commands": cadence, "stroke_phase_s": (end - start) / 1e9,
            "first_arrival_return_180_within_0_5_deg_s": (top - start) / 1e9 if top else None,
            "longest_dump_pose_within_0_5_deg_s": max(0, best - 1) / 1000,
            "commanded_dump_segment_s": (segments["lower"] - segments["dump"]) / 1e9,
            "release_id18_sim_ns": releases,
            "pose_tick_before_release": before_release,
            "dwell_definition": "longest contiguous interval with |return-180|<=0.5 and |rock+45|<=0.5 deg"}
