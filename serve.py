"""로컬에서 앱 열기: python serve.py  →  http://localhost:8000

브라우저는 file:// 로 연 페이지에서 JSON·wasm을 읽지 못하고 서비스 워커도 못 쓰므로,
노트북에서 쓸 때는 이 작은 정적 서버로 연다(인터넷 연결은 필요 없다).
"""
import functools
import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".json": "application/json",
        ".wasm": "application/wasm",
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
        ".ttf": "font/ttf",
    }

    def log_message(self, *args):
        pass


def make_server(port=8000, host="127.0.0.1"):
    handler = functools.partial(Handler, directory=str(ROOT))
    return http.server.ThreadingHTTPServer((host, port), handler)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = make_server(port)
    print(f"SQLD 공부: http://localhost:{port}  (끄려면 Ctrl+C)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
