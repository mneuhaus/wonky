# Digital twin: from the workspace viewer to a machine you can run

Status: design (25.09.2026). Inputs: the five research notes in `docs/research/digital-twin/*.json` and the sorter's hardware-interface summary.


## 1. Target picture

| Stage | What it means | Proof it works |
|---|---|---|
| Viewer | exact R20 geometry, one workspace, static placements (today, `docs/viewer/workspace.md`) | exists |
| Kinematic twin | joints move bodies; values come from a virtual board that the real backend drives | backend homes and moves `feed`; viewer shows it |
| Virtual cameras | calibrated sensor renders from a mount frame, served as MJPEG | `cv2.VideoCapture(url)` in the real backend shows the moving tray |
| Physics with bricks | MuJoCo plant: loose bricks, contact, torque-limited drives, light barriers | a brick is carried by contact and trips a sensor; a blocked axis lags its step counter |
| HIL | real Pico, motor power off, plant in the twin; later pin-level capture | real firmware homes against a simulated endstop |

Out of scope: photoreal training data (BlenderProc, later), ROS, Gazebo,
Webots, Isaac (none adds what the Python process lacks; Isaac has no macOS
support), a RP2040 instruction emulator.

## 2. Architecture

```
 CAD sources (.fs) ─> wonky/Bend ─> exact B-rep + display mesh per model revision
                                            │
      workspace *.view.json ── Lane H1 motion binding (r20-motion.json: joints, homes, body occurrences)
                                            │
      twin scene *.twin.json: pinned revisions, joint<-board channel + transmission,
                              endstops, cameras (K, mount), collision profile (phase 3)
                                            │
 ┌──────────────────── twin process (Python, uv-pinned) ─────────────────────┐
 │ SimClock: integer sim_ns, epoch, modes realtime | step (fast later)       │
 │ virtual Pico "FEEDER MB"  (COBS/CRC32, stepper FSM 1 kHz)   ── PTY A ──┐  │
 │ virtual Pico "DISTRIBUTION"                                 ── PTY B ──┤  │
 │ virtual Feetech SC bus (tray, flaps)          (phase 2)     ── PTY C ──┤  │
 │ plant: kinematic joints (MVP) │ MuJoCo 3.14 + bricks (phase 3)          │  │
 │ trace: commands, ACKs, sensor edges, faults, frame ids                  │  │
 └──── WebSocket snapshots {epoch, tick, sim_ns, joints, free bodies} ─────┘  │
            │                                                                 │
 wonky viewer server (Node) ─> browser UI (twin panel: commanded/actual, clock)
            │                                                                 │
            └─> sensor page in headless Chromium: WebGL2 FBO per camera,      │
                renderAt(snapshot) ─> JPEG + meta ─> GET /cam/<role> (MJPEG)  │
                                            │                                 │
 sorter backend (b1-lean, unchanged except env seams):                         │
   SORTER_MCU_PORTS=PTY A,PTY B   [servo] port=PTY C   [cameras] role=http://…/cam/<role>
```

Rules (from the research and AGENTS.md):

- The twin process alone owns state and time; `requestAnimationFrame` only
  interpolates the display.
- The twin sends joint values; H1 turns them into body poses, so kinematics
  exists once. The MuJoCo tree later comes from the same H1 contract.
- A geometry rebuild during a run ends the epoch; no per-frame CAD builds.
- Physics is labelled approximate and uncalibrated until measured. A clean
  run is not a clearance certificate; clearance stays Lane H2-H5.
- Missing pieces are typed refusals (unbound joint, body without collider,
  unknown command as NACK with the firmware's text, camera without profile).
  No box stand-ins, no ACK-everything.

## 3. Engine and stack

| Choice | Why | Rejected alternatives |
|---|---|---|
| Twin in Python 3.12 via `uv`, one process | the sorter backend, pySerial, `os.openpty` and MuJoCo's native bindings are all Python; the firmware semantics are easiest to mirror next to them | Node twin (no MuJoCo native, second serial stack) |
| Kinematic plant first | MVP needs joint positions only; the stepper FSM already determines them | physics in the MVP (0.22x RTF is the only data point) |
| MuJoCo 3.14.0 native, phase 3 | Apache-2.0; articulated joints, explicit inertia, soft contact; Marc's feeder and coin sims already used it, so contact profiles and LDraw handling exist as experience | Rapier (best browser-only fallback), Jolt (bulk-pile throughput candidate), Bullet/ammo.js, PhysX WASM: none has a concrete advantage here, none measured |
| `@mujoco/mujoco` WASM | optional later, same MJCF; not before native is qualified | as primary: bindings marked WIP, COOP/COEP needed |
| Sensor render in wonky's WebGL2 renderer | same meshes and poses the viewer shows; one asset path | MuJoCo camera (second renderer, but a valid fallback once MuJoCo holds the scene) |
| MJPEG over HTTP | the backend already opens URL sources with plain `cv2.VideoCapture(url)` | v4l2loopback, CoreMediaIO extension, RTSP: only on measured need |

Critique: the physics researcher's 12 agent-days include a 3-day bake-off
and a 2-day WASM worker nobody needs yet. Real time is unproven everywhere:
the one measurement is 50 s simulated in 220 s wall, 40 bricks, old 4-core
box, not reproduced. The cad-project-043 AGENTS.md's real-time sim and PTY/MJPEG
fake firmware are prose: every researcher looked and found no code. The
snapshot is MIT + Commons Clause (designs CC BY-NC-SA 4.0), so the twin
reimplements what it needs (LDraw loading, mass from hull, CoACD call).

## 4. How it builds on the workspace viewer and Lane H

Lane H (`local design note`, H1-H5, 9.5 agent-days) is kinematics plus
certified clearance. The twin reuses exactly one of its packages and adds
nothing to the others:

- **H1 (MC1 + MC2) is a hard prerequisite:** the `r20/viewer-motion/v1`
  adapter, stable body occurrences (today an instance is a whole model with
  an index id), per-body transforms for drawing, picking and sections, and
  scrubbing. The twin writes joint values into the same pose version as H1
  scrubbing. Start H1 on Wed 30.09 as planned (1 agent-day; viewer-workspace
  has landed, 833cad2).
- **H2-H5 stay independent.** The twin never reports distances; the clearance
  engine never consumes physics. Both read the same H1 bindings.
- **Workspace additions:** a `*.twin.json` next to the `*.view.json` (schema
  v1 refuses unknown fields, so no new fields there), one WebSocket client in
  the server, a twin panel, the sensor page. The frustum overlay needs the
  open item "overlays for non-identity placements" (workspace.md §8).
- **R20 gaps stay visible:** 4 joints, 25 FS bindings on 23 bodies, 42 layout
  keys unbound; camera mast, frame and chute are `fs: null`. Unbound joints
  (chute) show as numbers; the MVP camera mount is a declared `nominal` frame.

## 5. Virtual boards: the sorter's real protocol

Transport: one PTY per board (`os.openpty`, slave path from `os.ttyname`). The
backend finds them through `SORTER_MCU_PORTS` (already on `b1-lean`,
ae05d13a) and `[servo] port`. Missing seam: pySerial on macOS fails
`IOSSIOSPEED` on a PTY at 576000 and 1000000 baud (errno 25); 115200 works.
Researcher probe, re-run by me today with the same result. So the sorter needs
a virtual-only baud override (for example `SORTER_VIRTUAL_BAUD`, applied only
to ports from the override). Linux PTYs were not tested. `socket://` would
need `serial_for_url` in both constructors and is not a drop-in today.

Framing (summary §1): `[addr][cmd][chan][len][payload][crc32 LE]`, COBS, 0x00
terminator, addr 0, max 254 bytes, NACK = `cmd|0x80` + ASCII text. The backend
retries framing/CRC/timeout up to 3 times with no sequence number, so a lost
ACK after an accepted `MOVE_STEPS` can execute the move twice. The twin
reproduces that; it must not dedupe it away.

Profiles: `skr_pico` only (4 steppers, inputs GPIO {4,3,25,16} pull-up,
outputs {21,23,17,18,20}). INIT answers the real JSON, for example
`{"device_name":"FEEDER MB","stepper_count":4,"stepper_names":["c_channel_1_rotor","c_channel_2_rotor","c_channel_3_rotor","carousel"],…,"hw":"skr_pico"}`;
GET_VERSION answers with `variant` `feeder-skr` / `distribution-skr` and a
`commit` of `twin-<hash>` so traces never pass for real firmware.

| cmd | Twin behaviour | World effect |
|---|---|---|
| 0x00 INIT | re-init board state, outputs off, FAN0 on, return config JSON | none: the joint keeps its actual pose (no teleport to zero) |
| 0x01 PING / 0x04 GET_VERSION / 0x03 GET_OBSERVABILITY | echo / JSON / JSON with `"hw":"skr_pico"`, `soft_sg` state | none |
| 0x02 REBOOT_BOOTLOADER | no reply, board offline for a configured time, then re-enumerable | none |
| 0x10 MOVE_STEPS `i` | ACK 1 only if STOPPED and not jittering, else ACK 0; trapezoid profile at 1 kHz, `speed += accel/1000`, brake distance as firmware | commanded counter advances; joint follows via transmission |
| 0x11 MOVE_AT_SPEED `i` | accelerate / brake / reverse through BRAKING; 0 = brake to `min_speed` | same |
| 0x12 / 0x13 speed limits, accel | clamp 60000; ignore min>max | profile only |
| 0x14 IS_STOPPED / 0x15 GET_POSITION / 0x16 SET_POSITION | FSM state / counter / counter offset | SET_POSITION moves nothing |
| 0x17 HOME `iB?` | move at speed, arm input channel and polarity; trip when the simulated pin equals `active_high`, sub-tick crossing time from the joint trajectory | pin level comes from the endstop's joint threshold (geometry later) |
| 0x18 JITTER / 0x19 IS_JITTERING | cycles×2 strokes, zero net displacement, blocks MOVE_AT_SPEED(0) | joint oscillates |
| 0x1A-0x1C stall | ideal drive: status 0; torque-limited drive (phase 3): latch when actual lags commanded beyond a declared threshold; injected stalls are tagged as injected | none / real lag |
| 0x1D-0x1E encoder | refused (NACK "Invalid command") unless the profile declares the encoder capability (not on `main`, dirty on the real boards) | none |
| 0x20 SET_ENABLED | chopper off: drive torque zero, next move re-energises | joint free (phase 3) or held by friction (kinematic) |
| 0x21 SET_MICROSTEPS / 0x22 SET_CURRENT | powers of two 1..256 else NACK / store irun, ihold | scales steps-to-angle / torque limit in phase 3 |
| 0x28 / 0x29 TMC registers | register file; SGTHRS 0x40 and TCOOLTHRS 0x14 feed the stall model | none |
| 0x30 DIGITAL READ / 0x31 WRITE / 0x32 WRITE_PWM | pin level from sensors (active-low endstops) / store | LED and fan state shown in the panel |
| 0x40-0x48 PCA9685 servos | NACK: unused on B1, the profile reports `servo_count: 0` | none |

Joint binding for B1 step_tray onto R20 (candidate, decision 1):

| Board / channel | Firmware name | R20 joint | Transmission | Status |
|---|---|---|---|---|
| feeder ch0 | `c_channel_1_rotor` (`irl.step_stepper`) | `feed`, prismatic 0..130 mm along [0, 0.4226, 0.9063] | `x = sign·steps·travel_per_rev/(200·microsteps)`; GT2 pulley teeth unknown | travel_per_rev is a declared nominal until Marc measures |
| feeder input ch2 (GPIO25) | cad-project-041 endstop, active-low | switch at a declared `feed` value | pin = 0 while `feed ≤ trip` | nominal trip point |
| distribution ch0 | `chute_stepper` | none (chute is `fs: null`) | 120/25 | joint shown as a number, no body |
| distribution input ch3 (GPIO16) | `chute_home`, active-low | chute angle threshold | | nominal |
| SC bus id 2 (SC09, 300°) / id 17 (SC15, 210°) | tray servo | `rock` | EEPROM min/max → calibrated angles | phase 2 |
| SC ids 15/16 | layer flaps | none in R20 | | numbers only |
| none | none | `return` | none | manual pose parameter; not derived from `rock` |
| none | none | `service` | none | maintenance pose, run paused |

Direction inversion lives in the backend (`[stepper_direction_inverts]`),
already in the wire value: the twin applies only the mechanical sign.

The Feetech bus (phase 2) mirrors `FF FF id len instr params chk`, big-endian
registers (GOAL_POSITION 42 with time, PRESENT_POSITION 56, TORQUE_ENABLE 40,
MOVING 66, LOAD 60), half-duplex echo, uncalibrated-servo refusal. The
backend's `stopped` is time-based, so the twin's PRESENT_POSITION must be the
real interpolated pose, not the goal.

## 6. Camera path to OpenCV

1. **Profile** in `*.twin.json`: role (`classification_channel` first; on B1
   one OBSBOT covers lip and tray), resolution 1280×720 at 30/1 fps, K
   (fx, fy, cx, cy), distortion model (none in the MVP), mount = body
   occurrence + mount-to-sensor pose, near/far, `calibrated: false`. Start
   values: OBSBOT's published 79.4° diagonal. No measured K exists anywhere in
   the backend, so every profile is nominal until Marc calibrates.
2. **Render**: a sensor page of the viewer (`/sensor?camera=<role>`) in one
   headless Chromium for all cameras. Own FBO, projection built from K
   (asymmetric frustum, OpenCV axes right/down/forward), fixed world lighting,
   no selection colours, sections, edges or UI visibility. `renderAt(snapshot)`
   with the snapshot of the capture tick, not the interpolated UI pose. The
   GPU backend in use is reported; a software fallback is flagged.
3. **Readback and encode**: async readback, vertical flip, JPEG once per frame
   (browser encoder first; measure before optimising).
4. **Transport**: the Node server serves `multipart/x-mixed-replace` at
   `/cam/<role>`, loopback only, latest-frame-wins per reader, slow readers
   dropped. Sorter config:
   `[cameras] classification_channel = "http://127.0.0.1:<port>/cam/classification_channel"`.
   URL sources skip `v4l2-ctl` and UVC controls, which is right for a virtual
   camera. Colour correction is off in current code; rotation/flip must be off
   for the role.
5. **Time**: capture ticks from a rational accumulator (1 ms physics, 30 fps:
   no drift), a sidecar `/cam/<role>/meta` stream with frame id, epoch,
   sim_ns and pose version. The backend stamps frames with `time.time()` on
   receive; plain OpenCV cannot get the frame id, so deterministic tests need
   a frame-aware reader (phase 2), and in realtime mode frame age is measured,
   not assumed.

The camera does not prove detection: the detector is RKNN on the RK3588
(stub on the Mac; a CPU export is open), and Brickognize is an external HTTP
call that twin runs replace by a recorded classifier.

## 7. Phases

- **Phase 1, MVP (TW0-TW4, 8.5 d + H1):** kinematic plant, two virtual
  Picos, twin panel, one sensor camera. Backend on the Mac with
  `SORTER_MCU_PORTS`, the baud seam and `LEGOSORTER_DISABLE=servos`. Demo:
  `/api/system/initialize`, `/api/system/home` (step feeder, then chute), a
  step forward and back; `feed` moves in the viewer and in the backend's
  camera feed.
- **Phase 2, closed loop (TW5-TW8, 5 d):** SC bus, faults, frame identity,
  backend SimClock, one step_tray cycle with a recorded classifier.
- **Phase 3, physics (TW9-TW12, 6.5 d):** MJCF, collision assets, MuJoCo
  plant with bricks, RTF gate.
- **Phase 4 (TW13-TW14, 4 d + bench time):** calibration, real Pico with
  motor power off. Pin-level HIL is not planned: the hil researcher's 3 days
  for it ignore the hardware build and logic-analyser work.

## 8. Work packages

Agent-day = 8 h active agent time including verification. ±50 %.

| Id | Scope | Acceptance | Est | Needs |
|---|---|---|---|---|
| TW0 | Spikes: (a) PTY Pico answering INIT/PING/VERSION/MOVE_STEPS/IS_STOPPED/GET_POSITION/HOME against unmodified `MCUBus` + `discover_control_boards`; (b) sensor page: 720p FBO render, readback, JPEG, MJPEG to `cv2.VideoCapture` on this Mac | (a) backend discovers two boards and one move completes; (b) measured render, readback, encode ms and frame age p50/p95; negative: real USB enumeration never happens with the override set | 1 | baud seam (sorter session) |
| TW1 | `*.twin.json` contract and loader (typed refusals: unknown field, unbound joint, wrong unit, missing camera profile); twin process with SimClock (realtime, step), epochs, WebSocket snapshots, trace file | same tick inputs give identical snapshots twice; a geometry revision change ends the epoch; tests read `fixtures/twin/`, never `~/Workspace/cad` | 1.5 | H1 |
| TW2 | Virtual Pico, `skr_pico` profile, table in §5, feeder and distribution boards, endstops from joint thresholds | transcripts checked against the firmware handlers (`fw/Stepper.cpp`, `message.cpp`) by a verifier who did not write the emulator: busy reject, NACK texts, brake on reversal, HOME zeroing at trip, SET_POSITION without motion, lost-ACK double move reproduced | 2.5 | TW0 |
| TW3 | Viewer twin mode: WS client in the server, joint values into H1 pose version, panel with commanded counter, actual joint, epoch, sim time, realtime status | `feed` at a commanded step count shows the pose H1 scrubbing shows for the same value; hidden bodies stay in the snapshot; restart shows no stale snapshot as live | 1 | TW1, H1 |
| TW4 | Sensor camera: profile, mount on a body occurrence, K projection, fixed lighting, headless Chromium, MJPEG and meta routes | known 3D points project within 0.5 px of an independent OpenCV `projectPoints`; orbit camera, selection and window size do not change the stream; the real backend feed shows the moving tray | 2.5 | TW0b, TW1 |
| TW5 | Virtual Feetech SC bus: registers, SC09/SC15 scales, torque release, `rock` binding | real `ScServoBus` finds ids 2/15/16, Safe Home completes with servos enabled; torque off leaves the joint where it is | 1 | TW2 |
| TW6 | Faults and trace: seeded CRC loss, lost ACK, stuck or bouncing endstop, camera freeze; frame-aware reader for tests | each fault replays from its seed with the same backend reaction; a frozen camera is never reported as fresh | 1.5 | TW2, TW4 |
| TW7 | SimClock seam in the backend (sorter repo, sorter session): injectable clock and frame timestamps at the timer boundaries, no global monkeypatch | home, feed, reverse, stop in step mode give the same commands at the same sim times twice; pause does not expire virtual deadlines | 1.5 | TW1, Marc's OK |
| TW8 | One step_tray cycle end to end with a recorded classifier | cycle completes; scenarios: late second part, blocked stepper, dead endstop, lost stream, backend restart; no external uploads | 1 | TW5-TW7 |
| TW9 | MJCF export from the twin contract and H1 (mm→m, deg→rad once, wxyz quaternions) | home and pivot of every bound body match the viewer under a non-identity placement | 1 | TW1 |
| TW10 | Collision assets: primitives where exact, CoACD per body otherwise (cached by geometry hash, params, version), 8 LDraw parts with explicit mass and inertia, licence chain per part | every hull is its own geom; mass independent of hull count; a missing collider refuses the run; proxy error reported, never as a mesh certificate | 2 | TW9 |
| TW11 | MuJoCo 3.14 plant: ideal and torque-limited drives, bricks as free bodies, light barrier and endstop from geometry, snapshot includes bricks | a brick falls, is carried by contact and trips a barrier; a blocked torque-limited axis lags its counter; NaN or initial overlap stops the run visibly | 2.5 | TW10, TW2 |
| TW12 | RTF gate: 1/10/40/100 bricks, physics-only and end-to-end with one camera, dt 1 ms vs 0.5 ms | numbers with denominators; realtime claimed only where RTF ≥ 1 held; below that the run is marked and uses step mode | 1 | TW11 |
| TW13 | Calibration from Marc's measurements: pulley travel, endstop trip, servo angles, camera K and mount, one friction pair | each value replaces a nominal with provenance; unmeasured stays `nominal` | 1.5 | TW12, bench time |
| TW14 | Firmware-in-loop: real Pico, motor supply off, twin supplies inputs, reads outputs | real firmware homes against the simulated endstop; disconnect stops the run; nothing energised | 2.5 | TW6, hardware |

Totals: MVP (TW0-TW4) 8.5, phase 2 (TW5-TW8) 5, phase 3 (TW9-TW12) 6.5,
phase 4 (TW13-TW14) 4, about 24 agent-days plus H1 (1). The researchers'
packages sum to about 49 (ES 6.5, PE 12, DT 16, VC 7, HW 7.5, before
optional ones): PE4, DT2 and HW2 are the same board emulator, PE6, DT3, VC1-4
and HW5 the same camera, ES3, PE3 and DT1 the same runner.

Optimistic: DT1-DT3 "5 days to a kinematic board and camera MVP" omits the
sensor renderer (VC2 alone is 2.5); HW2 at 1.5 for all commands plus an
independent transcript check is tight (2.5 here); DT8 pin HIL at 3 is not
credible without hardware. VC7 (RTSP) and VC8 (CoreMediaIO, 3 d) have no
consumer and are dropped. Sound: all five refused to count documentation as
implementation and kept commanded counter, actual pose and sensor apart.


## 10. Risks, and what to prototype first

| Risk | Effect | Handling |
|---|---|---|
| macOS PTY baud ioctl | backend cannot open virtual ports | confirmed; baud seam, test Linux separately |
| No real time for the unchanged backend | its 0.25 s bus timeout, servo `stopped` timers and settle waits are wall-clock; a slow twin causes false timeouts | kinematic plant is cheap; physics below RTF 1 runs in step mode only after TW7; realtime overruns mark the run invalid, never skip ticks |
| Sensor render cost | 720p RGBA readback is about 110 MB/s at 30 fps before JPEG (arithmetic, not measured); 4K is 9x that | one 720p camera first; measure in TW0b |
| Nominal parameters taken for truth | pulley travel, endstop trip, K, friction are guesses | every nominal carries `nominal` in contract and panel; TW13 replaces them |
| R20 is not B1 | `return` has no actuator; chute, mast and frame have no geometry | typed unbound joints; no guessed mechanics |
| Firmware drift | boards may run firmware newer than the pinned commit | profile pinned to a firmware commit; encoder only as a declared capability |
| Physics tuning sink | contact profiles are uncalibrated start values (solref 0.005, friction 0.5 from the feeder clip) | TW12 gate with refinement runs; no jam or throughput claims without real reference |
| Licence | cad-project-043 snapshot is MIT + Commons Clause / CC BY-NC-SA; LDraw parts CC BY per part | reimplement; ship only parts with a recorded licence chain |
| External uploads | Brickognize sends images over HTTP | disabled in twin runs; recorded classifier |

Prototype first, in this order, because each can kill the plan cheaply:

1. **TW0a, PTY Pico against the unmodified backend** (half a day). Proves
   discovery with `SORTER_MCU_PORTS`, the baud seam, COBS/CRC and the 0.25 s
   timeout path on this Mac.
2. **TW0b, sensor frame into OpenCV** (half a day). A static R20 render from a
   nominal K through MJPEG into `cv2.VideoCapture`; measures the render and
   encode budget that decides the camera count.
3. **Physics RTF** only when phase 3 starts: the old 40-brick feeder number is
   the only data point and was not reproduced.

## 11. A name for the viewer

With joints, boards and cameras it is more than a viewer. Proposals:

| Name | Rationale |
|---|---|
| **Wonky Rig** (`wonky-rig`) | a test rig is literally what HIL is: the machine clamped into a harness and driven; short on the CLI |
| **Werkbank** | where parts are laid out, measured and then made to run; German, like the machine's owner |
| **Probelauf** | names the purpose, a trial run of the real software against a virtual machine before the real one moves |
| **Zwilling** | plain German for twin; honest about what it becomes, less about what it is today (a viewer) |
| **Bendstage** | the stage on which Bend geometry performs; keeps the kernel's name visible |

My pick: Wonky Rig; it fits every stage from viewer to HIL.

**Decided (Marc, 2026-09-25):** the whole project is **wonky**, the kernel is
**wonky core**, and the viewer with its twin mode is plain **wonky**. The
twin lives in `twin/` (package `wonky_twin`). Renaming the CLI and code
(`bin/wonky-view.mjs`, `bin/wonky.mjs` as the build command) is a separate
step; nothing is renamed in passing.
