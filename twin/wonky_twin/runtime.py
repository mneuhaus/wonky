"""Own both Pico boards, SC bus, clock, mechanics and PTYs in one lifetime."""
from collections import deque
import json
from pathlib import Path
import threading
from .board import Board
from .clock import SimClock
from .faults import FaultInjector
from .plant import Plant
from .sc_bus import SCBus, PTYSCBus
from .transport import PTYBoard


class Twin:
    def __init__(self, revision="dev", seed=0, reboot_seconds=1.0, trace_path=None, tray_id=2, **plant_options):
        self.lock = threading.RLock()
        self.boards = {role: Board(role, revision, reboot_seconds) for role in ("feeder", "distribution")}
        self.plant = Plant(self.boards, **plant_options)
        self.sc = SCBus(tray_id)
        self.faults = FaultInjector(seed)
        self.trace = deque(maxlen=10000)
        self.sc_trace = deque(maxlen=20000)
        self.trace_file = Path(trace_path).open("w") if trace_path else None
        self.sim_ns = 0
        self.next_pulse_ns = 100_000
        self.clock = SimClock(self.tick, self.lock)
        self.endpoints = {role: PTYBoard(board, self.lock, self.faults, self.record, self.synchronize)
                          for role, board in self.boards.items()}
        self.sc_endpoint = PTYSCBus(self.sc, self.lock, self.synchronize, self.record_sc)
        self.clock.start()

    def record(self, role, request, response):
        item = {"epoch": self.clock.epoch, "sim_ns": self.sim_ns, "role": role,
                "command": request.command, "channel": request.channel,
                "payload": request.payload.hex(),
                "response_command": response.command if response else None,
                "response": response.payload.hex() if response else None}
        self.trace.append(item)
        if self.trace_file:
            self.trace_file.write(json.dumps(item, separators=(",", ":")) + "\n")

    def record_sc(self, request, response):
        servo = self.sc.servos.get(request[2])
        item = {"epoch": self.clock.epoch, "sim_ns": self.sim_ns, "role": "sc",
                "id": request[2], "instruction": request[4], "params": request[5:-1].hex(),
                "request": request.hex(), "response": response.hex() if response else None,
                "position_raw": servo.raw if servo else None,
                "goal_raw": servo.goal_raw if servo else None,
                "move_start_raw": servo.start_raw if servo else None,
                "move_start_ns": servo.start_ns if servo else None,
                "move_end_ns": servo.end_ns if servo else None,
                "torque_enabled": servo.torque if servo else None}
        self.sc_trace.append(item)
        if self.trace_file:
            self.trace_file.write(json.dumps(item, separators=(",", ":")) + "\n")

    def synchronize(self):
        # All commands, not just READs, first catch up to their arrival time.
        self.tick(self.clock.now_ns())

    def tick(self, sim_ns):
        # Pulse-quantized ideal stepper drive; no future endstop levels.
        while self.next_pulse_ns <= sim_ns:
            event_ns = self.next_pulse_ns
            if event_ns % 1_000_000 == 0:
                for board in self.boards.values():
                    for stepper in board.steppers:
                        stepper.motion_tick(board.inputs, event_ns)
                self.sc.advance(event_ns, sample=True)
            for board in self.boards.values():
                for stepper in board.steppers:
                    stepper.pulse_tick(board.inputs, event_ns)
            self.plant.update_sensors()
            self.next_pulse_ns += 100_000
        self.sim_ns = max(self.sim_ns, sim_ns)
        self.sc.advance(self.sim_ns)

    def snapshot(self):
        with self.lock:
            self.synchronize()
            return {"schema": "wonky.twin-snapshot/1", "epoch": self.clock.epoch,
                    "sim_ns": self.sim_ns, "joints": {**self.plant.snapshot(), **self.sc.joints()},
                    "sc_bus": self.sc.snapshot(),
                    "boards": {role: board.snapshot() for role, board in self.boards.items()},
                    "faults": list(self.faults.events), "overruns": self.clock.overruns,
                    "valid": self.clock.overruns == 0 and self.clock.error is None,
                    "clock_error": self.clock.error,
                    "transport_errors": {**{role: list(e.errors) for role, e in self.endpoints.items()},
                                         "sc": list(self.sc_endpoint.errors)}}

    def close(self):
        self.sc_endpoint.close()
        for endpoint in self.endpoints.values():
            endpoint.close()
        self.clock.close()
        if self.trace_file:
            self.trace_file.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
