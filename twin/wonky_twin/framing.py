"""Sorter's address/command/channel/length, zlib CRC32 and COBS wire format."""
from dataclasses import dataclass
import struct
from zlib import crc32


class FrameError(ValueError):
    pass


def cobs_encode(data: bytes) -> bytes:
    result = bytearray([0])
    index, code = 0, 1
    for byte in data:
        if byte == 0:
            result[index] = code
            index = len(result)
            result.append(0)
            code = 1
        else:
            result.append(byte)
            code += 1
            if code == 255:
                result[index] = code
                index = len(result)
                result.append(0)
                code = 1
    result[index] = code
    return bytes(result)


def cobs_decode(data: bytes) -> bytes:
    result = bytearray()
    offset = 0
    while offset < len(data):
        code = data[offset]
        if code == 0 or offset + code > len(data):
            raise FrameError("Invalid COBS block")
        block = data[offset + 1:offset + code]
        if 0 in block:
            raise FrameError("Zero inside COBS block")
        result.extend(block)
        offset += code
        if code < 255 and offset < len(data):
            result.append(0)
    return bytes(result)


@dataclass(frozen=True)
class Frame:
    address: int
    command: int
    channel: int
    payload: bytes = b""
    declared_length: int | None = None

    def encode(self) -> bytes:
        if len(self.payload) > 246:
            raise FrameError("Payload exceeds 246 bytes")
        raw = bytes((self.address, self.command, self.channel, len(self.payload))) + self.payload
        return cobs_encode(raw + struct.pack("<I", crc32(raw))) + b"\0"

    @classmethod
    def decode(cls, packet: bytes) -> "Frame":
        raw = cobs_decode(packet)
        if not 8 <= len(raw) <= 254:
            raise FrameError("Frame size outside 8..254 bytes")
        if crc32(raw[:-4]) != struct.unpack("<I", raw[-4:])[0]:
            raise FrameError("CRC mismatch")
        # message.cpp validates CRC here, but dispatches the header length
        # to the command handler without comparing it to the received size.
        return cls(raw[0], raw[1], raw[2], raw[4:-4], raw[3])
