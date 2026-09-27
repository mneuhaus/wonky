"""Real raw PTYs, bounded framing, explicit transport lifetime."""
import os
import select
import threading
import tty
from .framing import Frame, FrameError


class PTYBoard:
    def __init__(self, board, lock=None, faults=None, trace=None, synchronize=None):
        self.board = board
        self.lock = lock or threading.RLock()
        self.faults = faults
        self.trace = trace
        self.synchronize = synchronize
        self.master, self.slave = os.openpty()
        tty.setraw(self.master)
        tty.setraw(self.slave)
        self.path = os.ttyname(self.slave)
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._run, name=f"pty-{board.role}", daemon=True)
        self.errors = []
        self.thread.start()

    def _run(self):
        buffer = bytearray()
        try:
            while not self.stop.is_set():
                if not select.select([self.master], [], [], 0.05)[0]:
                    continue
                for byte in os.read(self.master, 4096):
                    if byte:
                        if len(buffer) < 255:
                            buffer.append(byte)
                        else:
                            # Firmware discards the overflowing byte and
                            # immediately starts collecting a new fragment.
                            buffer.clear()
                        continue
                    if len(buffer) < 8:
                        # Firmware returns before resetting rx_buffer_pos.
                        # A short garbage fragment poisons the next frame.
                        continue
                    packet = bytes(buffer)
                    buffer.clear()
                    try:
                        request = Frame.decode(packet)
                    except FrameError as exc:
                        self.errors.append(str(exc))
                        continue
                    with self.lock:
                        if self.synchronize:
                            self.synchronize()
                        response = self.board.handle(request)
                        # Firmware COBS_encode accepts <=253 raw bytes, even
                        # though the receive buffer allows 254 (246 payload).
                        if response is not None and len(response.payload) > 245:
                            response = None
                        if self.trace:
                            self.trace(self.board.role, request, response)
                        drop = self.faults and self.faults.drop(self.board.role, request, response)
                    if response is not None and not drop:
                        wire = response.encode()
                        while wire:
                            wire = wire[os.write(self.master, wire):]
        except Exception as exc:
            self.errors.append(repr(exc))
            self.stop.set()

    def close(self):
        self.stop.set()
        self.thread.join(timeout=2)
        os.close(self.master)
        os.close(self.slave)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
