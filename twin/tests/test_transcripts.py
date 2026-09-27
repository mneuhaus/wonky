"""Command behavior through unmodified MCUBus over a real PTY.

This owns the firmware command contract, including negative validation, busy
rejection and non-idempotent retries. Snapshots observe physical effects that
GET_POSITION cannot distinguish (counter rebases). No mock motion/client.
"""

from pathlib import Path as _PublicPath
import pytest as _public_pytest
if not (_PublicPath(__file__).resolve().parents[1] / "fixtures/r20.json").is_file():
    _public_pytest.skip("local-only R20 fixtures", allow_module_level=True)

import json
import struct
import time
import pytest
from hardware.bus import MCUBus, MCUBusError
from wonky_twin.runtime import Twin


def until(predicate, timeout=4):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(.003)
    raise AssertionError("observable condition did not arrive before deadline")


class Client:
    def __init__(self, bus):
        self.bus = bus

    def send(self, command, fmt="", *args, channel=0, retries=2):
        return self.bus.send_command(0, command, channel, struct.pack("<"+fmt, *args), retries=retries).payload

    def position(self, channel=0):
        return struct.unpack("<i", self.send(0x15, channel=channel))[0]

    def stopped(self):
        return self.send(0x14) == b"\1" and self.send(0x19) == b"\0"


@pytest.fixture
def rig():
    with Twin(seed=71, reboot_seconds=.12) as twin:
        bus = MCUBus(twin.endpoints["feeder"].path, baudrate=115200)
        client = Client(bus)
        client.send(0)
        try:
            yield twin, client
        finally:
            bus.close()


@pytest.mark.parametrize("command,channel,payload,text", [
    (0x1D, 0, b"", "Invalid command 29"), (0x1E, 0, b"", "Invalid command 30"),
    (0x7F, 0, b"", "Invalid command 127"),
    (0x10, 9, b"", "MOVE_STEPS: Invalid payload length 0, expected 4"),
    (0x10, 4, struct.pack("<i", 1), "MOVE_STEPS: Invalid channel 4"),
    (0x17, 0, struct.pack("<iB?", -100, 4, False), "Invalid home pin channel 4"),
    (0x30, 4, b"", "READ: Invalid channel 4"),
    (0x31, 5, b"\1", "WRITE: Invalid channel 5"),
    (0x32, 5, b"\0\0", "WRITE_PWM: Invalid channel 5"),
    (0x40, 0, b"\0\0", "MOVE_TO: Invalid channel 0"),
    (0x41, 0, b"\0"*4, "SET_SPEED_LIMITS: Invalid channel 0"),
    (0x42, 0, b"\0"*2, "SET_ACCELERATION: Invalid channel 0"),
    (0x43, 0, b"", "GET_POSITION: Invalid channel 0"),
    (0x44, 0, b"", "IS_STOPPED: Invalid channel 0"),
    (0x45, 0, b"", "STOP: Invalid channel 0"),
    (0x46, 0, b"\1", "SET_ENABLED: Invalid channel 0"),
    (0x47, 0, b"\0"*4, "SET_DUTY_LIMITS: Invalid channel 0"),
    (0x48, 0, b"\0"*4, "MOVE_TO_AND_RELEASE: Invalid channel 0"),
])
def test_firmware_nack_text_and_no_retry(rig, command, channel, payload, text):
    twin, client = rig
    before = len(twin.trace)
    with pytest.raises(MCUBusError) as caught:
        client.bus.send_command(0, command, channel, payload)
    assert str(caught.value) == f"Error response received, command: {command | 0x80:#04x}, payload: {text.encode()!r}"
    assert len(twin.trace) == before + 1


@pytest.mark.parametrize("microsteps", [1, 2, 4, 8, 16, 32, 64, 128, 256, 0, 3, 257, 65535])
def test_microsteps_validity_and_physical_scaling(rig, microsteps):
    twin, client = rig
    if microsteps not in (1, 2, 4, 8, 16, 32, 64, 128, 256):
        with pytest.raises(MCUBusError, match=f"Invalid microstep value {microsteps}"):
            client.send(0x21, "H", microsteps)
        return
    start = twin.snapshot()["joints"]["feed"]["value_mm"]
    client.send(0x21, "H", microsteps)
    assert twin.snapshot()["joints"]["feed"]["value_mm"] == start
    assert client.send(0x10, "i", microsteps * 2) == b"\1"
    until(client.stopped)
    assert client.position() == microsteps * 2
    # 1% of a 36mm pitch circle: independent rack/pinion geometry.
    assert twin.snapshot()["joints"]["feed"]["value_mm"] - start == pytest.approx(1.1309733552923256)


def test_busy_reject_trapezoid_and_counter_rebase(rig):
    twin, client = rig
    client.send(0x12, "II", 100, 1000)
    client.send(0x13, "I", 2000)
    start = twin.snapshot()["joints"]["feed"]["value_mm"]
    assert client.send(0x10, "i", 500) == b"\1"
    assert client.send(0x10, "i", 999) == b"\0"
    observed = []
    while not client.stopped():
        snap = twin.snapshot()
        observed.append((snap["sim_ns"], snap["boards"]["feeder"]["steppers"][0]))
        time.sleep(.004)
    assert client.position() == 500
    states = {sample["state"] for _, sample in observed}
    assert {"ACCELERATING", "CRUISING", "BRAKING"} <= states
    assert max(s["speed"] for _, s in observed) == 1000
    accelerating = [(t, s["speed"]) for t, s in observed if s["state"] == "ACCELERATING"]
    t0, v0 = accelerating[0]
    t1, v1 = accelerating[-1]
    # Snapshot time now includes the partial tick; acceleration is still
    # applied only at whole 1ms firmware motion boundaries.
    assert v1 - v0 == (t1 // 1_000_000 - t0 // 1_000_000) * 2
    # Physical position follows pulses, not the writable absolute counter.
    end = twin.snapshot()["joints"]["feed"]["value_mm"]
    assert end - start == pytest.approx(35.34291735288517)
    client.send(0x16, "i", -12345)
    assert client.position() == -12345
    assert twin.snapshot()["joints"]["feed"]["value_mm"] == end
    client.send(0)
    assert twin.snapshot()["joints"]["feed"]["value_mm"] == end


def test_speed_clamp_invalid_limits_reversal_and_brake_stop(rig):
    twin, client = rig
    client.send(0x12, "II", 16, 99000)
    client.send(0x12, "II", 40, 20)  # ACK but ignored by firmware.
    state = twin.snapshot()["boards"]["feeder"]["steppers"][0]
    assert (state["min_speed"], state["max_speed"]) == (16, 60000)
    client.send(0x13, "I", 1000000)
    client.send(0x11, "i", 100000)
    until(lambda: twin.snapshot()["boards"]["feeder"]["steppers"][0]["speed"] == 60000)
    client.send(0x13, "I", 100000)
    before = client.position()
    assert client.send(0x11, "i", -1000) == b"\1"
    state = twin.snapshot()["boards"]["feeder"]["steppers"][0]
    assert state["state"] == "BRAKING" and state["direction"] == 1
    time.sleep(.015)
    assert client.position() > before
    until(lambda: twin.snapshot()["boards"]["feeder"]["steppers"][0]["direction"] == -1)
    peak = client.position()
    until(lambda: client.position() < peak - 10)
    assert client.send(0x11, "i", 0) == b"\1"
    until(client.stopped)
    settled = client.position()
    time.sleep(.02)
    assert client.position() == settled


@pytest.mark.parametrize("role,pin,trip", [("feeder", 2, "feed"), ("distribution", 3, "chute")])
def test_home_active_low_sensor_stops_and_zeros(rig, role, pin, trip):
    twin, feeder = rig
    bus = MCUBus(twin.endpoints[role].path, baudrate=115200) if role != "feeder" else None
    client = Client(bus) if bus else feeder
    try:
        assert client.send(0x30, channel=pin) == b"\1"
        client.send(0x17, "iB?", -1500, pin, False)
        until(client.stopped)
        assert client.position() == 0
        assert client.send(0x30, channel=pin) == b"\0"
        snap = twin.snapshot()
        stepper = snap["boards"][role]["steppers"][0]
        assert stepper["position_reset"] and stepper["position_reset_ns"] is not None
        unit = "value_mm" if trip == "feed" else "value_deg"
        assert -.08 <= snap["joints"][trip][unit] <= 0
        # Back away from switch: pin release is from mechanics, not a HOME ack.
        client.send(0x10, "i", 40)
        until(client.stopped)
        assert client.send(0x30, channel=pin) == b"\1"
    finally:
        if bus:
            bus.close()


def test_home_active_high_and_wrong_polarity_does_not_teleport(rig):
    twin, client = rig
    before = twin.snapshot()["joints"]["feed"]["value_mm"]
    client.send(0x17, "iB?", -500, 2, True)  # Initially open/high: immediate trip.
    until(client.stopped)
    assert client.position() == 0
    assert twin.snapshot()["joints"]["feed"]["value_mm"] == before
    client.send(0x17, "iB?", -500, 1, False)  # Unbound pulled-up input never trips.
    until(lambda: client.position() < -20)
    assert client.send(0x14) == b"\0"
    assert not twin.snapshot()["boards"]["feeder"]["steppers"][0]["position_reset"]
    client.send(0x11, "i", 0)
    until(client.stopped)


def test_jitter_zero_net_and_blocks_stop_then_restores_limits(rig):
    twin, client = rig
    before = twin.snapshot()["joints"]["feed"]["value_mm"]
    client.send(0x12, "II", 16, 400)
    client.send(0x13, "I", 2500)
    assert client.send(0x18, "iiii", 40, 2, 2000, 50000) == b"\1"
    assert client.send(0x19) == b"\1"
    assert client.send(0x11, "i", 0) == b"\0"
    assert client.send(0x10, "i", 20) == b"\0"
    assert client.send(0x18, "iiii", 40, 2, 2000, 50000) == b"\0"
    until(lambda: client.position() > 0)
    until(client.stopped)
    assert client.position() == 0
    assert twin.snapshot()["joints"]["feed"]["value_mm"] == pytest.approx(before)
    state = twin.snapshot()["boards"]["feeder"]["steppers"][0]
    assert (state["max_speed"], state["acceleration"]) == (400, 2500)
    assert client.send(0x18, "iiii", 0, 2, 2000, 50000) == b"\0"
    # Firmware continues pulsing after current-off, but the ideal friction-held
    # plant must not follow those pulses. No speed command: even a rejected
    # speed command re-energizes the driver in the firmware handler.
    assert client.send(0x18, "iiii", 100, 1, 200, 1000) == b"\1"
    until(lambda: client.position() > 5)
    client.send(0x20, "?", False)
    held = twin.snapshot()["joints"]["feed"]["value_mm"]
    until(client.stopped)
    assert client.position() == 0
    assert twin.snapshot()["joints"]["feed"]["value_mm"] == held
    assert not twin.snapshot()["boards"]["feeder"]["steppers"][0]["enabled"]


def test_register_current_stall_and_enable(rig):
    twin, client = rig
    def read_register(address):
        return struct.unpack("<I", client.send(0x28, "B", address))[0]

    # Firmware TMC2209 defaults, then INIT selects eighth-steps. nEN is
    # disabled independently; INIT leaves the chopper on (TOFF=3).
    assert read_register(0) == 0x1C0
    assert read_register(0x6C) == 0x150100C3
    for microsteps, mres in ((256, 0), (1, 8), (8, 5)):
        client.send(0x21, "H", microsteps)
        assert read_register(0x6C) == 0x100100C3 | (mres << 24)
    client.send(0x20, "?", False)
    assert read_register(0x6C) == 0x150100C0
    client.send(0x20, "?", True)
    assert read_register(0x6C) == 0x150100C3
    # Raw writes do not mutate TMC2209.cpp's cached _chopconf. Its next
    # configuration write restores that shadow, not a hardware readback.
    client.send(0x29, "BI", 0x6C, 0xAABBCCDD)
    client.send(0x21, "H", 16)
    assert read_register(0x6C) == 0x140100C3
    client.send(0)
    assert read_register(0) == 0x1C0 and read_register(0x6C) == 0x150100C3
    for register, value in [(0x40, 120), (0x14, 100000), (0x6C, 0xAABBCCDD)]:
        client.send(0x29, "BI", register, value)
        assert struct.unpack("<I", client.send(0x28, "B", register))[0] == value
    client.send(0x22, "BBB", 20, 10, 4)
    assert struct.unpack("<I", client.send(0x28, "B", 0x10))[0] == 0x4140A
    # TMC2209.cpp masks IHOLDDELAY to four bits, currents to five.
    client.send(0x22, "BBB", 255, 255, 255)
    assert struct.unpack("<I", client.send(0x28, "B", 0x10))[0] == 0xF1F1F
    client.send(0x1A, "?", True)
    assert client.send(0x1B, channel=3) == b"\0"
    client.send(0x1C)
    assert client.send(0x1B) == b"\0"
    observability = json.loads(client.send(3))
    assert observability["hw"] == "skr_pico" and observability["diag_pins"] == [-1] * 4
    assert observability["soft_sg"][0]["c"] == 0
    client.send(0x20, "?", False)
    assert not twin.snapshot()["boards"]["feeder"]["steppers"][0]["enabled"]
    client.send(0x10, "i", 10)
    until(client.stopped)
    assert read_register(0x6C) == 0x150100C3
    assert twin.snapshot()["boards"]["feeder"]["steppers"][0]["enabled"]
    assert client.position() == 10
    client.send(0)
    assert read_register(0x40) == 120  # INIT writes defaults, not a register-file reset.


def test_outputs_pwm_init_and_unbound_counters(rig):
    twin, client = rig
    for ch in range(5):
        client.send(0x32, "H", 12345 + ch, channel=ch)
    assert twin.snapshot()["boards"]["feeder"]["outputs"] == list(range(12345, 12350))
    client.send(0x31, "?", True, channel=1)
    assert twin.snapshot()["boards"]["feeder"]["outputs"][1] == 65535
    assert twin.snapshot()["boards"]["feeder"]["output_modes"][1] == "digital"
    client.send(0)
    assert twin.snapshot()["boards"]["feeder"]["outputs"] == [0, 0, 65535, 0, 0]
    assert twin.snapshot()["boards"]["feeder"]["output_modes"] == ["digital"] * 5
    before = twin.snapshot()["joints"]
    for ch in (1, 2, 3):
        assert client.send(0x10, "i", 10, channel=ch) == b"\1"
        until(lambda: client.send(0x14, channel=ch) == b"\1")
        assert client.position(ch) == 10
    assert twin.snapshot()["joints"] == before


def test_lost_ack_retries_execute_move_twice(rig, caplog):
    twin, client = rig
    with twin.lock:
        twin.faults.lose_next_ack()
    assert client.send(0x10, "i", 4) == b"\1"
    until(client.stopped)
    assert client.position() == 8  # Not 4: no dedup/sequence number on real MCU.
    assert len([e for e in twin.trace if e["command"] == 0x10]) == 2
    assert twin.faults.events[0]["seed"] == 71
    assert "Timeout waiting for response" in caplog.text


def test_reboot_no_reply_offline_then_responds(rig):
    twin, client = rig
    client.send(0x10, "i", 20)
    until(client.stopped)
    pose = twin.snapshot()["joints"]["feed"]["value_mm"]
    assert client.position() == 20
    client.bus.send_command_no_response(0, 2, 0)
    until(lambda: twin.snapshot()["boards"]["feeder"]["offline"])
    client.bus._serial.timeout = .025
    with pytest.raises(MCUBusError, match="Timeout"):
        client.send(1, retries=0)
    until(lambda: not twin.snapshot()["boards"]["feeder"]["offline"])
    assert client.send(1) == b""
    assert client.position() == 0
    assert client.stopped()
    assert twin.snapshot()["joints"]["feed"]["value_mm"] == pose


def test_override_never_enumerates_usb(rig, monkeypatch):
    import serial.tools.list_ports
    twin, _ = rig
    ports = [endpoint.path for endpoint in twin.endpoints.values()]
    monkeypatch.setenv("SORTER_MCU_PORTS", ",".join(ports))
    monkeypatch.setenv("SORTER_MCU_BAUD", "115200")
    def forbidden():
        raise AssertionError("USB enumeration must not be called")
    monkeypatch.setattr(serial.tools.list_ports, "comports", forbidden)
    assert MCUBus.enumerate_buses() == ports
    for port in MCUBus.enumerate_buses():
        bus = MCUBus(port)
        try:
            assert bus.send_command(0, 1, 0, b"no-usb").payload == b"no-usb"
        finally:
            bus.close()


def test_home_pin_cannot_lead_stop_by_more_than_one_firmware_poll():
    # Constant 1000 steps/s crosses on the last pulse of a 1ms batch.
    # The old batching exposed the active pin for nearly a full ms before
    # home_check. Exercise both real board PTYs; no scheduler or pin mock.
    with Twin(initial_feed_mm=.02, initial_chute_deg=.02) as twin:
        for role, pin in (("feeder", 2), ("distribution", 3)):
            bus = MCUBus(twin.endpoints[role].path, baudrate=115200)
            client = Client(bus)
            try:
                client.send(0)
                client.send(0x12, "II", 1000, 1000)
                client.send(0x13, "I", 0)
                for attempt in range(20):
                    assert client.send(0x30, channel=pin) == b"\1"
                    client.send(0x17, "iB?", -1000, pin, False)
                    deadline = time.monotonic() + 2
                    while client.send(0x30, channel=pin) != b"\0":
                        assert time.monotonic() < deadline
                    # A read already observed the active pin. The firmware's
                    # next 10kHz check must stop within 100us, not 1ms. Sleeping
                    # longer only makes this assertion more conservative.
                    time.sleep(.00015)
                    assert client.send(0x14) == b"\1", (role, attempt)
                    assert client.position() == 0
                    client.send(0x10, "i", 2)
                    until(client.stopped)
            finally:
                bus.close()
