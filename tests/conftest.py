"""model_valuation imports the sibling repo's config/models/valuation packages,
and config reads DATABASE_URL at import. Point it at a throwaway SQLite file
BEFORE anything imports it, so no test can reach the production database."""
import os
import sys
import tempfile
from pathlib import Path

_DB = Path(tempfile.mkdtemp(prefix="vnweb-tests-")) / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_DB.as_posix()}"

ROOT = Path(__file__).resolve().parent.parent
SIBLING = ROOT.parent / "vnindex-valuation"
for p in (str(ROOT), str(SIBLING)):
    if p not in sys.path:
        sys.path.insert(0, p)
