# How Journey Mapping Works in Design Workflow Tracker

## 1. Overview & Core Model

In the AI Automation & Design Review engine, an application **Journey** is a directed graph ($G = (V, E)$) representing all traversable user paths through an application:

```
Nodes (V):  AppScreenNode         -> Distinct views, routes, modals, or bottom nav tabs
Edges (E):  AppWorkflowTransition -> User actions or navigation links connecting screens
Steps (S):  TestPlanStep          -> Concrete sequential tests executed on each screen
```

Each screen and test step contains two critical metadata fields:
- `url`: The absolute/relative browser URL (e.g. `http://localhost:3000/leases`).
- `componentLocation`: The physical source code file in the repository (e.g. `app/leases/page.tsx` or `pages/settings.tsx`).

---

## 2. Journey Mapping Architecture

```mermaid
flowchart TD
    A[Target URL + Local Repo] --> B[Filesystem Route Scanner\ndiscoverLocalProjectRoutes]
    B --> C[Initial Entry Screen S001]
    
    subgraph Discovery [Phase 1: Multi-Vector Discovery]
        C --> D1[BFS Anchor Crawl\na[href], data-href, data-route]
        C --> D2[Bottom Nav / Tab Bar Scanner\nfixed bottom-0, role='tablist']
        C --> D3[SPA View Clicker\nSVG icon & tab state changes]
    end

    D1 --> E[Screen Inventory Ledger]
    D2 --> E
    D3 --> E
    B -. Component Paths .-> E

    subgraph GraphBuilding [Phase 2: Graph & Journey Mapping]
        E --> F1[Bidirectional Return Edges\nForward + Return / Back ↩️]
        E --> F2[Interconnected Bottom Nav\nTab A <--> Tab B <--> Tab C]
        E --> F3[Loop Completion\nLogout -> Login S001]
    end

    F1 --> G[FlowGraph / Figma Workflow Map]
    F2 --> G
    F3 --> G

    subgraph Execution [Phase 3: Execution & URL Restoration]
        G --> H[Test Plan Steps TEST-001..N]
        H --> I{Browser URL == Step URL?}
        I -- No --> J[Navigate to Step URL / Restore Target]
        I -- Yes --> K[Execute Action click/type/upload]
        J --> K
        K --> L[Observe Outcome & Screenshot]
    end
```

---

## 3. Step-by-Step Breakdown

### Phase 1: Local Route Pre-Discovery
Before launching the browser crawler, the engine runs `discoverLocalProjectRoutes`:
1. Scans the local project directory (`app/`, `pages/`, `src/app/`).
2. Discovers static and dynamic route folders (e.g. `/leases`, `/properties`, `/maintenance`, `/settings`).
3. Indexes each route with its source file:
   ```json
   {
     "path": "/leases",
     "url": "http://localhost:3000/leases",
     "file": "app/leases/page.tsx"
   }
   ```
4. This directory index is passed to all crawlers and execution loops to assign `componentLocation` to discovered screens.

---

### Phase 2: Link & Bottom Navigation Detection

Modern web and mobile applications do not rely exclusively on traditional `<a href="...">` links. The crawler (`collectLinks`) inspects three distinct surfaces:

1. **Standard Anchors**:
   - Queries `a[href]`, ignoring `mailto:`, `tel:`, and `javascript:`.
2. **SPA Routing Data Attributes**:
   - Queries `[data-href]`, `[data-path]`, `[data-route]`, `[data-to]`, and `[data-url]`.
3. **Bottom Navigation, Mobile Docks & Tab Bars**:
   - Queries containers matching:
     - `nav`, `[role="navigation"]`, `[role="tablist"]`, `footer`
     - Modern Tailwind responsive classes: `[class*="fixed"][class*="bottom-"]`, `[class*="sticky"][class*="bottom-"]`
     - Custom classes: `[class*="bottomNav" i]`, `[class*="tabBar" i]`, `[id*="bottom-nav" i]`
   - Extracts clickable items (`a`, `button`, `[role="tab"]`, `[role="button"]`, `li`).
   - If an item is an SVG icon without text:
     - Parses icon classes (e.g. `lucide-home`, `lucide-file-text`, `tabler-settings`).
     - Extracts the icon name (e.g. "home", "file text", "settings").
   - Matches the label/icon against `fsRoutes` (e.g. "Leases" matches `/leases` $\rightarrow$ `app/leases/page.tsx`).

---

### Phase 3: Journey Edge & Transition Generation

To build a realistic user journey rather than a one-way tree:

1. **Bidirectional Navigation**:
   - When navigating from Screen A to Screen B:
     ```
     Transition 1: Screen A -> Screen B ("Navigate to /leases")
     Transition 2: Screen B -> Screen A ("Return / Back ↩️")
     ```
2. **Interconnected Bottom Navigation**:
   - In a bottom navigation bar, any tab can directly navigate to any other tab without returning to Home first.
   - For every discovered bottom navigation tab ($T_1, T_2, \dots, T_k$), the engine links transitions between all pairs:
     ```
     T_i <---> T_j (Action: "Navigate to '{TabName}' via Bottom Nav")
     ```
3. **Workflow Loops & Lifecycle Completion**:
   - When a "Log out" button or an unauthenticated redirect lands on `/login` or `S001`:
     - The engine adds a transition from the current screen back to `S001`.
     - This closes the lifecycle loop and completes the end-to-end journey.

---

### Phase 4: Action Screens (Modals & Drawers)

During test execution, user actions (e.g. clicking "Add Property" or "Open Filter") often trigger modals or drawers without changing the URL pathname.
- The engine computes a synthetic path hash:
  `/leases#modal-add-property` or `/leases#action-3-filter-view`
- Generates a distinct `AppScreenNode` with `componentLocation: app/leases/page.tsx`.
- Connects forward and return transitions between the parent screen and the modal screen.

---

### Phase 5: Pre-Step Screen Restoration (Preventing "Blocked" Verdicts)

A primary reason subsequent workflow steps failed or became "blocked" was **URL drift**:
- Step 1 clicked a link or button that navigated to `/settings`.
- Step 2 expected to click an element on `/leases`.
- Because the browser was still on `/settings`, the target element was not found in the DOM, marking the step `blocked`.

**The Solution (`Step Target Restoration`)**:
Before executing any action in `full-app-engine.ts`, `workflow-chainer.ts`, and `feature-workflow-engine.ts`:
1. Checks `step.url` or the screen URL associated with `step.screenId`.
2. Compares `page.url().pathname` with `stepTargetUrl.pathname`.
3. If they differ, the engine immediately restores the target screen via `page.goto(stepTargetUrl)` before locating elements.
4. As a result, actions reliably find their target DOM elements.

---

## 4. Journey Data Structures Summary

### Screen Node (`AppScreenNode`)
```typescript
interface AppScreenNode {
  id: string                   // e.g. "S001", "S002"
  name: string                 // e.g. "Leases Management"
  url: string                  // e.g. "http://localhost:3000/leases"
  path: string                 // e.g. "/leases"
  componentLocation?: string   // e.g. "app/leases/page.tsx"
  sourceFile?: string          // e.g. "app/leases/page.tsx"
  screenshotUrl?: string       // Base64 visual capture
  actionableElements: ActionableElement[]
  forms: FormInventory[]
  isLoginWall?: boolean
}
```

### Transition (`AppWorkflowTransition`)
```typescript
interface AppWorkflowTransition {
  id: string                   // e.g. "TRANS-001"
  fromScreenId: string         // e.g. "S001"
  toScreenId: string           // e.g. "S002"
  action: string               // e.g. "Navigate to /leases via Bottom Nav"
  actionType: "navigation" | "click" | "form_submit"
}
```

### Test Step (`TestPlanStep`)
```typescript
interface TestPlanStep {
  id: string                   // e.g. "TEST-003"
  screenId: string             // Screen where action belongs
  screenName: string
  url?: string                 // Screen URL verified before action runs
  componentLocation?: string   // Source file mapped for QA tracking
  actionType: "click" | "fill" | "upload" | "verify"
  targetName: string           // Selector / button text
  status: "pending" | "running" | "passed" | "failed" | "blocked"
}
```
