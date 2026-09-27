"""Kinematics from frozen R20 provenance; unbound axes remain counters."""
import hashlib
import json
import math
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


class Plant:
    def __init__(self, boards, initial_feed_mm=10.0, initial_chute_deg=10.0,
                 feed_trip_mm=0.0, chute_trip_deg=0.0, feed_sign=1, chute_sign=1):
        if not all((FIXTURES / name).is_file() for name in ("r20.json", "r20-motion.json")):
            raise FileNotFoundError("local-only R20 fixtures")
        provenance = json.loads((FIXTURES / "provenance.json").read_text())
        for source in provenance["sources"]:
            if hashlib.sha256((FIXTURES / source["file"]).read_bytes()).hexdigest() != source["sha256"]:
                raise ValueError(f"Fixture hash mismatch: {source['file']}")
        motion = json.loads((FIXTURES / "r20-motion.json").read_text())
        params = json.loads((FIXTURES / "r20.json").read_text())
        gear = params["fixed"]["gear_rack_pinion"]
        self.travel_per_rev_mm = math.pi * gear["module"]["value"] * gear["pinion_teeth"]["value"]
        self.feed_spec = motion["joints"]["feed"]
        self.boards = boards
        self.initial_feed_mm, self.initial_chute_deg = initial_feed_mm, initial_chute_deg
        self.feed_trip_mm, self.chute_trip_deg = feed_trip_mm, chute_trip_deg
        self.feed_sign, self.chute_sign = feed_sign, chute_sign
        self.update_sensors()

    @property
    def feed_mm(self):
        return self.initial_feed_mm + self.feed_sign * self.boards["feeder"].steppers[0].revolutions * self.travel_per_rev_mm

    @property
    def chute_deg(self):
        return self.initial_chute_deg + self.chute_sign * self.boards["distribution"].steppers[0].revolutions * 360 / (120 / 25)

    def update_sensors(self):
        self.boards["feeder"].inputs[2] = int(self.feed_mm > self.feed_trip_mm)
        self.boards["distribution"].inputs[3] = int(self.chute_deg > self.chute_trip_deg)

    def snapshot(self):
        return {
            "feed": {"value_mm": self.feed_mm, "nominal": True, "bound": True,
                     "direction": self.feed_spec["direction"], "limits_mm": self.feed_spec["limits"],
                     "travel_per_rev_mm": self.travel_per_rev_mm, "transmission_nominal": False,
                     "transmission_source": "fixtures/r20.json fixed.gear_rack_pinion: pi * module(1.5mm) * teeth(24)",
                     "mechanical_sign": self.feed_sign, "trip_mm": self.feed_trip_mm, "trip_nominal": True,
                     "initial_pose_nominal": True},
            "chute": {"value_deg": self.chute_deg, "nominal": True, "bound": False,
                      "reason": "unbound_joint", "transmission": 120 / 25,
                      "mechanical_sign": self.chute_sign, "trip_deg": self.chute_trip_deg, "trip_nominal": True},
        }
