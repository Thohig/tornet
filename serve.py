#!/usr/bin/env python3
"""Enkel webbserver för Hiss-O-Matic 3000.

Som `python3 -m http.server`, men säger åt webbläsaren att aldrig cacha filerna,
så att en vanlig omladdning alltid ger senaste versionen av spelet.

Kör:  python3 serve.py        (port 8123)
      python3 serve.py 9000   (annan port)
"""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    print(f"Hiss-O-Matic 3000 körs på http://localhost:{port}  (Ctrl+C för att stoppa)")
    http.server.ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
