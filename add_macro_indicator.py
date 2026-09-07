"""Patch one macro indicator into data/macro.json without a full re-export.

export_data.py rewrites every ticker file as well, which is a five minute run
for one series. This pulls the named indicators straight from the DB and merges
them into the existing macro.json.

    python add_macro_indicator.py fdi_cumulative [more ...]
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
SIBLING = HERE.parent / "vnindex-valuation"


def _db_url() -> str:
    """Same resolution order export_data.py uses: env first, sibling .env next."""
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env = SIBLING / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return f"sqlite:///{SIBLING / 'vnindex.db'}"


def main() -> None:
    names = sys.argv[1:]
    if not names:
        raise SystemExit("usage: python add_macro_indicator.py <indicator> [...]")

    from sqlalchemy import create_engine, text
    engine = create_engine(_db_url())

    path = DATA / "macro.json"
    macro = json.loads(path.read_text(encoding="utf-8"))
    with engine.connect() as conn:
        for name in names:
            rows = conn.execute(text(
                "SELECT period, value FROM macro_indicators "
                "WHERE indicator = :i ORDER BY period"), {"i": name}).fetchall()
            if not rows:
                print(f"{name}: not in the database")
                continue
            macro[name] = [{"period": str(p), "value": (float(v) if v is not None else None)}
                           for p, v in rows]
            print(f"{name}: {len(rows)} points "
                  f"({rows[0][0]} -> {rows[-1][0]})")

    path.write_text(json.dumps(macro, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")
    print(f"macro.json now holds {len(macro)} indicators")


if __name__ == "__main__":
    main()
