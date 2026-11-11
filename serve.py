#!/usr/bin/env python3
"""Enkel webbserver för Hiss-O-Matic 3000.

Som `python3 -m http.server`, men säger åt webbläsaren att aldrig cacha filerna,
så att en vanlig omladdning alltid ger senaste versionen av spelet.

Kör:  python3 serve.py        (port 8123)
      python3 serve.py 9000   (annan port)
"""
import http.server
import socket
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


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


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    print(f"Hiss-O-Matic 3000 körs på http://localhost:{port}  (Ctrl+C för att stoppa)")
    try:
        server = DualStackServer(("::", port), NoCacheHandler)
    except OSError:
        # ingen IPv6 på datorn – kör som förut på bara IPv4
        server = http.server.ThreadingHTTPServer(("", port), NoCacheHandler)
    server.serve_forever()
