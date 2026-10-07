"""
Hamlib rotator control via rotctld TCP interface.
rotctld protocol (port 4533 by default):
  p           → get current position → "Az: <f>\\nEl: <f>\\n\\nRPRT 0\\n"
  P <az> <el> → set target position
  S           → stop rotation
  R <az>      → reset (park)
"""
from __future__ import annotations

import socket
import threading
import time
from dataclasses import dataclass
from typing import Callable


@dataclass
class RotatorPosition:
    azimuth: float
    elevation: float


class HamlibRotator:
    """
    TCP client for rotctld. Polls position every `poll_interval_s` and
    fires callbacks for position changes.
    """

    DEFAULT_HOST = "127.0.0.1"
    DEFAULT_PORT = 4533

    def __init__(
        self,
        host: str = DEFAULT_HOST,
        port: int = DEFAULT_PORT,
        poll_interval_s: float = 0.5,
        on_position: Callable[[RotatorPosition], None] | None = None,
        on_connected: Callable[[], None] | None = None,
        on_disconnected: Callable[[], None] | None = None,
        on_error: Callable[[str], None] | None = None,
    ) -> None:
        self.host = host
        self.port = port
        self.poll_interval_s = poll_interval_s
        self.on_position = on_position
        self.on_connected = on_connected
        self.on_disconnected = on_disconnected
        self.on_error = on_error

        self._sock: socket.socket | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._current: RotatorPosition | None = None
        self._target: RotatorPosition | None = None
        self.connected = False

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self) -> None:
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        with self._lock:
            if self._sock:
                try:
                    self._sock.close()
                except Exception:
                    pass
                self._sock = None

    def set_position(self, azimuth: float, elevation: float) -> None:
        """Command rotator to move to (azimuth, elevation)."""
        self._target = RotatorPosition(azimuth, elevation)
        self._send(f"P {azimuth:.1f} {elevation:.1f}\n")

    def stop_rotation(self) -> None:
        """Send stop command."""
        self._send("S\n")
        self._target = None

    def park(self) -> None:
        """Park rotator at 0/0."""
        self.set_position(0.0, 0.0)

    @property
    def current_position(self) -> RotatorPosition | None:
        return self._current

    # ── Internal ──────────────────────────────────────────────────────────────

    def _send(self, cmd: str) -> str | None:
        with self._lock:
            if not self._sock:
                return None
            try:
                self._sock.sendall(cmd.encode())
                buf = b""
                while True:
                    chunk = self._sock.recv(256)
                    if not chunk:
                        break
                    buf += chunk
                    if b"RPRT" in buf or b"\n\n" in buf:
                        break
                return buf.decode("ascii", "ignore")
            except Exception as e:
                if self.on_error:
                    self.on_error(str(e))
                return None

    def _get_position(self) -> RotatorPosition | None:
        resp = self._send("p\n")
        if not resp:
            return None
        try:
            lines = [l.strip() for l in resp.splitlines() if l.strip()]
            az_line = next((l for l in lines if l.startswith("Az")), None)
            el_line = next((l for l in lines if l.startswith("El")), None)
            if az_line and el_line:
                az = float(az_line.split(":")[1].strip())
                el = float(el_line.split(":")[1].strip())
                return RotatorPosition(az, el)
            # Fallback: two bare floats
            nums = [float(l) for l in lines if l.replace(".", "").replace("-", "").isdigit()]
            if len(nums) >= 2:
                return RotatorPosition(nums[0], nums[1])
        except Exception:
            pass
        return None

    def _connect(self) -> bool:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(3.0)
            sock.connect((self.host, self.port))
            sock.settimeout(1.0)
            with self._lock:
                self._sock = sock
            self.connected = True
            if self.on_connected:
                self.on_connected()
            return True
        except Exception as e:
            if self.on_error:
                self.on_error(f"Cannot connect to rotctld at {self.host}:{self.port}: {e}")
            return False

    def _disconnect(self) -> None:
        self.connected = False
        with self._lock:
            if self._sock:
                try:
                    self._sock.close()
                except Exception:
                    pass
                self._sock = None
        if self.on_disconnected:
            self.on_disconnected()

    def _run(self) -> None:
        while not self._stop.is_set():
            if not self._connect():
                self._stop.wait(5.0)
                continue

            while not self._stop.is_set():
                pos = self._get_position()
                if pos is None:
                    self._disconnect()
                    break
                self._current = pos
                if self.on_position:
                    self.on_position(pos)
                self._stop.wait(self.poll_interval_s)

            if not self._stop.is_set():
                self._stop.wait(3.0)
