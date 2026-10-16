#!/usr/bin/env python3
"""First-come-wins arbiter for one RTL-SDR dongle shared by dump1090 and rtl_tcp.

Runs on the host that has the dongle. It listens on the public ports (SBS 30003
for AirWSJT-X, rtl_tcp 1234 for other SDR apps) and starts the matching backend
service only while a client is connected. Whoever connects first owns the dongle;
clients of the other service are refused until the owner has disconnected and the
idle grace period has passed, after which the backend is stopped and the dongle is
free again.

Backends must listen on localhost only, on different ports than the public ones,
and must not be enabled at boot (this daemon starts and stops them).

Standard library only. Needs root (or sudo rights) to run `systemctl`.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import signal
from dataclasses import dataclass, field
from typing import Awaitable, Callable

log = logging.getLogger("dongle-arbiter")

COMMAND_TIMEOUT_S = 30.0


@dataclass
class Profile:
    name: str
    listen_port: int
    backend_port: int
    start_cmd: list[str]
    stop_cmd: list[str]
    backend_host: str = "127.0.0.1"
    # Text line sent to a refused client before closing, for text protocols only.
    # {owner} is the service holding the dongle, {grace} the idle release delay in seconds.
    refusal_message: str | None = None
    bound_port: int | None = field(default=None, init=False)


DEFAULT_PROFILES = [
    Profile("dump1090", 30003, 30103,
            ["systemctl", "start", "dump1090-ondemand"],
            ["systemctl", "stop", "dump1090-ondemand"],
            refusal_message="BUSY,RTL-SDR in use by {owner}; free about {grace}s after it disconnects"),
    Profile("rtl_tcp", 1234, 12340,
            ["systemctl", "start", "rtl-tcp-ondemand"],
            ["systemctl", "stop", "rtl-tcp-ondemand"]),
]

RunCommand = Callable[[list[str]], Awaitable[int]]


async def run_command(cmd: list[str]) -> int:
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
        _, err = await asyncio.wait_for(proc.communicate(), COMMAND_TIMEOUT_S)
    except (OSError, asyncio.TimeoutError) as exc:
        log.error("command %s failed: %s", cmd, exc)
        return 1
    if proc.returncode:
        log.error("command %s exited %s: %s", cmd, proc.returncode, err.decode(errors="replace").strip())
    return proc.returncode or 0


class Arbiter:
    def __init__(self, profiles: list[Profile], *, listen_host: str = "0.0.0.0",
                 idle_grace_s: float = 30.0, start_timeout_s: float = 20.0,
                 run: RunCommand = run_command) -> None:
        self.profiles = {p.name: p for p in profiles}
        self.listen_host = listen_host
        self.idle_grace_s = idle_grace_s
        self.start_timeout_s = start_timeout_s
        self._run = run
        self.owner: str | None = None
        self._connections = 0
        self._epoch = 0
        self._lock = asyncio.Lock()
        self._servers: list[asyncio.base_events.Server] = []
        self._writers: set[asyncio.StreamWriter] = set()
        self._release_tasks: set[asyncio.Future] = set()

    async def start(self, *, initial_stop: bool = True) -> None:
        if initial_stop:
            # Establish the "dongle is free" invariant before taking clients.
            for profile in self.profiles.values():
                await self._run(profile.stop_cmd)
        for profile in self.profiles.values():
            server = await asyncio.start_server(
                lambda r, w, p=profile: self._handle(p, r, w), self.listen_host, profile.listen_port)
            profile.bound_port = server.sockets[0].getsockname()[1]
            self._servers.append(server)
            log.info("listening on %s:%s for %s (backend %s:%s)", self.listen_host,
                     profile.bound_port, profile.name, profile.backend_host, profile.backend_port)

    async def close(self) -> None:
        for server in self._servers:
            server.close()
        for writer in list(self._writers):
            writer.close()
        for task in list(self._release_tasks):
            task.cancel()
        await asyncio.sleep(0)
        async with self._lock:
            if self.owner:
                await self._run(self.profiles[self.owner].stop_cmd)
                self.owner = None

    async def _probe(self, profile: Profile) -> bool:
        try:
            _, writer = await asyncio.wait_for(
                asyncio.open_connection(profile.backend_host, profile.backend_port), 1.0)
        except (OSError, asyncio.TimeoutError):
            return False
        writer.close()
        return True

    async def _start_backend(self, profile: Profile) -> bool:
        if await self._run(profile.start_cmd):
            return False
        deadline = asyncio.get_running_loop().time() + self.start_timeout_s
        while asyncio.get_running_loop().time() < deadline:
            if await self._probe(profile):
                return True
            await asyncio.sleep(0.25)
        log.error("%s did not start listening on %s:%s", profile.name, profile.backend_host, profile.backend_port)
        return False

    async def _admit(self, profile: Profile) -> bool:
        if self.owner not in (None, profile.name):
            return False
        async with self._lock:
            if self.owner not in (None, profile.name):
                return False
            self._epoch += 1
            first = self._connections == 0
            self.owner = profile.name
            self._connections += 1
            if first and not await self._probe(profile):
                log.info("claiming dongle for %s", profile.name)
                if not await self._start_backend(profile):
                    await self._run(profile.stop_cmd)
                    self._connections -= 1
                    if self._connections == 0:
                        self.owner = None
                    return False
            return True

    def _leave(self) -> None:
        self._connections -= 1
        if self._connections == 0:
            self._epoch += 1
            task = asyncio.ensure_future(self._release_after_grace(self._epoch))
            self._release_tasks.add(task)
            task.add_done_callback(self._release_tasks.discard)

    async def _release_after_grace(self, epoch: int) -> None:
        await asyncio.sleep(self.idle_grace_s)
        async with self._lock:
            if epoch != self._epoch or self._connections or not self.owner:
                return
            log.info("releasing dongle held by %s", self.owner)
            await self._run(self.profiles[self.owner].stop_cmd)
            self.owner = None

    async def _handle(self, profile: Profile, reader: asyncio.StreamReader,
                      writer: asyncio.StreamWriter) -> None:
        peer = writer.get_extra_info("peername")
        self._writers.add(writer)
        try:
            if not await self._admit(profile):
                owner = self.owner
                log.info("refused %s client %s (dongle held by %s)", profile.name, peer, owner)
                await self._send_refusal(profile, owner, writer)
                return
            try:
                await self._pipe(profile, reader, writer)
            finally:
                self._leave()
        finally:
            self._writers.discard(writer)
            writer.close()

    async def _send_refusal(self, profile: Profile, owner: str | None,
                            writer: asyncio.StreamWriter) -> None:
        if not profile.refusal_message:
            return
        text = profile.refusal_message.format(owner=owner or "another program",
                                              grace=int(self.idle_grace_s))
        try:
            writer.write(text.encode() + b"\r\n")
            await asyncio.wait_for(writer.drain(), 2.0)
        except (OSError, asyncio.TimeoutError):
            pass

    async def _pipe(self, profile: Profile, reader: asyncio.StreamReader,
                    writer: asyncio.StreamWriter) -> None:
        try:
            back_reader, back_writer = await asyncio.wait_for(
                asyncio.open_connection(profile.backend_host, profile.backend_port), 5.0)
        except (OSError, asyncio.TimeoutError) as exc:
            log.error("cannot reach %s backend: %s", profile.name, exc)
            return

        async def copy(src: asyncio.StreamReader, dst: asyncio.StreamWriter) -> None:
            try:
                while data := await src.read(65536):
                    dst.write(data)
                    await dst.drain()
            except (OSError, asyncio.CancelledError):
                pass

        tasks = [asyncio.ensure_future(copy(reader, back_writer)),
                 asyncio.ensure_future(copy(back_reader, writer))]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in tasks:
                task.cancel()
            back_writer.close()


def load_profiles(path: str | None) -> list[Profile]:
    if not path:
        return DEFAULT_PROFILES
    with open(path, encoding="utf-8") as fh:
        return [Profile(**item) for item in json.load(fh)["profiles"]]


async def main_async(args: argparse.Namespace) -> None:
    arbiter = Arbiter(load_profiles(args.config), listen_host=args.listen,
                      idle_grace_s=args.idle_grace, start_timeout_s=args.start_timeout)
    await arbiter.start()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    await stop.wait()
    await arbiter.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--config", help="JSON file with a 'profiles' list (see config.example.json)")
    parser.add_argument("--listen", default="0.0.0.0", help="address for the public ports")
    parser.add_argument("--idle-grace", type=float, default=30.0,
                        help="seconds after the last client leaves before the dongle is released")
    parser.add_argument("--start-timeout", type=float, default=20.0,
                        help="seconds to wait for a backend to start listening")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
