"""Run several backfills back to back, waiting for any in-flight one first.

VCI's Guest tier is ~20 requests a minute and throttles with SystemExit, so two
sweeps running at once just starve each other. This waits for whatever is
already fetching to finish, then works through the fields in order.

    python chain_backfill.py holders payables
"""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIELDS = sys.argv[1:] or ["holders"]


def fetch_running() -> bool:
    """True while another export_detailed / backfill process is alive."""
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
             "Where-Object { $_.CommandLine -match 'export_detailed|backfill\\.py' } | "
             "Measure-Object | Select-Object -ExpandProperty Count"],
            capture_output=True, text=True, timeout=60)
        return int((out.stdout or "0").strip() or 0) > 0
    except Exception:
        return False


waited = 0
while fetch_running() and waited < 7200:
    print(f"  another fetch is running; waiting ({waited}s)", flush=True)
    time.sleep(60)
    waited += 60

for field in FIELDS:
    print(f"\n=== backfill: {field} ===", flush=True)
    subprocess.run([sys.executable, "-u", "backfill.py", field], cwd=str(HERE))
print("\nchain done", flush=True)
