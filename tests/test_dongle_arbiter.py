import asyncio
import importlib.util
import pathlib
import sys
import unittest

_path = pathlib.Path(__file__).resolve().parents[1] / "docs" / "remote-dump1090" / "dongle_arbiter.py"
_spec = importlib.util.spec_from_file_location("dongle_arbiter", _path)
arbiter_mod = importlib.util.module_from_spec(_spec)
sys.modules["dongle_arbiter"] = arbiter_mod
_spec.loader.exec_module(arbiter_mod)


class FakeHost:
    """Stands in for systemctl: start/stop commands open/close an echo backend."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.servers: dict[str, asyncio.base_events.Server] = {}
        self.ports: dict[str, int] = {}
        self.fail_start: set[str] = set()

    async def _echo(self, reader, writer) -> None:
        while data := await reader.read(1024):
            writer.write(data.upper())
            await writer.drain()
        writer.close()

    async def run(self, cmd: list[str]) -> int:
        action, name = cmd
        self.calls.append(f"{action} {name}")
        if action == "start":
            if name in self.fail_start:
                return 1
            if name not in self.servers:
                server = await asyncio.start_server(self._echo, "127.0.0.1", self.ports[name])
                self.servers[name] = server
        else:
            server = self.servers.pop(name, None)
            if server:
                server.close()
                await server.wait_closed()
        return 0


def free_port() -> int:
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class ArbiterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.host = FakeHost()
        profiles = []
        for name in ("sbs", "rtl"):
            self.host.ports[name] = free_port()
            profiles.append(arbiter_mod.Profile(name, 0, self.host.ports[name],
                                                ["start", name], ["stop", name]))
        self.arbiter = arbiter_mod.Arbiter(profiles, listen_host="127.0.0.1", idle_grace_s=0.3,
                                           start_timeout_s=3.0, run=self.host.run)
        await self.arbiter.start()

    async def asyncTearDown(self) -> None:
        await self.arbiter.close()

    async def connect(self, name: str):
        return await asyncio.open_connection("127.0.0.1", self.arbiter.profiles[name].bound_port)

    async def eof(self, reader) -> bool:
        return await asyncio.wait_for(reader.read(10), 3.0) == b""

    async def test_first_client_claims_relays_and_releases_after_grace(self) -> None:
        self.assertEqual(self.host.calls, ["stop sbs", "stop rtl"])
        reader, writer = await self.connect("sbs")
        writer.write(b"msg")
        self.assertEqual(await asyncio.wait_for(reader.read(10), 3.0), b"MSG")
        self.assertEqual(self.arbiter.owner, "sbs")
        self.assertEqual(self.host.calls[2:], ["start sbs"])
        writer.close()
        await asyncio.sleep(0.1)
        self.assertEqual(self.arbiter.owner, "sbs", "held through the grace period")
        await asyncio.sleep(0.6)
        self.assertIsNone(self.arbiter.owner)
        self.assertEqual(self.host.calls[-1], "stop sbs")

    async def test_other_service_is_refused_while_dongle_is_held(self) -> None:
        reader, writer = await self.connect("sbs")
        writer.write(b"x")
        await reader.read(1)
        other_reader, other_writer = await self.connect("rtl")
        self.assertTrue(await self.eof(other_reader))
        self.assertNotIn("start rtl", self.host.calls)
        self.assertEqual(self.arbiter.owner, "sbs")
        other_writer.close()
        writer.close()

    async def test_refused_text_client_is_told_who_holds_the_dongle(self) -> None:
        self.arbiter.profiles["rtl"].refusal_message = "BUSY,in use by {owner}; free {grace}s after"
        reader, writer = await self.connect("sbs")
        writer.write(b"x")
        await reader.read(1)
        other_reader, other_writer = await self.connect("rtl")
        line = await asyncio.wait_for(other_reader.readline(), 3.0)
        self.assertEqual(line, b"BUSY,in use by sbs; free 0s after\r\n")
        self.assertTrue(await self.eof(other_reader))
        # A profile without a refusal message (binary protocol) gets nothing at all.
        self.assertIsNone(self.arbiter.profiles["sbs"].refusal_message)
        other_writer.close()
        writer.close()

    async def test_reconnect_within_grace_keeps_backend_running(self) -> None:
        reader, writer = await self.connect("sbs")
        writer.write(b"a")
        await reader.read(1)
        writer.close()
        await asyncio.sleep(0.1)
        reader, writer = await self.connect("sbs")
        writer.write(b"b")
        self.assertEqual(await asyncio.wait_for(reader.read(1), 3.0), b"B")
        await asyncio.sleep(0.6)
        self.assertEqual(self.arbiter.owner, "sbs", "new client keeps the dongle")
        self.assertEqual(self.host.calls.count("start sbs"), 1)
        self.assertEqual(self.host.calls.count("stop sbs"), 1, "only the initial stop")
        writer.close()

    async def test_dongle_is_free_for_the_other_service_after_release(self) -> None:
        reader, writer = await self.connect("sbs")
        writer.write(b"a")
        await reader.read(1)
        writer.close()
        await asyncio.sleep(0.7)
        reader, writer = await self.connect("rtl")
        writer.write(b"z")
        self.assertEqual(await asyncio.wait_for(reader.read(1), 3.0), b"Z")
        self.assertEqual(self.arbiter.owner, "rtl")
        writer.close()

    async def test_failed_start_frees_the_dongle_and_closes_the_client(self) -> None:
        self.host.fail_start.add("sbs")
        reader, writer = await self.connect("sbs")
        self.assertTrue(await self.eof(reader))
        self.assertIsNone(self.arbiter.owner)
        self.assertEqual(self.host.calls[-1], "stop sbs")
        self.host.fail_start.clear()
        reader, writer = await self.connect("rtl")
        writer.write(b"q")
        self.assertEqual(await asyncio.wait_for(reader.read(1), 3.0), b"Q")
        writer.close()


if __name__ == "__main__":
    unittest.main()
