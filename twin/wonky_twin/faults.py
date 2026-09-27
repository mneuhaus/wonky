"""Explicit seeded transport faults; accepted operations are never deduplicated."""
import random


class FaultInjector:
    def __init__(self, seed=0):
        self.seed = seed
        self.random = random.Random(seed)
        self.pending = []
        self.events = []

    def lose_next_ack(self, role="feeder", command=0x10, probability=1.0):
        self.pending.append((role, command, probability))

    def drop(self, role, request, response):
        if response is None:
            return False
        for i, (target, command, probability) in enumerate(self.pending):
            if role == target and request.command == command and not response.command & 0x80:
                self.pending.pop(i)
                draw = self.random.random()
                if draw < probability:
                    self.events.append({"kind": "lost_ack", "injected": True, "seed": self.seed,
                                        "draw": draw, "role": role, "command": command,
                                        "payload": request.payload.hex()})
                    return True
                break
        return False
