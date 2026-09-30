# Restore workflow-simulator.tsx

The simulator file was accidentally truncated during an automated push.

## Fastest fix (local, ~10 seconds)

```bash
cd /path/to/Design-Review
git show 15accb1:components/design-review/workflow-simulator.tsx > components/design-review/workflow-simulator.tsx
git apply journey-wire.patch
# or: patch -p1 < journey-wire.patch
git add components/design-review/workflow-simulator.tsx
git commit -m "feat(journey): wire Capture Journey button into simulator"
git push
```

`journey-wire.patch` and `scripts/restore-simulator.sh` are already on `main`.

## One-liner

```bash
bash scripts/restore-simulator.sh && git add components/design-review/workflow-simulator.tsx && git commit -m "feat(journey): wire Capture Journey" && git push
```

## Alternative

Download the full fixed file from the chat (`workflow-simulator-restored.zip`) and replace `components/design-review/workflow-simulator.tsx`.
