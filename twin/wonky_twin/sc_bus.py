"""Nominal Feetech SC09/SC15 kinematics, not measured firmware or dynamics.

Registers are big-endian. Goals interpolate from the CURRENT pose, including
when a new 100 ms goal arrives after 50 ms. Unpowered joints hold, except the
return arm: an explicitly idealized gravity snap to the fixture's home pose.
"""
from collections import deque
from dataclasses import dataclass
import json
import os
import select
import struct
import threading
import tty

from .plant import FIXTURES


def packet(servo_id, code, params=b""):
    body = bytes((servo_id, len(params) + 2, code)) + params
    return b"\xff\xff" + body + bytes((~sum(body) & 255,))


@dataclass
class Servo:
    id: int
    model: int
    zero_raw: int
    raw_per_deg: float
    minimum: int
    maximum: int
    joint: str | None = None
    limits: tuple | None = None
    home_deg: float = 0.0

    def __post_init__(self):
        self.registers = bytearray(71)
        for address, value in ((3, self.model), (9, self.minimum), (11, self.maximum), (16, 1000)):
            self.registers[address:address + 2] = struct.pack(">H", value)
        self.registers[5] = self.id
        self.registers[48] = 1  # EEPROM locked until explicitly unlocked
        self.registers[62:64] = bytes((60, 25))  # nominal 6 V / 25 C, not simulated thermals
        self.raw = float(self.zero_raw)
        self.start_raw = self.raw
        self.goal_raw = self.raw
        self.start_ns = self.end_ns = 0
        self.torque = False
        self.now_ns = 0
        self.registers[42:44] = struct.pack(">H", round(self.raw))

    @property
    def degrees(self):
        return (self.raw - self.zero_raw) / self.raw_per_deg

    def advance(self, now_ns):
        self.now_ns = max(self.now_ns, now_ns)
        if self.torque and self.end_ns > self.start_ns:
            fraction = min(1.0, max(0.0, (self.now_ns - self.start_ns) / (self.end_ns - self.start_ns)))
            self.raw = self.start_raw + (self.goal_raw - self.start_raw) * fraction

    def read(self, address, count):
        registers = self.registers.copy()
        registers[56:58] = struct.pack(">H", round(self.raw))
        registers[66] = int(self.torque and self.now_ns < self.end_ns and self.raw != self.goal_raw)
        # LOAD/CURRENT are explicitly nominal zero, not a stall/torque model.
        return bytes(registers[address:address + count])

    def write(self, address, data):
        if address == 42 and len(data) == 6:
            goal, duration_ms, speed = struct.unpack(">HHH", data)
            lo, hi = struct.unpack(">HH", self.registers[9:13])
            physical = [round(self.zero_raw + deg * self.raw_per_deg) for deg in self.limits] if self.limits else [0, 1023]
            if not lo <= goal <= hi or not physical[0] <= goal <= physical[1]:
                return 0x02  # angle-limit refusal; the target never moves
            if duration_ms == 0 or speed != 0:
                return 0x40  # unsupported speed-controlled/un-timed motion, never fake it
            self.registers[42:48] = data
            self.start_raw, self.goal_raw = self.raw, float(goal)
            self.start_ns, self.end_ns = self.now_ns, self.now_ns + duration_ms * 1_000_000
            return 0
        if address == 40 and len(data) == 1 and data[0] in (0, 1):
            enabled = bool(data[0])
            if not enabled:
                if self.joint == "return":
                    self.raw = self.zero_raw + self.home_deg * self.raw_per_deg
                self.start_raw = self.goal_raw = self.raw
                self.start_ns = self.end_ns = self.now_ns
            elif not self.torque:
                # No motion is queued while unpowered. A fresh goal is required.
                self.start_raw = self.goal_raw = self.raw
                self.start_ns = self.end_ns = self.now_ns
            self.torque = enabled
        elif address == 48 and len(data) == 1 and data[0] in (0, 1):
            pass
        elif (address, len(data)) in ((9, 4), (9, 2), (11, 2), (16, 2), (21, 3), (21, 1), (22, 1), (23, 1)):
            if self.registers[48]:
                return 0x40
            if address in (9, 11, 16) and any(v > 1023 for v in struct.unpack(">" + "H" * (len(data) // 2), data)):
                return 0x02
        else:
            return 0x40
        self.registers[address:address + len(data)] = data
        return 0

    def snapshot(self):
        return {"id": self.id, "model": f"SC{self.model:02d}", "joint": self.joint,
                "position_raw": self.raw, "present_position_raw": round(self.raw),
                "goal_raw": self.goal_raw, "value_deg": self.degrees,
                "commanded_goal_raw": int.from_bytes(self.registers[42:44], "big"),
                "move_start_ns": self.start_ns, "move_end_ns": self.end_ns,
                "move_start_raw": self.start_raw, "torque_enabled": self.torque,
                "moving": bool(self.read(66, 1)[0]), "eeprom_min_max": list(struct.unpack(">HH", self.registers[9:13])),
                "zero_raw": self.zero_raw, "raw_per_deg": self.raw_per_deg, "nominal": True,
                "limit_quantization_max_deg": 0.5 / self.raw_per_deg,
                "telemetry_nominal": ["load", "voltage", "temperature", "current"],
                "torque_off_model": "gravity_snap_home" if self.joint == "return" else "kinematic_hold"}


class SCBus:
    def __init__(self, tray_id=2):
        if tray_id not in (2, 17):
            raise ValueError("tray_id must be 2 (SC09) or 17 (SC15)")
        motion = json.loads((FIXTURES / "r20-motion.json").read_text())
        self.motion = motion
        home = motion["poses"]["home"]
        self.tray_id = tray_id
        model = 9 if tray_id == 2 else 15
        scale = 1023 / (300 if model == 9 else 210)
        def joint_servo(sid, model, zero, scale, joint):
            limits = tuple(motion["joints"][joint]["limits"])
            return Servo(sid, model, zero, scale, round(zero + limits[0] * scale),
                         round(zero + limits[1] * scale), joint, limits, home.get(joint, 0))

        self.servos = {
            tray_id: joint_servo(tray_id, model, 700, scale, "rock"),
            15: Servo(15, 15, 512, 1023 / 210, 100, 900),
            16: Servo(16, 15, 512, 1023 / 210, 100, 900),
            18: joint_servo(18, 15, 40, 1023 / 210, "return"),
        }
        self.now_ns = 0
        self.faults = {}
        self.fault_events = deque(maxlen=1000)
        # A fixed numeric ring avoids long GC scans of thousands of retained
        # Python tuples on the 1kHz thread. Materialize only after stopping it.
        import numpy as np
        self._samples = np.empty((120_000, 5), dtype=np.float64)
        self._sample_count = 0
        self.last_sample_ns = -1

    @property
    def samples(self):
        count = min(self._sample_count, len(self._samples))
        start = max(0, self._sample_count - count) % len(self._samples)
        first = self._samples[start:min(start + count, len(self._samples))].tolist()
        if start + count > len(self._samples):
            first.extend(self._samples[:start + count - len(self._samples)].tolist())
        return first

    def advance(self, now_ns, sample=False):
        self.now_ns = max(self.now_ns, now_ns)
        for servo in self.servos.values():
            servo.advance(self.now_ns)
        if sample and now_ns > self.last_sample_ns:
            rock, arm = self.servos[self.tray_id], self.servos[18]
            # Caller never samples a time older than a command already handled.
            self._samples[self._sample_count % len(self._samples)] = (self.now_ns, rock.degrees, arm.degrees, rock.torque, arm.torque)
            self._sample_count += 1
            self.last_sample_ns = self.now_ns

    def inject(self, servo_id, kind, count=1):
        if servo_id not in self.servos or kind not in ("nack_goal", "no_reply_goal", "uncalibrated"):
            raise ValueError("Unknown servo or SC fault")
        if not isinstance(count, int) or count < 1:
            raise ValueError("count must be a positive integer (wire transactions, including retries)")
        if kind == "uncalibrated":
            # Not 0..1023: TrayServo intentionally permits that full range.
            self.servos[servo_id].registers[9:13] = struct.pack(">HH", 500, 520)
        else:
            self.faults[servo_id] = [kind, count]
        self.fault_events.append({"sim_ns": self.now_ns, "id": servo_id, "fault": kind, "count": count, "injected": True})

    def handle(self, wire):
        sid, _, instruction = wire[2:5]
        servo = self.servos.get(sid)
        params = wire[5:-1]
        if servo is None:
            return None
        code, result = 0, b""
        if instruction == 1 and not params:
            pass
        elif instruction == 2 and len(params) == 2 and params[1] and sum(params) <= len(servo.registers):
            result = servo.read(*params)
        elif instruction == 3 and len(params) >= 2:
            fault = self.faults.get(sid) if params[0] == 42 else None
            if fault:
                kind, remaining = fault
                if remaining == 1:
                    del self.faults[sid]
                else:
                    fault[1] -= 1
                self.fault_events.append({"sim_ns": self.now_ns, "id": sid, "fault": kind, "applied": True})
                return packet(sid, 0x02) if kind == "nack_goal" else None
            code = servo.write(params[0], params[1:])
        else:
            code = 0x40
        return packet(sid, code, result)

    def snapshot(self):
        rock, arm = self.servos[self.tray_id], self.servos[18]
        error = abs(rock.degrees - max(-135, -arm.degrees))
        return {"servos": {str(sid): s.snapshot() for sid, s in self.servos.items()},
                "coupling": {"error_deg": error, "within_5_deg": error <= 5,
                             "definition": "abs(rock - max(-135, -return)); never exempt dump/transition ticks"},
                "faults": list(self.fault_events), "sample_period_ns": 1_000_000,
                "sample_window_ns": 120_000_000_000}

    def joints(self):
        return {servo.joint: {"value_deg": servo.degrees, "limits_deg": list(servo.limits),
                             "direction": self.motion["joints"][servo.joint]["direction"],
                             "point_mm": self.motion["joints"][servo.joint]["point"],
                             "parent": self.motion["joints"][servo.joint].get("parent"),
                             "bound": True, "servo_id": servo.id, "nominal": True,
                             "torque_off_model": "gravity_snap_home" if servo.joint == "return" else "kinematic_hold"}
                for servo in self.servos.values() if servo.joint}


class PTYSCBus:
    """Own one half-duplex PTY; echo every request, including unanswered ones."""
    def __init__(self, bus, lock, synchronize, trace):
        self.bus, self.lock, self.synchronize, self.trace = bus, lock, synchronize, trace
        self.master, self.slave = os.openpty()
        tty.setraw(self.master)
        tty.setraw(self.slave)
        self.path = os.ttyname(self.slave)
        self.stop = threading.Event()
        self.errors = deque(maxlen=100)
        self.thread = threading.Thread(target=self._run, name="pty-sc", daemon=True)
        self.thread.start()

    def _run(self):
        buffer = bytearray()
        try:
            while not self.stop.is_set():
                if not select.select([self.master], [], [], .05)[0]:
                    continue
                incoming = os.read(self.master, 4096)
                buffer.extend(incoming)
                output = bytearray(incoming)  # adapter echo, even for malformed packets
                while len(buffer) >= 4:
                    if buffer[:2] != b"\xff\xff" or buffer[2] == 255 or buffer[3] < 2:
                        del buffer[0]
                        continue
                    length = buffer[3] + 4
                    if len(buffer) < length:
                        break
                    wire = bytes(buffer[:length])
                    del buffer[:length]
                    if sum(wire[2:]) & 255 != 255:
                        self.errors.append("checksum")
                        continue
                    with self.lock:
                        self.synchronize()
                        response = self.bus.handle(wire)
                        self.trace(wire, response)
                    if response:
                        output.extend(response)
                while output:
                    del output[:os.write(self.master, output)]
        except Exception as exc:
            self.errors.append(repr(exc))
            self.stop.set()

    def close(self):
        self.stop.set()
        self.thread.join(timeout=2)
        os.close(self.master)
        os.close(self.slave)
