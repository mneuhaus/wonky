# Wonky twin

Kinematic SKR Pico endpoints and a Feetech SC servo bus speaking the pinned
sorter's protocols over three real PTYs in one process. Run from the workspace
root with `uv run --project twin wonky-twin up --with-backend`; stop with Ctrl-C.
Tests: `uv run --project twin pytest`. The backend source is the read-only
`tmp/twin-sorter/8bd54541` archive. Its unchanged dependency lock permits reuse
of `tmp/twin-sorter/65472c9d/software/sorter/backend/.venv` without writing the
source archive. The launcher writes only isolated run state and enables servos.

The ideal-drive joint trajectory is a staircase of microstep pulses. Events
are timestamped at 100 µs boundaries, speed updates at 1 ms boundaries. Before
every command and snapshot, events are advanced to that instant, never into
the future. Endstop threshold crossings therefore occur at the actual joint
pulse time; HOME observes a crossing no later than the next 100 µs poll.
This is not continuous mechanical/contact simulation or measured hardware.

Protocol quirks intentionally retained: a fragment shorter than eight encoded
bytes survives its delimiter and corrupts the next frame; 246-byte PING has no
reply; INIT preserves position while simulated reboot resets the counter but
holds the mechanical pose. Handler validation uses the declared header length,
including PING truncation. A declaration exceeding the received payload gets
an explicit NACK, rather than emulating firmware reads into CRC/stale memory.
TMC configuration writes use the firmware's shadow CHOPCONF, independent of raw
register writes; INIT leaves TOFF=3 while the separate nEN gate is disabled.

## SC bus and trace

The default tray is id 2, SC09 (300°). `--tray-id 17` selects SC15 (210°)
instead; two servos never compete for the same `rock` joint. Ids 15/16 are SC15
flaps shown as numbers, id 18 drives `return`. Joint limits, axes and home pose
come from the frozen `fixtures/r20-motion.json`. All EEPROM limits, `zero_raw`
and `raw_per_deg` are **nominal**, not calibration measurements. Limits round
to the nearest raw count (at most half a count, also exposed in the snapshot).

Implemented: PING/READ/WRITE, big-endian EEPROM/PID/torque registers, 6-byte
GOAL_POSITION with nonzero goal time and zero speed, interpolated
PRESENT_POSITION, MOVING, nominal zero LOAD/CURRENT and nominal voltage/temp.
Unsupported writes/instructions and speed-controlled/zero-time goals return
status 0x40, angle-limit violations 0x02. Bad checksums get echo only. The PTY
emulates adapter echo even when a servo is missing or does not answer.
Retargeting starts from the actual in-flight pose, not the old target.

Torque off holds the tray/flaps at their instantaneous pose. The return arm
instead **snaps home under idealized gravity**, cancelling its trajectory. This
is an explicit kinematic assumption, not a gravity/contact-time simulation.
Unpowered goals do not move the joint; re-enabling requires a fresh goal.

Snapshots add `sc_bus` (raw actual/goal, trajectory timestamps, torque, nominal
calibration/telemetry, fault events and instantaneous coupling error), and
`joints.rock` / `joints.return`. Every 1 ms tick is retained in a bounded 120 s
numeric ring. On shutdown the CLI writes `sc-trace-<epoch>.json` and
`sc-samples-<epoch>.json` beside its run file. Samples are
`[sim_ns, rock_deg, return_deg, rock_torque, return_torque]`. The wire history is
bounded to 20,000 transactions; use short isolated runs for full-stroke checks.
`wonky_twin.sc_trace.check_trace` independently replays accepted wire goals and
torque commands, compares every retained pose tick and PRESENT_POSITION read,
and counts every coupling violation. Dump/transition ticks are NOT exempt.

For programmatic fault scenarios, call `twin.sc.inject(id, kind, count)` under
`twin.lock`: `nack_goal` refuses with status 0x02, `no_reply_goal` refuses with
no servo response, `uncalibrated` exposes EEPROM 500..520. Counts are wire
transactions, so three unanswered attempts exhaust the backend's retries.
This is pre-execution refusal, not lost ACK after executing a command.

Run the real-backend diagnostic (sandbox, no HTTP listener) with
`uv run --project twin python -m wonky_twin.sc_acceptance --output
 twin/evidence/sc-acceptance.json`. It records the normal double-drop reject
branch, then separately labelled controller-component probes using real
absolute-degree TrayServo objects, real ScServoBus clients and synthetic
perception counts. Exit 1 preserves evidence of unmet upstream acceptance; it
does not patch the backend or convert those blockers into passing tests.
The full-app Safe Home proof lives in `tests/test_live_backend.py`.

## OPEN

- **TW5 return trigger:** pinned `controller.py:_servo_or_none` omits
  `zero_raw` / `raw_per_deg` when constructing TrayServo. The actual confirmed
  double-drop reject path therefore sets `return_skipped` and routes to the
  chute. Supplying an absolute servo in a component probe is NOT application
  end-to-end acceptance.
- **TW5 NACK:** `ScServoBus._transact` records nonzero status but returns a
  successful payload. A refused GOAL_POSITION does not fault the tray. No
  reply does fault it; uncalibrated limits refuse initialization.
- **TW5 coupling/dwell:** `(return=180, rock=-45)` differs by 90° from the
  literal coupling law. Even excluding that deliberate dump pose, the pinned
  planner begins lowering before rock has interpolated back to -135°. The
  trace checker reports this transition violation instead of teleporting the
  joint or widening the 5° tolerance. A timed target dwell is not necessarily
  a full 1 s at the measured pose.

- **D5, blocked:** the backend's background `waveshare_inventory` calls
  `serial.tools.list_ports.comports()` without consulting `SORTER_MCU_PORTS`.
  The MCU-bus override is not a global no-enumeration guarantee. Requires a
  sorter-side inventory/discovery gate. The sandbox prevents real serial
  access, but does not prevent enumeration; no monkeypatch/workaround here.
- **D6, blocked:** backend `main.py` hard-codes port 8000 and has a conflicting
  process guard. Requires a sorter-side configurable-port/ownership seam.
  Launch refuses an occupied 8000 without touching its listener. Refusal is
  not alternate-port support; no port interception or backend patch here.

The full suite retains the failing D5/D6 acceptance tests. Neither is skipped
or relabeled as passing. A passing homing run does not close those blockers.
