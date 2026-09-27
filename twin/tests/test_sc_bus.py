"""SC wire/kinematic contracts through the unmodified pinned ScServoBus.

Owner: real PTY transactions. Regressions: wrong endianness/echo, target-as-
feedback, resetting a retarget from the old goal, torque teleporting the tray,
ignored fault injection. Pico coverage cannot detect any of these. No backend
mock or test-only production seam; fault injection is the operator facility.
"""

from pathlib import Path as _PublicPath
import pytest as _public_pytest
if not (_PublicPath(__file__).resolve().parents[1] / "fixtures/r20.json").is_file():
    _public_pytest.skip("local-only R20 fixtures", allow_module_level=True)

import time

import pytest
import serial
from hardware.waveshare_servo import ScServoBus, WaveshareServoMotor

from wonky_twin.runtime import Twin
from wonky_twin.sc_trace import check_trace


def observe(twin):
    with twin.lock:
        return check_trace(list(twin.sc_trace), list(twin.sc.samples), twin.sc.snapshot()["servos"])


@pytest.mark.parametrize("tray_id,model,scale", [(2, 9, 1023 / 300), (17, 15, 1023 / 210)])
def test_sc_discovery_interpolation_retarget_and_torque_policy(tray_id, model, scale):
    with Twin(tray_id=tray_id) as twin:
        bus = ScServoBus(twin.sc_endpoint.path, baudrate=115200, timeout=.01)
        try:
            assert bus.scan(1, 18) == sorted([tray_id, 15, 16, 18])
            assert bus.read_model(tray_id) == model
            assert bus.read_model(18) == 15
            motor = WaveshareServoMotor(bus, tray_id)
            motor.initialize()  # EEPROM + PID round trip through the real driver
            assert bus.set_torque(tray_id, True)
            assert bus.move_to(tray_id, round(700 - 80 * scale), 400)
            positions = []
            for _ in range(12):
                positions.append(bus.read_position(tray_id))
                time.sleep(.005)
            assert 700 > positions[-1] > round(700 - 80 * scale)
            assert positions[-1] < positions[0]
            assert bus.is_moving(tray_id)
            # Retarget from an in-flight pose, not the old endpoint.
            assert bus.move_to(tray_id, 700, 100)
            time.sleep(.025)
            assert positions[-1] < bus.read_position(tray_id) < 700
            assert bus.set_torque(tray_id, False)
            held = bus.read_position(tray_id)
            time.sleep(.13)
            assert bus.read_position(tray_id) == held
            assert not bus.is_moving(tray_id)
            # R20 -135° is representable to half a count even on SC15. Refuse
            # the next count beyond its hard limit, not the rounded endpoint.
            limit = round(700 - 135 * scale)
            assert bus.set_torque(tray_id, True)
            assert bus.move_to(tray_id, limit, 50)
            assert bus.last_status_flags(tray_id) == 0
            time.sleep(.07)
            assert bus.read_position(tray_id) == limit
            bus.move_to(tray_id, limit - 1, 50)
            assert bus.last_status_flags(tray_id) == 2
            assert bus.read_position(tray_id) == limit
            assert bus.set_torque(18, True)
            assert bus.move_to(18, 527, 200)
            time.sleep(.055)
            assert 40 < bus.read_position(18) < 527
            assert bus.set_torque(18, False)
            assert bus.read_position(18) == 40  # declared gravity-home exception
            snap = twin.snapshot()
            assert snap["joints"]["rock"]["servo_id"] == tray_id
            assert snap["joints"]["return"]["value_deg"] == 0
            evidence = observe(twin)
            assert evidence["in_flight_position_reads"] > 3, evidence
            assert evidence["interpolation_ok"], evidence
            # These independent motions intentionally break coupling; the
            # checker must flag it, not mistake faithful interpolation for safety.
            assert not evidence["coupling_ok"] and evidence["coupling_violations"] > 0
            assert not twin.sc_endpoint.errors
        finally:
            bus.close()


def test_fault_packets_refuse_motion_and_uncalibrated_layer_is_offline():
    with Twin() as twin:
        bus = ScServoBus(twin.sc_endpoint.path, baudrate=115200, timeout=.01)
        try:
            bus.set_torque(2, True)
            with twin.lock:
                twin.sc.inject(2, "nack_goal")
            # ScServoBus's status flags are not boolean success. Inspect the
            # actual refusal and unmoved pose, not the driver's misleading bool.
            bus.move_to(2, 500, 100)
            assert bus.last_status_flags(2) == 0x02
            assert bus.read_position(2) == 700
            with twin.lock:
                twin.sc.inject(2, "no_reply_goal", count=3)
                before = len(twin.sc_trace)
            assert not bus.move_to(2, 500, 100)
            with twin.lock:
                goals = [e for e in list(twin.sc_trace)[before:] if e["instruction"] == 3]
            assert len(goals) == 3 and all(e["response"] is None for e in goals)
            assert bus.read_position(2) == 700
            with twin.lock:
                twin.sc.inject(15, "uncalibrated")
            with pytest.raises(RuntimeError, match="not calibrated"):
                WaveshareServoMotor(bus, 15).initialize()
            assert bus.read_angle_limits(15) == (500, 520)
        finally:
            bus.close()


def test_fragmented_wire_echo_bad_checksum_and_recovery():
    # Independent literal packets: PING id 2, then READ present position.
    ping = bytes.fromhex("ff ff 02 02 01 fa")
    read = bytes.fromhex("ff ff 02 04 02 38 02 bd")
    with Twin() as twin, serial.Serial(twin.sc_endpoint.path, 115200, timeout=.2) as port:
        for fragment in (ping[:1], ping[1:4], ping[4:]):
            port.write(fragment)
            assert port.read(len(fragment)) == fragment
        assert port.read(6) == bytes.fromhex("ff ff 02 02 00 fb")
        bad = read[:-1] + b"\x00"
        port.write(bad)
        assert port.read(len(bad)) == bad
        assert port.read(1) == b""
        port.write(read)
        assert port.read(len(read)) == read
        assert port.read(8) == bytes.fromhex("ff ff 02 04 00 02 bc 3b")
        assert list(twin.sc_endpoint.errors) == ["checksum"]
