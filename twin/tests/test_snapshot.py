"""HTTP metrics own interval selection, unlike the PTY command transcripts.

Regression: ignoring since_tick contaminates A2 statistics with startup/idle
samples. A real loopback server catches query handling; no test-only seam.
A deliberately held state lock must mark missed deadlines, never hide ticks.
"""

from pathlib import Path as _PublicPath
import pytest as _public_pytest
if not (_PublicPath(__file__).resolve().parents[1] / "fixtures/r20.json").is_file():
    _public_pytest.skip("local-only R20 fixtures", allow_module_level=True)

import asyncio
import time

from aiohttp import ClientSession, web

from wonky_twin.runtime import Twin
from wonky_twin.server import application


def test_snapshot_stream_and_interval_metrics_preserve_invalid_run():
    async def observe():
        with Twin() as twin:
            runner = web.AppRunner(application(twin), shutdown_timeout=.1)
            await runner.setup()
            try:
                await web.TCPSite(runner, "127.0.0.1", 0).start()
                url = f"http://127.0.0.1:{runner.addresses[0][1]}"
                # Wait for the clock to be live before planting the stall;
                # OS scheduler setup is not itself a simulated tick.
                deadline = time.monotonic() + 2
                while twin.clock.sim_ns == 0:
                    assert time.monotonic() < deadline and twin.clock.error is None
                    await asyncio.sleep(.001)
                # Deliberate deadline miss. This is not a scheduling mock.
                with twin.lock:
                    time.sleep(.012)
                await asyncio.sleep(.03)
                async with ClientSession() as client:
                    async with client.get(url + "/metrics") as response:
                        before = await response.json()
                    assert before["overruns"] > 0 and not before["valid"]
                    async with client.ws_connect(url + "/twin") as ws:
                        first = await ws.receive_json(timeout=2)
                        second = await ws.receive_json(timeout=2)
                    assert first["schema"] == "wonky.twin-snapshot/1"
                    assert first["epoch"] == second["epoch"] == twin.clock.epoch
                    assert second["sim_ns"] > first["sim_ns"]
                    assert not second["valid"] and second["overruns"] > 0
                    async with client.get(url + f'/metrics?since_tick={before["ticks"]}') as response:
                        after = await response.json()
                    assert after["since_tick"] == before["ticks"]
                    assert after["measured_ticks"] == after["ticks"] - before["ticks"]
                    assert 0 < after["measured_ticks"] < after["ticks"]
                    assert after["run_overruns"] >= before["overruns"]
                    assert not after["valid"]  # A clean interval cannot revalidate a run.
                    assert after["sim_ns"] == after["ticks"] * 1_000_000
                    for invalid in ("-1", "nan", str(after["ticks"] + 1_000_000)):
                        async with client.get(url + "/metrics?since_tick=" + invalid) as response:
                            assert response.status == 400
            finally:
                await runner.cleanup()
    asyncio.run(observe())


def test_long_interval_metrics_keep_exact_quantiles_and_all_missed_ticks():
    # Arithmetic oracle for reporting, not live realtime evidence. An offset
    # crossing multiple copy chunks catches wrong source/destination offsets;
    # the HTTP test above only owns routing and lifetime invalidation.
    from array import array
    import threading
    from wonky_twin.clock import SimClock

    clock = SimClock(lambda _: None, threading.RLock())
    clock.jitter_ns = array("q", (i * 1000 for i in range(8193, -1, -1)))
    clock.sim_ns = 8194 * 1_000_000
    clock.overruns = 7194
    result = clock.metrics(since_tick=1)
    assert result["ticks"] == 8194 and result["measured_ticks"] == 8193
    assert result["sim_ns"] == 8_194_000_000
    assert result["overruns"] == 7193 and result["run_overruns"] == 7194
    assert result["jitter_ms"] == {"p50": 4.096, "p95": 7.782, "max": 8.192}
    assert not result["valid"]
    empty = clock.metrics(since_tick=8194)
    assert empty["measured_ticks"] == empty["overruns"] == 0
    assert empty["jitter_ms"] == {"p50": 0, "p95": 0, "max": 0}
    assert not empty["valid"]
