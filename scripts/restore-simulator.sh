#!/usr/bin/env bash
# Restores workflow-simulator.tsx from last good commit and wires Capture Journey.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

echo "→ Restoring workflow-simulator.tsx from commit 15accb1..."
git show 15accb1:components/design-review/workflow-simulator.tsx > components/design-review/workflow-simulator.tsx

echo "→ Applying journey-wire.patch..."
if command -v patch >/dev/null 2>&1; then
  patch -p1 < journey-wire.patch
else
  git apply journey-wire.patch
fi

echo "→ Done. Review then:"
echo "  git add components/design-review/workflow-simulator.tsx"
echo "  git commit -m 'feat(journey): wire Capture Journey button into simulator'"
echo "  git push"
