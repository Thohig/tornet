#!/usr/bin/env python3
"""Enkel webbserver för Tornet.

Som `python3 -m http.server`, men säger åt webbläsaren att aldrig cacha filerna,
så att en vanlig omladdning alltid ger senaste versionen av spelet.

Kör:  python3 serve.py              (port 8123, bara den här datorn)
      python3 serve.py 9000         (annan port)
      python3 serve.py --lan        (även andra på nätverket, t.ex. mobilen på samma wifi)
      python3 serve.py --auto-stop  (stänger av sig själv när spelet tystnat)

Servern lyssnar bara på den egna datorn (localhost) om inte --lan anges.

Servern lämnar bara ut spelets filer (ALLOWED), allt annat – .git, node_modules … – ger 404.

Säkert läge (--auto-stop, går inte ihop med --lan):
  - stänger av sig själv när spelet inte har hört av sig på PING_TIMEOUT sekunder
    (spelet anropar /ping var 30:e sekund, se main.js) och senast efter MAX_LIFETIME
"""
import http.server
import socket
import sys
import threading
import time
import urllib.parse

PING_TIMEOUT = 5 * 60         # sekunder utan ping innan servern går ner
MAX_LIFETIME = 12 * 60 * 60   # längsta tid servern får köra i säkert läge
ALLOWED = ("/", "/index.html", "/style.css", "/tests.html", "/src/", "/ikon/", "/fonts/", "/tests/")  # ny mapp i spelet = ny rad här

last_ping = time.monotonic()


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    def _path(self):
        # avkodad (%2e%2e = ..), som translate_path läser den
        return urllib.parse.unquote(self.path.split("?", 1)[0].split("#", 1)[0])

    def _allowed(self):
        p = self._path()
        if ".." in p or "/." in p:
            return False
        return any(p == a if not a.endswith("/") or a == "/" else p.startswith(a) for a in ALLOWED)

    def do_GET(self):
        global last_ping
        if self._path() == "/ping":
            last_ping = time.monotonic()
            self.send_response(204)
            self.end_headers()
            return
        if not self._allowed():
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        if not self._allowed():
            self.send_error(404)
            return
        super().do_HEAD()

    def log_message(self, format, *args):
        if self._path() != "/ping":  # pingen var 30:e sekund skräpar bara ner loggen
            super().log_message(format, *args)


class DualStackServer(http.server.ThreadingHTTPServer):
    """Lyssnar på både IPv6 och IPv4. Safari slår ofta upp localhost som ::1 (IPv6),
    och en server som bara lyssnar på IPv4 svarar då inte alls."""
    address_family = socket.AF_INET6

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except (AttributeError, OSError):
            pass
        super().server_bind()


class LoopbackV6Server(http.server.ThreadingHTTPServer):
    address_family = socket.AF_INET6


def open_servers(port, lan):
    """Öppna servrarna. Bara den egna datorn: en på ::1 och en på 127.0.0.1 (localhost kan vara
    vilken som). --lan: en som lyssnar på alla nätverkskort."""
    if lan:
        try:
            return [DualStackServer(("::", port), NoCacheHandler)]
        except OSError:
            # ingen IPv6 på datorn – kör som förut på bara IPv4
            return [http.server.ThreadingHTTPServer(("", port), NoCacheHandler)]
    servers = [http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler)]
    try:
        servers.append(LoopbackV6Server(("::1", port), NoCacheHandler))
    except OSError:
        pass  # ingen IPv6 – IPv4 räcker
    return servers


def watchdog(servers, started):
    """Stänger servrarna när spelet har tystnat eller servern har kört för länge."""
    while True:
        time.sleep(10)
        now = time.monotonic()
        why = ("ingen ping på %d min" % (PING_TIMEOUT // 60) if now - last_ping > PING_TIMEOUT
               else "har kört i %d h" % (MAX_LIFETIME // 3600) if now - started > MAX_LIFETIME
               else None)
        if why:
            print(f"Tornet stänger servern: {why}", flush=True)
            for s in servers:
                s.shutdown()
            return


if __name__ == "__main__":
    args = sys.argv[1:]
    safe = "--auto-stop" in args
    lan = "--lan" in args and not safe
    nums = [a for a in args if a.isdigit()]
    port = int(nums[0]) if nums else 8123
    servers = open_servers(port, lan)
    if safe:
        print(f"Tornet körs på http://localhost:{port}  (säkert läge: bara den här datorn, "
              f"stängs {PING_TIMEOUT // 60} min efter att spelet stängts, senast efter {MAX_LIFETIME // 3600} h)",
              flush=True)
        threads = [threading.Thread(target=s.serve_forever, daemon=True) for s in servers]
        for t in threads:
            t.start()
        watchdog(servers, time.monotonic())
    else:
        where = "även för andra på nätverket" if lan else "bara den här datorn, --lan för mobilen"
        print(f"Tornet körs på http://localhost:{port}  ({where}; Ctrl+C för att stoppa)", flush=True)
        threads = [threading.Thread(target=s.serve_forever, daemon=True) for s in servers]
        for t in threads:
            t.start()
        try:
            threads[0].join()
        except KeyboardInterrupt:
            pass
