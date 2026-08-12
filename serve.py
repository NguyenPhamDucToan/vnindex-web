"""Local dev server that serves .js with the correct MIME type.

Python's stdlib http.server reads .js from the Windows registry, which is
often mislabelled text/plain -- browsers then refuse to load ES modules. This
overrides that. Production (GitHub Pages) serves .js correctly already, so this
file is a dev convenience only.  Usage: python serve.py [port]
"""
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
    }

    # The page pulls a stylesheet, seven ES modules and several JSON files at
    # once. Browsers fetch those over ~6 parallel keep-alive connections, and a
    # single-threaded HTTPServer answers one socket at a time -- the others sit
    # blocked until their connection times out, which shows up as a tab that
    # spins forever. ThreadingHTTPServer (below) handles them concurrently.
    def log_message(self, fmt, *args):      # keep the console quiet
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    print(f"Serving on http://localhost:{port}  (Ctrl+C to stop)")
    srv = ThreadingHTTPServer(("", port), Handler)
    srv.daemon_threads = True
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
