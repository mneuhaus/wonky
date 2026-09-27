"""Launch only the pinned unmodified backend, fail closed on unsafe conditions.

macOS Seatbelt is defense in depth: proxy settings cannot cover arbitrary
native code, camera APIs, or writes in third-party imports. No backend patches.
"""
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import threading
import time

TMP_ROOT = Path("<repo>/tmp")
SORTER_ROOT = TMP_ROOT / "twin-sorter/8bd54541"
# Identical uv.lock; reuse dependencies without writing in the frozen source.
BACKEND_ENV = TMP_ROOT / "twin-sorter/65472c9d/software/sorter/backend/.venv"
BACKEND = SORTER_ROOT / "software/sorter/backend"

MACHINE_CONFIG = '''[machine_setup]
type = "step_tray"
[feeder]
mode = "step_rev01"
[classification_channel]
mode = "tray_rev01"
[cameras]
layout = "split_feeder"
feeder = -1
c_channel_2 = -1
c_channel_3 = -1
classification_channel = -1
carousel = -1
classification_top = -1
classification_bottom = -1
[step_feeder]
home_pin_channel = 2
endstop_active_high = false
home_speed_usteps_per_s = -1500
max_travel_deg = 413.8
homing = "endstop"
[chute]
home_pin_channel = 3
endstop_active_high = false
[stepper_direction_inverts]
c_channel_1_rotor = false
chute_stepper = false
'''



def servo_config(port, bus):
    from .sc_bus import SCBus
    bus = bus or SCBus()
    tray, arm = bus.servos[bus.tray_id], bus.servos[18]
    return f'''
# Nominal virtual SC calibration, NOT bench measurements.
[servo]
backend = "waveshare"
port = "{port}"
baud = 115200
[[servo.channels]]
id = 15
invert = false
[[servo.channels]]
id = 16
invert = false
[tray_servo]
id = {tray.id}
zero_raw = {tray.zero_raw}
raw_per_deg = {tray.raw_per_deg}
move_time_ms = 600
[return_servo]
id = 18
zero_raw = {arm.zero_raw}
raw_per_deg = {arm.raw_per_deg}
move_time_ms = 600
[tray_channel]
receive_angle = 0
[return_channel]
return_statuses = "multi_drop_fail"
stroke_s = 2.0
ramp_s = 0.6
step_ms = 50
dump_dwell_s = 1.0
'''


def thermal_ready(cancel=None):
    cancel = cancel or threading.Event()
    while not cancel.is_set():
        # Absolute executable + close_fds=False selects Python 3.12's native
        # posix_spawn path. fork_exec holds the GIL across fork on Darwin, so
        # putting it in to_thread does NOT protect the 1 kHz motion thread.
        # Python-created descriptors (including both PTYs) are CLOEXEC.
        result = subprocess.run(["/usr/bin/notifyutil", "-g", "com.apple.system.thermalpressurelevel"],
                                capture_output=True, text=True, check=True, close_fds=False)
        print(result.stdout.strip(), flush=True)
        if result.stderr:
            print(result.stderr, flush=True)
        level = int(result.stdout.split()[-1])
        if level < 2:
            return level
        print("Thermal pressure >=2; waiting before backend startup", flush=True)
        cancel.wait(10)
    raise InterruptedError("Backend startup cancelled while waiting for thermal pressure")


def backend_port_available():
    # main.py hardcodes 8000, and its process guard may terminate conflicts.
    # Never invoke it when occupied. A new upstream port seam is required to
    # support an alternative port without monkeypatching backend behavior.
    result = subprocess.run(["/usr/sbin/lsof", "-nP", "-iTCP:8000", "-sTCP:LISTEN"],
                            capture_output=True, text=True, close_fds=False)
    print("lsof 8000:", result.stdout or "no listener", flush=True)
    if result.stderr:
        print(result.stderr, flush=True)
    if result.returncode not in (0, 1) or result.stdout.strip():
        raise RuntimeError("backend_port_unavailable: pinned main.py has no port seam; refusing to start")
    with socket.socket() as probe:
        # Match uvicorn: an already closed server's TIME_WAIT is not a listener.
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind(("127.0.0.1", 8000))


def sandbox_profile(ports):
    for port in ports:
        if not re.fullmatch(r"/dev/ttys\d+", port):
            raise ValueError(f"Not a macOS virtual PTY: {port}")
    # Source archive and config are inside tmp, but no source file is modified.
    writable_ptys = " ".join(f'(literal "{port}")' for port in ports)
    return f'''(version 1)
(allow default)
(deny network*)
(allow network-inbound (local ip "localhost:*"))
(allow network-outbound (remote ip "localhost:*"))
(deny device-camera)
(deny signal)
(deny file-write*)
(allow file-write* (subpath "{TMP_ROOT}") (literal "/dev/null") {writable_ptys})
(deny file-read* file-write* (regex #"^/dev/(cu|tty)\\..*"))
'''


def prepare_backend(ports, epoch, sc_port=None, sc_bus=None):
    """Create isolated state and the shared fail-closed launch environment."""
    state = TMP_ROOT / "twin-sorter" / f"run-{epoch}"
    state.mkdir(parents=True, exist_ok=False)
    for directory in ("home", "cache", "temp", "config"):
        (state / directory).mkdir()
    config = state / "machine.toml"
    config.write_text(MACHINE_CONFIG + (servo_config(sc_port, sc_bus) if sc_port else ""))
    profile = state / "backend.sb"
    profile.write_text(sandbox_profile([*ports, *([sc_port] if sc_port else [])]))
    # Do not inherit credentials, provider tokens, existing config or proxy
    # bypass rules from the operator's shell. dotenv is disabled explicitly.
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LANG": "en_US.UTF-8",
           "HOME": str(state / "home"), "TMPDIR": str(state / "temp"),
           "XDG_CACHE_HOME": str(state / "cache"), "XDG_CONFIG_HOME": str(state / "config"),
           "MPLCONFIGDIR": str(state / "cache/matplotlib"),
           "YOLO_CONFIG_DIR": str(state / "config/yolo"),
           "TORCH_HOME": str(state / "cache/torch"), "HF_HOME": str(state / "cache/hf"),
           "HF_HUB_OFFLINE": "1", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONUNBUFFERED": "1",
           "PYTHON_DOTENV_DISABLED": "1", "UV_CACHE_DIR": str(state / "cache/uv"),
           "SORTER_MCU_PORTS": ",".join(ports), "SORTER_MCU_BAUD": "115200",
           "LEGOSORTER_DISABLE": "" if sc_port else "servos",
           "UV_PROJECT_ENVIRONMENT": str(BACKEND_ENV), "SORTER_API_HOST": "127.0.0.1",
           "SORTER_BASE_REPORTING_OFF": "1", "SORTER_BASICALLY_SERVICES_URL": "http://127.0.0.1:9",
           "HTTP_PROXY": "http://127.0.0.1:9", "HTTPS_PROXY": "http://127.0.0.1:9",
           "ALL_PROXY": "http://127.0.0.1:9", "NO_PROXY": "127.0.0.1,localhost,::1",
           "MACHINE_SPECIFIC_PARAMS_PATH": str(config),
           "LOCAL_STATE_DB_PATH": str(state / "local_state.sqlite"),
           "LOCAL_METRICS_DB_PATH": str(state / "metrics.sqlite"),
           "DIAGNOSTICS_DB_PATH": str(state / "diagnostics.sqlite"),
           "SORTER_PROFILE_BUS": "1", "SORTER_PROFILE_BUS_MIN_MS": "0",
           "OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1", "MKL_NUM_THREADS": "1"}
    return state, profile, env


class _BackendChild:
    """Native spawn with cwd + a private session, without forking the twin.

    Popen in Python 3.12 falls back to fork_exec for either cwd or setsid.
    Darwin posix_spawn supports setsid itself; /usr/bin/env changes cwd in
    the child before exec. No shell, backend wrapper, or changed entrypoint.
    """
    def __init__(self, state, profile, env):
        self.args = ["/usr/bin/env", "-C", str(state), "/usr/bin/sandbox-exec", "-f", str(profile),
                     "uv", "run", "--project", str(BACKEND), "--no-sync", "--offline",
                     "python", str(BACKEND / "main.py")]
        self.returncode = None
        read_fd, write_fd = os.pipe()
        try:
            self.pid = os.posix_spawn(self.args[0], self.args, env, setsid=True, file_actions=[
                (os.POSIX_SPAWN_DUP2, write_fd, 1),
                (os.POSIX_SPAWN_DUP2, write_fd, 2),
                (os.POSIX_SPAWN_CLOSE, read_fd),
                (os.POSIX_SPAWN_CLOSE, write_fd),
            ])
        except BaseException:
            os.close(read_fd)
            raise
        finally:
            os.close(write_fd)
        self.stdout = os.fdopen(read_fd, "r")

    def poll(self):
        if self.returncode is None:
            pid, status = os.waitpid(self.pid, os.WNOHANG)
            if pid:
                self.returncode = os.waitstatus_to_exitcode(status)
        return self.returncode

    def wait(self, timeout):
        deadline = time.monotonic() + timeout
        while self.poll() is None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired(self.args, timeout)
            time.sleep(min(.02, remaining))
        return self.returncode


class BackendProcess:
    def __init__(self, ports, epoch, cancel=None, sc_port=None, sc_bus=None):
        if not (BACKEND_ENV / "bin/python").is_file():
            raise RuntimeError(f"Run uv sync --project {BACKEND} --frozen --offline first")
        if not shutil.which("sandbox-exec"):
            raise RuntimeError("No macOS sandbox-exec: refusing unsandboxed backend")
        thermal_ready(cancel)
        backend_port_available()
        self.state, profile, env = prepare_backend(ports, epoch, sc_port, sc_bus)
        self.log = (self.state / "backend.log").open("w")
        try:
            self.process = _BackendChild(self.state, profile, env)
        except BaseException:
            self.log.close()
            raise
        self.reader = threading.Thread(target=self._read, name="backend-log", daemon=True)
        self.reader.start()

    def _read(self):
        for line in self.process.stdout:
            self.log.write(line)
            self.log.flush()
            print("[backend] " + line, end="", flush=True)

    def close(self):
        # Only this native-spawned child's private group; never kill by port/name.
        if self.process.poll() is None:
            import signal
            os.killpg(self.process.pid, signal.SIGTERM)
            try:
                self.process.wait(timeout=12)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait(timeout=5)
        self.reader.join(timeout=3)
        self.process.stdout.close()
        self.log.close()
