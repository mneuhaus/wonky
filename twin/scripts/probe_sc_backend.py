"""Sandbox child: real backend controller + bus, synthetic perception only.

Normal construction runs first. Component probes explicitly supply a real,
absolute-degree TrayServo, because 8bd54541 forgets those constructor args.
That bypass is reported, never counted as application end-to-end acceptance.
"""
import json
import logging
import queue
import sys
import time
from types import SimpleNamespace

from defs.events import PauseCommandEvent
from hardware.bus import MCUBus
from hardware.waveshare_servo import ScServoBus
from piece_transport import ClassificationChannelTransport
from subsystems.shared_variables import SharedVariables
from subsystems.classification_channel.simple_state_machine_rev01.context import SimpleStateMachineRev01Context
from subsystems.classification_channel.tray.controller import TrayClassificationChannel
from subsystems.classification_channel.tray.servo import TrayServo
from irl.parse_user_toml import loadTrayServoConfig

logging.basicConfig(level=logging.INFO)


def exchange(op, **data):
    print(json.dumps({"op": op, **data}), flush=True)
    return json.loads(input())


class PerceptionInput:
    """Only the input count is synthetic. No cameras/NPU/classifier claim."""
    count = 2

    def read_state(self, channel):
        assert channel == 4
        return SimpleNamespace(n_pieces=self.count, ts=time.time())


class StepStatus:
    def __init__(self, bus):
        self.bus = bus

    @property
    def stopped(self):
        return self.bus.send_command(0, 0x14, 0, b"").payload == b"\x01"


def main():
    bus = ScServoBus(sys.argv[1], baudrate=115200)
    mcu = MCUBus(sys.argv[2], baudrate=115200)
    mcu.send_command(0, 0, 0, b"")
    report = {"ids": bus.scan(1, 18), "cases": {}}
    try:
        for case in ("normal_reject", "component_stroke", "nack_goal", "no_reply_goal", "uncalibrated"):
            perception = PerceptionInput()
            gc = SimpleNamespace(logger=logging.getLogger("probe"), perception_service=perception)
            irl = SimpleNamespace(servo_controller=SimpleNamespace(bus_service=bus), step_feeder=StepStatus(mcu))
            transport = ClassificationChannelTransport()
            events = queue.Queue()
            flow = TrayClassificationChannel(irl, SimpleNamespace(classification_channel_config=SimpleNamespace()),
                                            gc, SharedVariables(), transport, None, events, SimpleStateMachineRev01Context())
            cfg = loadTrayServoConfig(gc)
            if case == "uncalibrated":
                exchange("inject", id=cfg.id, kind="uncalibrated")
            elif case != "normal_reject":
                # Explicit diagnostic fixture, NOT a repair or monkeypatch of
                # the production constructor. This is the real public motor.
                servo = TrayServo(gc, irl, servo_id=cfg.id, invert=cfg.invert, move_time_ms=cfg.move_time_ms,
                                  zero_raw=cfg.zero_raw, raw_per_deg=cfg.raw_per_deg)
                assert servo.initialize()
                flow._servo = servo
            start = exchange("mark", case=case, phase="start")["sim_ns"]
            phases, segments = [], []
            injected = False
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                flow.step()
                phase = flow.phaseName()
                if not phases or phase != phases[-1]["phase"]:
                    stamp = exchange("mark", case=case, phase=phase)["sim_ns"]
                    phases.append({"phase": phase, "sim_ns": stamp})
                segment = flow._status.get("return_segment")
                if segment and (not segments or segment != segments[-1]["segment"]):
                    stamp = exchange("mark", case=case, phase=segment)["sim_ns"]
                    segments.append({"segment": segment, "sim_ns": stamp})
                if flow._servo:
                    flow._servo.read_degrees()  # actual PRESENT_POSITION during every phase
                if flow._return_servo:
                    flow._return_servo.read_degrees()
                if case == "normal_reject" and flow._status.get("return_skipped"):
                    break
                if case == "uncalibrated" and flow._status.get("servo_error"):
                    break
                if case in ("nack_goal", "no_reply_goal") and phase == "hopper_return":
                    if not injected and time.monotonic() - flow._return_plan.started_at >= .2:
                        exchange("inject", id=18, kind=case, count=3 if case == "no_reply_goal" else 1)
                        injected = True
                        injected_at = time.monotonic()
                    elif injected and time.monotonic() - injected_at > .25:
                        break
                if phase == "fault":
                    break
                if phase == "hopper_return_settle":
                    perception.count = 0
                if case == "component_stroke" and flow._status.get("hopper_returns", 0) == 1 and phase == "waiting":
                    break
                time.sleep(.01)
            else:
                raise RuntimeError(f"{case}: controller did not finish: {flow._status}")
            end = exchange("mark", case=case, phase="end")["sim_ns"]
            emitted = list(events.queue)
            report["cases"][case] = {"start_ns": start, "end_ns": end, "phases": phases,
                "segments": segments, "status": dict(flow._status), "return_active": gc.tray_return_active,
                "configured_profile": {name: getattr(flow._return_cfg, name) for name in ("stroke_s", "ramp_s", "step_ms", "dump_dwell_s")},
                "tray_absolute_degrees": flow._servo.absolute_degrees if flow._servo else None,
                "pause_events": sum(isinstance(e, PauseCommandEvent) for e in emitted),
                "classification_status": str(flow.ctx.known_object.classification_status) if flow.ctx.known_object else None,
                "to_distribution": transport.getPieceForDistributionPositioning() is not None,
                "fixture": "normal constructor" if case in ("normal_reject", "uncalibrated") else "explicit real absolute-degree TrayServo supplied; not application acceptance"}
            # Re-home through actual public clients so the next probe starts
            # from zero. Do not mutate twin poses or reset simulation time.
            for motor in (flow._servo, flow._return_servo):
                if motor:
                    motor.release()
            if case != "uncalibrated":
                bus.set_torque(cfg.id, True)
                bus.move_to(cfg.id, cfg.zero_raw, 100)
                time.sleep(.12)
                bus.set_torque(cfg.id, False)
                bus.set_torque(18, False)
        exchange("result", report=report)
    finally:
        bus.close()
        mcu.close()


if __name__ == "__main__":
    main()
