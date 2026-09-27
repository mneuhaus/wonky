"""Integer 1 kHz motion / 10 kHz pulse FSM, ported from pinned Stepper.cpp.

Only the pulse accumulator drives mechanical revolutions. A counter rebase or
microstep change cannot teleport the plant. No torque/contact physics claimed.
See fixtures/firmware-license.txt for the original MIT notice.
"""
from dataclasses import dataclass, field


@dataclass
class Stepper:
    name: str
    position: int = 0
    revolutions: float = 0.0
    state: str = "STOPPED"
    speed: int = 0
    speed_frac: int = 0
    steps_frac: int = 0
    steps_moved: int = 0
    direction: int = 1
    target_direction: int = 1
    distance: int = -1
    target_speed: int = -1
    brake_distance: int = 0
    min_speed: int = 16
    max_speed: int = 4000
    acceleration: int = 20000
    microsteps: int = 8
    enabled: bool = False
    home_channel: int | None = None
    home_active_high: bool = False
    position_reset: bool = False
    position_reset_ns: int | None = None
    jitter_remaining: int = 0
    jitter_amplitude: int = 0
    saved_limits: tuple = ()
    stall_enabled: bool = False
    registers: dict = field(default_factory=dict)
    current: tuple = (0, 0, 0)
    chopconf: int = 0
    chopper_on: bool = False

    def initialize_driver(self):
        # TMC2209.cpp's shadow is independent of raw WRITE_REGISTER calls.
        self.chopconf = 0x150100C3  # INTPOL, MRES=5, TBL=2, HEND=1, HSTRT=4, TOFF=3
        self.registers.update({0x00: 0x1C0, 0x6C: self.chopconf, 0x10: 0})
        self.microsteps, self.current = 8, (0, 0, 0)
        self.enabled, self.chopper_on = False, True  # nEN high, chopper on

    def set_enabled(self, enabled):
        if not enabled or not self.chopper_on:
            self.chopconf = (self.chopconf & ~0xF) | (3 if enabled else 0)
            self.registers[0x6C] = self.chopconf
            self.chopper_on = enabled
        self.enabled = enabled

    def set_microsteps(self, microsteps):
        self.microsteps = microsteps
        self.chopconf = (self.chopconf & ~(0xF << 24)) | ((8 - (microsteps.bit_length() - 1)) << 24)
        self.registers[0x6C] = self.chopconf

    @property
    def jittering(self):
        return self.jitter_remaining > 0

    def set_limits(self, minimum, maximum):
        minimum, maximum = min(minimum, 60000), min(maximum, 60000)
        if minimum <= maximum:
            self.min_speed, self.max_speed = minimum, maximum

    def _begin_distance(self, distance):
        self.distance = abs(distance)
        self.target_direction = 1 if distance > 0 else -1
        self.target_speed = -1
        self.home_channel = None
        self.speed, self.speed_frac = self.min_speed, 0
        self.direction = self.target_direction
        self.steps_moved = self.steps_frac = 0
        self.brake_distance = self.distance // 2
        self.state = "ACCELERATING"

    def move_steps(self, distance):
        if self.jittering or self.state != "STOPPED":
            return False
        if distance:
            self._begin_distance(distance)
        return True

    def move_at_speed(self, speed):
        if self.jittering:
            return False
        self.home_channel = None
        self.steps_moved = self.steps_frac = 0
        self.distance = -1
        if speed == 0:
            self.target_speed = 0
            self.target_direction = self.direction
            if self.state == "STOPPED":
                self.speed = self.speed_frac = 0
            else:
                self.state = "BRAKING"
            return True
        self.target_direction = 1 if speed > 0 else -1
        self.target_speed = min(abs(speed), 60000)
        if self.state == "STOPPED":
            self.direction = self.target_direction
            self.speed, self.speed_frac = self.min_speed, 0
            self.state = "ACCELERATING"
        elif self.direction != self.target_direction or self.speed > self.target_speed:
            self.state = "BRAKING"
        elif self.speed == self.target_speed:
            self.state = "CRUISING"
        else:
            self.state = "ACCELERATING"
        return True

    def jitter(self, amplitude, cycles, speed, acceleration):
        if self.jittering or self.state != "STOPPED" or min(amplitude, cycles, speed, acceleration) <= 0:
            return False
        self.saved_limits = self.min_speed, self.max_speed, self.acceleration
        self.acceleration = acceleration
        self.set_limits(self.min_speed, speed)
        self.jitter_remaining = cycles * 2
        self.jitter_amplitude = amplitude
        self._begin_distance(amplitude)
        return True

    def home_check(self, inputs, sim_ns):
        if self.home_channel is not None and bool(inputs[self.home_channel]) == self.home_active_high:
            self.state = "STOPPED"
            self.speed = 0
            self.position = 0
            self.position_reset = True
            self.position_reset_ns = sim_ns
            self.home_channel = None
            return True
        return False

    def motion_tick(self, inputs, sim_ns):
        if self.state == "STOPPED":
            if self.jitter_remaining:
                self.jitter_remaining -= 1
                if self.jitter_remaining:
                    self._begin_distance(-self.direction * self.jitter_amplitude)
                else:
                    self.jitter_amplitude = 0
                    self.min_speed, self.max_speed, self.acceleration = self.saved_limits
            return
        if self.state in ("ACCELERATING", "CRUISING"):
            if self.state == "ACCELERATING":
                self.speed_frac += self.acceleration
                self.speed += self.speed_frac // 1000
                self.speed_frac %= 1000
                if self.target_speed > 0 and self.speed >= self.target_speed:
                    self.speed, self.speed_frac, self.state = self.target_speed, 0, "CRUISING"
                elif self.target_speed < 0 and self.speed >= self.max_speed:
                    self.speed, self.speed_frac, self.state = self.max_speed, 0, "CRUISING"
                    self.brake_distance = self.distance - self.steps_moved
            if self.home_check(inputs, sim_ns):
                return
            if self.distance > 0 and self.steps_moved >= self.brake_distance:
                self.state = "BRAKING"
        elif self.state == "BRAKING":
            self.speed_frac += self.acceleration
            self.speed -= self.speed_frac // 1000
            self.speed_frac %= 1000
            if self.speed <= self.min_speed:
                self.speed, self.speed_frac = self.min_speed, 0
                if self.target_speed > 0 and self.direction != self.target_direction:
                    self.direction = self.target_direction
                    self.steps_frac = -self.steps_frac
                    self.state = "ACCELERATING"
                elif self.target_speed == 0:
                    self.state = "STOPPED"
                else:
                    self.state = "CRUISING"
            # Preserve the pinned firmware's >= comparison, including its
            # same-direction deceleration quirk; this is not an ideal profile.
            if self.target_speed > 0 and self.direction == self.target_direction and self.speed >= self.target_speed:
                self.speed, self.speed_frac, self.state = self.target_speed, 0, "CRUISING"

    def pulse_tick(self, inputs, sim_ns):
        if self.state == "STOPPED" or self.home_check(inputs, sim_ns):
            return
        self.steps_frac += self.speed
        while abs(self.steps_frac) >= 10000:
            self.steps_frac += -10000 if self.steps_frac >= 10000 else 10000
            self.steps_moved += self.direction * self.target_direction
            self.position = ((self.position + self.direction + 2**31) % 2**32) - 2**31
            if self.enabled:
                self.revolutions += self.direction / (200 * self.microsteps)
            if self.distance > 0 and self.steps_moved >= self.distance:
                self.state, self.speed = "STOPPED", 0
                break

    def snapshot(self):
        return {"name": self.name, "position": self.position, "state": self.state,
                "speed": self.speed, "direction": self.direction, "microsteps": self.microsteps,
                "enabled": self.enabled, "jittering": self.jittering,
                "position_reset": self.position_reset, "position_reset_ns": self.position_reset_ns,
                "min_speed": self.min_speed, "max_speed": self.max_speed, "acceleration": self.acceleration}
