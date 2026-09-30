# Journey Capture

Automated page-by-page screenshot capture that builds **Figma-style role workflows** (User / Admin / Client / …).

Uses existing **Puppeteer** + optional **Laya** for fast local decisions (~30 ms).

## Files added

```
lib/journey/types.ts
lib/journey/laya-client.ts
lib/journey/runner.ts
lib/journey/workflow-builder.ts
app/api/journey/start/route.ts
app/api/journey/status/route.ts
components/design-review/journey-capture-modal.tsx
```

## Env (optional)

```
LAYA_BASE_URL=http://127.0.0.1:8000
```

Works without Laya (skips smart page-type / next-link decisions).

## Wire into simulator

In `components/design-review/workflow-simulator.tsx`:

1. Import `JourneyCaptureModal`
2. State: `const [showJourneyModal, setShowJourneyModal] = useState(false)`
3. Toolbar button → `setShowJourneyModal(true)`
4. Render:

```tsx
<JourneyCaptureModal
  open={showJourneyModal}
  onClose={() => setShowJourneyModal(false)}
  projectId={project.id}
  defaultUrl={currentUrl}
  defaultWidth={viewportWidth}
  defaultHeight={viewportHeight}
  onComplete={(workflowId) => {
    setShowJourneyModal(false)
    onSelectWorkflow?.(workflowId)
  }}
/>
```

## API

- `POST /api/journey/start` — start capture
- `GET /api/journey/status?id=` — poll progress

On completion a new `workflows` row is created with ordered steps in `our_notes` JSON and first screenshot as `design_b`.
