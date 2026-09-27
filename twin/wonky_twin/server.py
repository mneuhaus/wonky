"""Loopback snapshot API. Slow websocket clients do not hold the motion lock."""
import asyncio
from contextlib import suppress
from aiohttp import web


def application(twin):
    async def snapshot(request):
        return web.json_response(twin.snapshot())

    async def metrics(request):
        try:
            result = await asyncio.to_thread(twin.clock.metrics, int(request.query.get("since_tick", "0")))
        except ValueError as exc:
            raise web.HTTPBadRequest(text=str(exc)) from exc
        return web.json_response(result)

    async def stream(request):
        ws = web.WebSocketResponse(heartbeat=15)
        await ws.prepare(request)

        async def send_snapshots():
            loop = asyncio.get_running_loop()
            start, frame = loop.time(), 0
            try:
                while not ws.closed:
                    await asyncio.wait_for(ws.send_json(twin.snapshot()), timeout=1)
                    frame += 1
                    await asyncio.sleep(max(0, start + frame / 30 - loop.time()))
            except (ConnectionError, asyncio.TimeoutError):
                await ws.close()

        sender = asyncio.create_task(send_snapshots())
        try:
            # Read control frames too: otherwise clients cannot complete their
            # close handshake, and server heartbeats never consume the pong.
            async for _message in ws:
                await ws.close(code=1003, message=b"Snapshot stream is read-only")
        finally:
            sender.cancel()
            with suppress(asyncio.CancelledError):
                await sender
            await ws.close()
        return ws

    app = web.Application()
    app.router.add_get("/snapshot", snapshot)
    app.router.add_get("/metrics", metrics)
    app.router.add_get("/twin", stream)
    return app
