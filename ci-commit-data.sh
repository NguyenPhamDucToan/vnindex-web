#!/usr/bin/env bash
# Commit and push whatever changed under data/ -- called by refresh-slow.yml
# after each long step, so a runner lost mid-sweep (it happened on 2026-11-08,
# four hours in) keeps the steps that had already finished.
#   bash ci-commit-data.sh "message"
set -euo pipefail
git config user.name  "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add data
if git diff --cached --quiet; then
  echo "nothing changed"
  exit 0
fi
git commit -q -m "${1:-Weekly refresh of side-loaded data}"
# The sweep runs for hours; take any push made meanwhile (data/ is ours alone,
# but code pushes land on the same branch).
for i in 1 2 3; do
  git pull -q --rebase && git push -q && exit 0
  sleep $((i * 20))
done
echo "push failed" >&2
exit 1
