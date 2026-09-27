"""OS deadline waiting for the motion owner; no spin loop or skipped ticks.

Darwin's ordinary condition-variable timeout coalesces short waits (roughly
0.33 ms at 1 kHz here). Use Mach absolute deadlines and request a periodic
thread time constraint instead. This is a scheduling request, NOT proof of
realtime: SimClock still measures actual lock acquisition against every
original deadline, and any >=1 ms miss permanently invalidates the run.
"""
import ctypes
import sys
import time


class DeadlineWaiter:
    def __init__(self, stop, period_ns):
        self.stop = stop
        self.mode = "condition-timeout"
        self.period_ns = period_ns
        self.lib = None
        if sys.platform == "darwin":
            self._configure_mach()

    def _configure_mach(self):
        # Public ABI from mach/mach_time.h, mach/thread_policy.h and pthread.h.
        lib = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
        lib.mach_absolute_time.restype = ctypes.c_uint64
        lib.mach_absolute_time.argtypes = []
        lib.mach_wait_until.restype = ctypes.c_int
        lib.mach_wait_until.argtypes = [ctypes.c_uint64]
        lib.pthread_self.restype = ctypes.c_void_p
        lib.pthread_self.argtypes = []
        lib.pthread_mach_thread_np.restype = ctypes.c_uint32
        lib.pthread_mach_thread_np.argtypes = [ctypes.c_void_p]
        lib.thread_policy_set.restype = ctypes.c_int
        lib.thread_policy_set.argtypes = [ctypes.c_uint32, ctypes.c_int,
                                         ctypes.POINTER(ctypes.c_int32), ctypes.c_uint32]

        class Timebase(ctypes.Structure):
            _fields_ = [("numer", ctypes.c_uint32), ("denom", ctypes.c_uint32)]

        lib.mach_timebase_info.argtypes = [ctypes.POINTER(Timebase)]
        lib.mach_timebase_info.restype = ctypes.c_int
        base = Timebase()
        result = lib.mach_timebase_info(ctypes.byref(base))
        if result != 0 or not base.numer or not base.denom:
            raise RuntimeError(f"mach_timebase_info failed: {result}")
        self.numer, self.denom = base.numer, base.denom
        period = self.period_ns * self.denom // self.numer
        # Budget 1/4 of each period for eight steppers and sensor sub-ticks;
        # constraint 1/2 period leaves the remainder for serial/HTTP threads.
        policy = (ctypes.c_int32 * 4)(period, period // 4, period // 2, 1)
        thread = lib.pthread_mach_thread_np(lib.pthread_self())
        result = lib.thread_policy_set(thread, 2, policy, 4)
        if result != 0:
            raise RuntimeError(f"motion thread time-constraint request failed: {result}")
        self.lib = lib
        self.mode = "mach-absolute/time-constraint"

    def wait_until(self, deadline_ns):
        while not self.stop.is_set():
            remaining = deadline_ns - time.perf_counter_ns()
            if remaining <= 0:
                break
            if self.lib is None:
                self.stop.wait(remaining / 1e9)
            else:
                deadline = self.lib.mach_absolute_time() + remaining * self.denom // self.numer
                # CDLL releases the GIL while sleeping. Shutdown waits at most
                # one period, so no extra wakeup thread or busy-wait is needed.
                result = self.lib.mach_wait_until(deadline)
                if result not in (0, 14):  # KERN_SUCCESS / KERN_ABORTED (interrupted)
                    raise RuntimeError(f"mach_wait_until failed: {result}")
                # An interrupted wait is not permission to advance time early.
        return self.stop.is_set()
