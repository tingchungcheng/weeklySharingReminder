#!/usr/bin/env python3
"""
Serve web/ on PORT (default 8080) and proxy /__weekly_api/* to the real API.

Use this when the browser cannot call execute-api directly (CORS, extensions, etc.).
Set in web/api-config.js: WEEKLY_SHARING_DEV_API_PROXY = true (see that file).

  export WEEKLY_SHARING_API_PROXY_TARGET="https://YOUR_ID.execute-api.REGION.amazonaws.com"
  python3 sam/scripts/dev_http_server.py

Or rely on the default target in this file (update if your stack URL changes).
"""
from __future__ import annotations

import http.server
import os
import socketserver
import urllib.error
import urllib.parse
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.normpath(os.path.join(SCRIPT_DIR, "..", ".."))
WEB_ROOT = os.path.join(REPO_ROOT, "web")

API_TARGET = os.environ.get(
    "WEEKLY_SHARING_API_PROXY_TARGET",
    "https://aic25c4d4j.execute-api.ap-southeast-1.amazonaws.com",
).rstrip("/")

PORT = int(os.environ.get("PORT", "8080"))
PROXY_PREFIX = "/__weekly_api"


def _proxy_subpath_and_query(path: str) -> tuple[str, str] | None:
    u = urllib.parse.urlparse(path)
    if not u.path.startswith(PROXY_PREFIX + "/") and u.path != PROXY_PREFIX:
        return None
    sub = u.path[len(PROXY_PREFIX) :] or "/"
    if not sub.startswith("/"):
        sub = "/" + sub
    q = "?" + u.query if u.query else ""
    return sub, q


class DevHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.abspath(WEB_ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        print(f"[dev] {self.address_string()} - {fmt % args}")

    def _answer_options_locally(self) -> bool:
        parsed = _proxy_subpath_and_query(self.path)
        if parsed is None:
            return False
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers", "Content-Type, Authorization"
        )
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()
        return True

    def _forward_to_api(self) -> bool:
        parsed = _proxy_subpath_and_query(self.path)
        if parsed is None:
            return False
        sub, q = parsed
        url = API_TARGET + sub + q

        length = int(self.headers.get("Content-Length", 0))
        body = None
        if length > 0 and self.command in ("PUT", "POST", "PATCH"):
            body = self.rfile.read(length)

        h = {}
        for name in ("Content-Type", "Authorization"):
            if name in self.headers:
                h[name] = self.headers[name]

        req = urllib.request.Request(url, data=body, method=self.command, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
                self.send_response(resp.status)
                for k, v in resp.headers.items():
                    lk = k.lower()
                    if lk in ("transfer-encoding", "connection"):
                        continue
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            payload = e.read()
            self.send_response(e.code)
            for k, v in e.headers.items():
                lk = k.lower()
                if lk in ("transfer-encoding", "connection"):
                    continue
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(payload)
        except urllib.error.URLError as e:
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            msg = f"Proxy upstream error: {e.reason}\nTarget: {url}\n"
            self.wfile.write(msg.encode("utf-8"))
        return True

    def do_OPTIONS(self) -> None:
        if self._answer_options_locally():
            return
        super().do_OPTIONS()

    def do_GET(self) -> None:
        if self._forward_to_api():
            return
        super().do_GET()

    def do_PUT(self) -> None:
        if self._forward_to_api():
            return
        self.send_error(404, "Not Found")

    def do_POST(self) -> None:
        if self._forward_to_api():
            return
        super().do_POST()


def main() -> None:
    os.chdir(WEB_ROOT)
    with socketserver.TCPServer(("", PORT), DevHandler) as httpd:
        print(f"Serving web/ + API proxy at http://127.0.0.1:{PORT}/")
        print(f"  static:  http://127.0.0.1:{PORT}/")
        print(f"  proxy:   http://127.0.0.1:{PORT}{PROXY_PREFIX}/names")
        print(f"  upstream {API_TARGET}")
        print("Set WEEKLY_SHARING_DEV_API_PROXY = true in web/api-config.js")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
