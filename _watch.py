# -*- coding: utf-8 -*-
"""Wait for the newest run, then print every step's outcome."""
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO = "NguyenPhamDucToan/vnindex-web"
HERE = Path(__file__).resolve().parent

out = subprocess.run(["git", "credential", "fill"],
                     input="protocol=https\nhost=github.com\n\n",
                     capture_output=True, text=True, cwd=str(HERE))
TOK = next(l.split("=", 1)[1] for l in out.stdout.splitlines() if l.startswith("password="))


def get(url):
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {TOK}")
    req.add_header("Accept", "application/vnd.github+json")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())


run = None
deadline = time.time() + 40 * 60
while time.time() < deadline:
    run = get(f"https://api.github.com/repos/{REPO}/actions/runs?per_page=1")["workflow_runs"][0]
    if run["status"] == "completed":
        break
    time.sleep(40)

print(f"run {run['id']}  {run['status']}  {run['conclusion']}")
for job in get(f"https://api.github.com/repos/{REPO}/actions/runs/{run['id']}/jobs")["jobs"]:
    print(f"\n{job['name']}: {job['conclusion']}")
    for s in job["steps"]:
        mark = "ok" if s["conclusion"] == "success" else (s["conclusion"] or s["status"])
        print(f"   {mark:10s} {s['name']}")
sys.exit(0 if run["conclusion"] == "success" else 1)
