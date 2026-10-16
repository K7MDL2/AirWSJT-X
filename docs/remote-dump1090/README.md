# Sharing one RTL-SDR between dump1090 and rtl_tcp (remote receiver host)

AirWSJT-X reads aircraft from a dump1090 SBS feed on port 30003. When the RTL-SDR is
on another machine (for example a Raspberry Pi) that you also use through `rtl_tcp`,
only one program can own the dongle at a time. Starting and stopping the services by
hand is easy to forget.

`dongle_arbiter.py` does it automatically, **first come, first served**:

- It listens on the public ports: **30003** (SBS, for AirWSJT-X) and **1234** (rtl_tcp).
- The first client to connect starts the matching backend service.
- While that client is connected, clients of the *other* service are refused.
- When the last client has gone and a grace period (30 s by default) has passed, the
  backend is stopped and the dongle is free for the other service.

AirWSJT-X needs no changes: enter the host's IP in **dump1090 source** as usual. The
first connection takes a couple of seconds while dump1090 starts.

The backends listen on localhost only, so the arbiter's two ports are the only way in.
Standard library Python 3 only, run as root (it calls `systemctl`).

## Files

| File | Purpose |
|---|---|
| `dongle_arbiter.py` | The arbiter daemon |
| `dongle-arbiter.service` | systemd unit for the arbiter |
| `dump1090-ondemand.service` | dump1090-mutability on `127.0.0.1:30103` (SBS only), started by the arbiter |
| `rtl-tcp-ondemand.service` | `rtl_tcp` on `127.0.0.1:12340`, started by the arbiter |
| `config.example.json` | Ports and commands; the defaults are built in, so only needed to change them |

`dump1090-ondemand.service` reads the receiver location and tuning (`LAT`, `LON`,
`MAX_RANGE`, `PPM`) from `/etc/default/dump1090-mutability`, so nothing site-specific
is stored here. Adjust the paths and `User=` in the units if your install differs.

## Install (on the receiver host)

Copy this folder to the host, then:

```bash
# Strip Windows line endings if the files were copied from a Windows checkout
sudo mkdir -p /opt/dongle-arbiter
tr -d '\r' < dongle_arbiter.py | sudo tee /opt/dongle-arbiter/dongle_arbiter.py >/dev/null
for u in dump1090-ondemand rtl-tcp-ondemand dongle-arbiter; do
  tr -d '\r' < $u.service | sudo tee /etc/systemd/system/$u.service >/dev/null
done
sudo systemctl daemon-reload
```

### Try it first, without touching your running services

Run the arbiter on spare ports and reach them through an SSH tunnel (or open the
ports in your firewall). Your existing dump1090 on 30003 is stopped while a test
client holds the dongle; restart it afterwards.

```bash
sudo systemd-run --unit=arbiter-test python3 /opt/dongle-arbiter/dongle_arbiter.py \
    --config /opt/dongle-arbiter/test.json --idle-grace 15
# test.json: config.example.json with listen_port 31003 / 31234
sudo journalctl -fu arbiter-test        # claiming / refused / releasing
sudo systemctl stop arbiter-test; sudo systemctl start dump1090-mutability
```

### Switch over permanently

The arbiter takes over ports 30003 and 1234, so the packaged services must not run
at boot any more, and must be **stopped** (disabling alone leaves a running service on
30003, and the arbiter then cannot bind):

```bash
sudo systemctl disable --now dump1090-mutability rtl_tcp    # whichever exist
sudo systemctl enable --now dongle-arbiter
```

To go back: `sudo systemctl disable --now dongle-arbiter` and enable your original
services again.

## Behaviour notes

- **First come wins.** A client of the other service is disconnected immediately while
  the dongle is held. It does not queue and does not take the dongle from the owner.
  AirWSJT-X keeps retrying every 5 seconds and gets in once the dongle is free.
  An `rtl_tcp` app therefore cannot connect while AirWSJT-X is running: close
  AirWSJT-X, wait for the grace period, then connect it to port 1234.
- **"Busy" message.** Before disconnecting a refused SBS client, the arbiter sends one
  line, `BUSY,RTL-SDR in use by rtl_tcp; free about 30s after it disconnects`
  (`refusal_message` in the config; `{owner}` and `{grace}` are filled in). Ordinary SBS
  clients ignore the unknown line. AirWSJT-X (desktop and mobile) shows it as a yellow
  "busy" state instead of "connected" and logs it. The rtl_tcp port sends nothing,
  since that is a binary protocol.
- **Grace period.** Reconnecting within `--idle-grace` seconds keeps the backend
  running, so restarting AirWSJT-X does not restart dump1090.
- **Firewall.** Allow the two public ports (30003 and 1234) and nothing else.
  The backends are on localhost.
- **The receiver's own web map** (lighttpd reading `/run/dump1090-mutability`) works
  only while a client holds the dongle through dump1090.
- **Raw 30001/30002/30004/30005 outputs** are not exposed; the on-demand dump1090
  provides SBS only. Add the extra `--net-*` ports to `dump1090-ondemand.service` and
  matching profiles if you need them.
- If `rtl_tcp` is used with a tuner or gain script, it still sees the standard
  protocol; the arbiter only forwards bytes.

## Tested

On a Raspberry Pi 5 (Debian 12, systemd 252, dump1090-mutability 1.15, RTL2838 dongle):
SBS client received live aircraft, an rtl_tcp client was refused while it was held,
the dongle was released after the grace period and then served `rtl_tcp` (`RTL0`
header plus samples), and the reverse refusal and release also worked.
