#!/usr/bin/env python3
"""Mock "Solith" localhost service for the Game Bar widget POC.

Simulates the shape of an IPC endpoint the real Solith Electron app could
expose so the widget can prove out a request/response round trip without any
real trainer/injection logic on either side.

Deliberately minimal and deliberately loopback-only:
  - Binds to 127.0.0.1, never 0.0.0.0 - not reachable from the network.
  - Exactly one route, GET /ping -> a fixed JSON body.
  - No process control, no file access, no shell execution, no dynamic
    command dispatch of any kind.

Run:
    python server.py [port]      (default port 8787)

Stop:
    Ctrl+C
"""
from __future__ import annotations

import json
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

DEFAULT_PORT = 8787
LOOPBACK_HOST = "127.0.0.1"


class MockSolithHandler(BaseHTTPRequestHandler):
    server_version = "MockSolith/0.1"

    def _send_json(self, status_code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        # Loopback-only mock; CORS is irrelevant for a same-machine widget
        # call, but scope it explicitly rather than leaving it unset.
        self.send_header("Access-Control-Allow-Origin", "null")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler API name)
        if self.path == "/ping":
            self._send_json(
                200,
                {
                    "service": "mock-solith",
                    "status": "ok",
                    "message": "Wisp says hello from the Game Bar widget POC",
                    "serverTimeUnixMs": int(time.time() * 1000),
                },
            )
            return

        self._send_json(404, {"service": "mock-solith", "status": "not_found", "path": self.path})

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        sys.stderr.write(f"[mock-solith] {self.address_string()} - {format % args}\n")


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    server = HTTPServer((LOOPBACK_HOST, port), MockSolithHandler)
    print(f"[mock-solith] listening on http://{LOOPBACK_HOST}:{port}/ping (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[mock-solith] shutting down")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
