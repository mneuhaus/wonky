"""One owner of integer simulation time; missed deadlines invalidate, never skip."""
from array import array
import numpy as np
import threading
import time
import uuid
from .deadline import DeadlineWaiter

TICK_NS = 1_000_000


class SimClock:
    def __init__(self, tick, lock):
        self.epoch = str(uuid.uuid4())
        self.sim_ns = 0
        self.origin_ns = None
        self.overruns = 0
        self.jitter_ns = array("q")
        self.tick = tick
        self.lock = lock
        self.stop = threading.Event()
        self.error = None
        self.scheduler = "starting"
        self.thread = threading.Thread(target=self._run, name="motion-1khz", daemon=True)

    def start(self):
        self.thread.start()

    def _run(self):
        try:
            waiter = DeadlineWaiter(self.stop, TICK_NS)
            self.scheduler = waiter.mode
            with self.lock:
                self.origin_ns = time.perf_counter_ns()
            deadline = self.origin_ns + TICK_NS
            while not self.stop.is_set():
                if waiter.wait_until(deadline):
                    break
                with self.lock:
                    late = max(0, time.perf_counter_ns() - deadline)
                    self.jitter_ns.append(late)
                    if late >= TICK_NS:
                        self.overruns += 1
                    self.tick(self.sim_ns + TICK_NS)
                    self.sim_ns += TICK_NS
                deadline += TICK_NS
        except Exception as exc:
            self.error = repr(exc)
            self.stop.set()

    def now_ns(self):
        """Monotonic time in this epoch, including the current partial tick."""
        return max(self.sim_ns, time.perf_counter_ns() - self.origin_ns) if self.origin_ns is not None else 0

    def metrics(self, since_tick=0):
        # Freeze the interval endpoints, not the motion thread. The history is
        # append-only. Even sorted() outside the state lock holds the GIL for
        # milliseconds on a long run; to_thread alone does not prevent that.
        with self.lock:
            ticks = len(self.jitter_ns)
            if not 0 <= since_tick <= ticks:
                raise ValueError(f"since_tick must be in 0..{ticks}")
            run_overruns, error, sim_ns = self.overruns, self.error, self.sim_ns
        count = ticks - since_tick
        samples = np.empty(count, dtype=np.int64)
        for start in range(since_tick, ticks, 4096):
            end = min(start + 4096, ticks)
            with self.lock:
                # Never retain a view of the growing array after unlocking:
                # doing so would prevent the motion thread from appending.
                samples[start - since_tick:end - since_tick] = np.frombuffer(
                    self.jitter_ns, dtype=np.int64, count=end - start, offset=start * 8)
            time.sleep(0)
        # Numeric sort/count release the GIL and avoid allocating/deallocating
        # one Python object per sample. Chunked Python sorting still induced
        # multi-ms GC pauses while polling /metrics on the live A2 workflow.
        overruns = int(np.count_nonzero(samples >= TICK_NS))
        samples.sort()
        jitter = {name: float(samples[int((count - 1) * fraction)]) / 1e6 if count else 0.0
                  for name, fraction in (("p50", .5), ("p95", .95), ("max", 1))}
        return {"ticks": ticks, "since_tick": since_tick, "measured_ticks": count,
                "sim_ns": sim_ns, "overruns": overruns,
                "run_overruns": run_overruns, "valid": run_overruns == 0 and error is None,
                "jitter_ms": jitter,
                "definition": "start lateness vs each absolute 1ms deadline; overrun >=1ms; no skipped ticks; percentiles floor((n-1)*p)",
                "scheduler": self.scheduler, "error": error}

    def close(self):
        self.stop.set()
        self.thread.join(timeout=3)
