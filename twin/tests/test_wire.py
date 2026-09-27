"""Primary owner of framing/PTY lifecycle and backend identity compatibility.
Regressions: mismatched COBS/CRC, echo loss, oversized INIT, USB fallback.
No test-only production seams: real endpoint and public MCUBus API.
"""
import json
import struct
from zlib import crc32
import pytest
pytest.importorskip('hardware', reason='local-only fixture: pinned independent wire client unavailable')
from hardware.bus import MCUBus, MCUBusError
from hardware import cobs
from wonky_twin.board import Board
from wonky_twin.framing import Frame, FrameError
from wonky_twin.transport import PTYBoard


@pytest.mark.parametrize("role,device,first", [("feeder", "FEEDER MB", "c_channel_1_rotor"),
                                             ("distribution", "DISTRIBUTION MB", "chute_stepper")])
def test_backend_pty_spike(role, device, first):
    with PTYBoard(Board(role, "65472c9d")) as endpoint:
        bus = MCUBus(endpoint.path, baudrate=115200)
        try:
            assert bus.send_command(0, 1, 0, b"hello\0twin").payload == b"hello\0twin"
            info = json.loads(bus.send_command(0, 0, 0, b"").payload)
            assert info["device_name"] == device
            assert len(info["stepper_names"]) == info["stepper_count"] == 4
            assert info["stepper_names"][0] == first
            version = json.loads(bus.send_command(0, 4, 0, b"").payload)
            assert version["variant"] == role + "-skr"
            assert version["commit"] == "twin-65472c9d"
        finally:
            bus.close()


@pytest.mark.parametrize("payload", [b"", b"\0", bytes(range(246)), b"a" * 246])
def test_framing_against_backend(payload):
    raw = bytes([0, 1, 3, len(payload)]) + payload
    expected = bytes(cobs.encode(raw + struct.pack("<I", crc32(raw)))) + b"\0"
    assert Frame(0, 1, 3, payload).encode() == expected
    assert Frame.decode(expected[:-1]).payload == payload
    assert bytes(cobs.decode(expected[:-1])) == raw + struct.pack("<I", crc32(raw))


def test_bad_crc_and_other_address_are_silent_then_resynchronize():
    with PTYBoard(Board("feeder")) as endpoint:
        bus = MCUBus(endpoint.path, baudrate=115200, timeout=0.04)
        try:
            raw = b"\0\1\0\0" + struct.pack("<I", 0xDEADBEEF)
            bus._serial.write(bytes(cobs.encode(raw)) + b"\0")
            assert bus._serial.read(1) == b""
            with pytest.raises(MCUBusError, match="Timeout"):
                bus.send_command(1, 1, 0, b"", retries=0)
            assert bus.send_command(0, 1, 0, b"alive").payload == b"alive"
            assert "CRC mismatch" in endpoint.errors
        finally:
            bus.close()


@pytest.mark.parametrize("fragment", [b"\x02", b"garbage"])
def test_short_fragment_consumes_next_valid_frame_then_recovers(fragment):
    # message.cpp returns before resetting rx_buffer_pos for <8 bytes.
    with PTYBoard(Board("feeder")) as endpoint:
        bus = MCUBus(endpoint.path, baudrate=115200, timeout=.03)
        try:
            bus._serial.write(fragment + b"\0\0")
            with pytest.raises(MCUBusError, match="Timeout"):
                bus.send_command(0, 1, 0, b"lost", retries=0)
            assert bus.send_command(0, 1, 0, b"recovered", retries=0).payload == b"recovered"
        finally:
            bus.close()


@pytest.mark.parametrize("command,payload,declared,expected", [
    (0x10, b"\1\0\0\0", 3, "MOVE_STEPS: Invalid payload length 3, expected 4"),
    (1, b"abcdef", 3, b"abc"),
    (1, b"abc", 6, "Invalid payload length"),
])
def test_header_length_reaches_handler_instead_of_silent_drop(command, payload, declared, expected):
    # MCUBus still owns framing/CRC and the actual PTY round trip. Only the
    # payload's reported length is corrupt, to inject a wire header mismatch.
    class HeaderLengthPayload(bytes):
        def __len__(self):
            return declared

    with PTYBoard(Board("feeder")) as endpoint:
        bus = MCUBus(endpoint.path, baudrate=115200, timeout=.03)
        try:
            if isinstance(expected, str):
                with pytest.raises(MCUBusError, match=expected):
                    bus.send_command(0, command, 0, HeaderLengthPayload(payload), retries=0)
            else:
                assert bus.send_command(0, command, 0, HeaderLengthPayload(payload), retries=0).payload == expected
            assert bus.send_command(0, 1, 0, b"alive", retries=0).payload == b"alive"
        finally:
            bus.close()


def test_ping_246_bytes_has_no_firmware_reply():
    with PTYBoard(Board("feeder")) as endpoint:
        bus = MCUBus(endpoint.path, baudrate=115200, timeout=.03)
        try:
            assert bus.send_command(0, 1, 0, b"a" * 244, retries=0).payload == b"a" * 244
            # Firmware COBS_encode rejects raw size 254 (header+246+CRC),
            # rather than sending a frame the backend then rejects as large.
            with pytest.raises(MCUBusError, match="Timeout"):
                bus.send_command(0, 1, 0, b"a" * 246, retries=0)
            assert bus.send_command(0, 1, 0, b"alive", retries=0).payload == b"alive"
        finally:
            bus.close()


def test_frame_limits_and_malformed_cobs():
    with pytest.raises(FrameError, match="246"):
        Frame(0, 1, 0, b"x" * 247).encode()
    with pytest.raises(FrameError, match="COBS"):
        Frame.decode(b"\x05x")
