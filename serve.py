"""Local dev server that serves .js with the correct MIME type.

Python's stdlib http.server reads .js from the Windows registry, which is
often mislabelled text/plain -- browsers then refuse to load ES modules. This
overrides that. Production (GitHub Pages) serves .js correctly already, so this
file is a dev convenience only.  Usage: python serve.py [port]
"""
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
    }


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    print(f"Serving on http://localhost:{port}")
    HTTPServer(("", port), Handler).serve_forever()
