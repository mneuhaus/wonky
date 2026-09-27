"""SKR Pico endpoint: validation order and texts match the pinned firmware."""
import json
import struct
import time
from .framing import Frame
from .motion import Stepper

NAMES = {
    "feeder": ["c_channel_1_rotor", "c_channel_2_rotor", "c_channel_3_rotor", "carousel"],
    "distribution": ["chute_stepper", "distribution_aux_1", "distribution_aux_2", "distribution_aux_3"],
}
INPUT_PINS = (4, 3, 25, 16)
OUTPUT_PINS = (21, 23, 17, 18, 20)
# (name, request struct format or None for variable length, channel count)
COMMANDS = {
    0x00: ("INIT", "", None), 0x01: ("PING", None, None),
    0x02: ("REBOOT_BOOTLOADER", "", None), 0x03: ("GET_OBSERVABILITY", "", None),
    0x04: ("GET_VERSION", "", None),
    0x10: ("MOVE_STEPS", "i", 4), 0x11: ("MOVE_AT_SPEED", "i", 4),
    0x12: ("SET_SPEED_LIMITS", "II", 4), 0x13: ("SET_ACCELERATION", "I", 4),
    0x14: ("IS_STOPPED", "", 4), 0x15: ("GET_POSITION", "", 4),
    0x16: ("SET_POSITION", "i", 4), 0x17: ("HOME", "iB?", 4),
    0x18: ("JITTER", "iiii", 4), 0x19: ("IS_JITTERING", "", 4),
    0x1A: ("ENABLE_STALL_DETECTION", "?", 4), 0x1B: ("GET_STALL_STATUS", "", 4),
    0x1C: ("CLEAR_STALL", "", 4), 0x20: ("SET_ENABLED", "?", 4),
    0x21: ("SET_MICROSTEPS", "H", 4), 0x22: ("SET_CURRENT", "BBB", 4),
    0x28: ("READ_REGISTER", "B", 4), 0x29: ("WRITE_REGISTER", "BI", 4),
    0x30: ("READ", "", 4), 0x31: ("WRITE", "?", 5), 0x32: ("WRITE_PWM", "H", 5),
    0x40: ("MOVE_TO", "H", 0), 0x41: ("SET_SPEED_LIMITS", "HH", 0),
    0x42: ("SET_ACCELERATION", "H", 0), 0x43: ("GET_POSITION", "", 0),
    0x44: ("IS_STOPPED", "", 0), 0x45: ("STOP", "", 0),
    0x46: ("SET_ENABLED", "?", 0), 0x47: ("SET_DUTY_LIMITS", "HH", 0),
    0x48: ("MOVE_TO_AND_RELEASE", None, 0),
}


def json_bytes(value):
    return json.dumps(value, separators=(",", ":")).encode()


class Board:
    def __init__(self, role, revision="dev", reboot_seconds=1.0):
        self.role = role
        self.revision = revision
        self.reboot_seconds = reboot_seconds
        self.offline_until = 0.0
        self.steppers = [Stepper(name) for name in NAMES[role]]
        self.inputs = [1] * 4
        self.outputs = [0, 0, 65535, 0, 0]
        self.output_modes = ["digital"] * 5
        self.initialize()

    def initialize(self):
        # initialize_hardware changes configuration, not absolute position or
        # actual pose (Stepper::initialize itself only configures GPIO).
        for stepper in self.steppers:
            stepper.set_limits(16, 4000)
            stepper.acceleration = 20000
            stepper.initialize_driver()
            stepper.stall_enabled = False
        self.outputs[:] = [0, 0, 65535, 0, 0]
        self.output_modes[:] = ["digital"] * 5

    def handle(self, request):
        if request.address != 0 or time.monotonic() < self.offline_until:
            return None
        command, channel, payload = request.command, request.channel, request.payload
        length = request.declared_length if request.declared_length is not None else len(payload)

        def reply(data=b"", error=False):
            return Frame(0, command | (0x80 if error else 0), channel, data)

        def nack(message):
            return reply(message.encode("ascii"), True)

        # The firmware masks bit 7 when selecting the dispatch table.
        opcode = command & 0x7F
        entry = COMMANDS.get(opcode)
        if entry is None:
            return nack(f"Invalid command {command}")
        name, fmt, count = entry
        if fmt is not None and length != struct.calcsize("<" + fmt):
            return nack(f"{name}: Invalid payload length {length}, expected {struct.calcsize('<' + fmt)}")
        if count is not None and channel >= count:
            return nack(f"{name}: Invalid channel {channel}")
        if length > len(payload):
            # Firmware can over-read CRC/stale receive-buffer bytes here.
            # Refuse explicitly rather than invent unspecified payload data.
            return nack(f"{name}: Invalid payload length {length}, received {len(payload)}")
        payload = payload[:length]
        args = struct.unpack("<" + fmt, payload) if fmt is not None else ()
        s = self.steppers[channel] if 0x10 <= opcode <= 0x29 else None
        if opcode == 0:
            self.initialize()
            return reply(json_bytes({"device_name": "FEEDER MB" if self.role == "feeder" else "DISTRIBUTION MB",
                "stepper_count": 4, "stepper_names": NAMES[self.role], "digital_input_count": 4,
                "digital_output_count": 5, "servo_count": 0}))
        if opcode == 1:
            return reply(payload)
        if opcode == 2:
            self.offline_until = time.monotonic() + self.reboot_seconds
            # Fresh static firmware state, but no mechanical teleport.
            self.steppers[:] = [Stepper(s.name, revolutions=s.revolutions) for s in self.steppers]
            self.initialize()
            return None
        if opcode == 3:
            soft = [{"c": i, "p": 0, "l": 0, "t": 0, "s": 0, "g": 0}
                    for i, stepper in enumerate(self.steppers) if stepper.stall_enabled]
            data = {"hw": "skr_pico", "diag_pins": [-1] * 4, "led_gpios": [], "soft_sg": soft}
            if len(json_bytes(data)) >= 246:
                data["soft_sg"] = []
            return reply(json_bytes(data))
        if opcode == 4:
            return reply(json_bytes({"firmware_version": "wonky-twin/0.1", "variant": self.role + "-skr",
                                    "commit": "twin-" + self.revision, "build_time_utc": "not-firmware"}))
        if opcode in (0x10, 0x11, 0x18):
            s.set_enabled(True)
            accepted = {0x10: s.move_steps, 0x11: s.move_at_speed, 0x18: s.jitter}[opcode](*args)
            return reply(bytes([accepted]))
        if opcode == 0x12:
            s.set_limits(*args)
        elif opcode == 0x13:
            s.acceleration = args[0]
        elif opcode == 0x14:
            return reply(bytes([s.state == "STOPPED"]))
        elif opcode == 0x15:
            return reply(struct.pack("<i", s.position))
        elif opcode == 0x16:
            s.position = args[0]
        elif opcode == 0x17:
            speed, pin, polarity = args
            if pin >= 4:
                return nack(f"Invalid home pin channel {pin}")
            s.set_enabled(True)
            s.move_at_speed(speed)
            s.home_channel, s.home_active_high = pin, polarity
            s.position_reset = False
        elif opcode == 0x19:
            return reply(bytes([s.jittering]))
        elif opcode == 0x1A:
            s.stall_enabled = args[0]
        elif opcode == 0x1B:
            return reply(b"\0")  # Explicit ideal-drive model, not real torque sensing.
        elif opcode == 0x1C:
            pass  # No stalled latch in an ideal drive.
        elif opcode == 0x20:
            s.set_enabled(args[0])
        elif opcode == 0x21:
            value = args[0]
            if value < 1 or value > 256 or value & (value - 1):
                return nack(f"Invalid microstep value {value}")
            s.set_microsteps(value)
        elif opcode == 0x22:
            s.current = (args[0] & 31, args[1] & 31, args[2] & 15)
            s.registers[0x10] = s.current[1] | (s.current[0] << 8) | (s.current[2] << 16)
        elif opcode == 0x28:
            return reply(struct.pack("<I", s.registers.get(args[0], 0)))
        elif opcode == 0x29:
            s.registers[args[0]] = args[1]
        elif opcode == 0x30:
            return reply(bytes([self.inputs[channel]]))
        elif opcode == 0x31:
            self.outputs[channel] = 65535 if args[0] else 0
            self.output_modes[channel] = "digital"
        elif opcode == 0x32:
            self.outputs[channel] = args[0]
            self.output_modes[channel] = "pwm"
        return reply()

    def snapshot(self):
        return {"steppers": [s.snapshot() for s in self.steppers], "inputs": list(self.inputs),
                "outputs": list(self.outputs), "output_modes": list(self.output_modes),
                "input_gpios": INPUT_PINS, "output_gpios": OUTPUT_PINS,
                "offline": time.monotonic() < self.offline_until}
