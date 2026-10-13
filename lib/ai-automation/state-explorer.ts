import type { Page } from "puppeteer";
import {
  inspectPageDom,
  resolveRankedLocator,
  type DomDiscoveryElement,
  type DomDiscoverySnapshot,
} from "./dom-first-discovery";

export type ExplorationStopReason =
  | "exhausted"
  | "truncated_max_depth"
  | "truncated_max_states"
  | "truncated_scroll_budget"
  | "blocked_safety"
  | "restore_failed";

export type ExplorationTransitionKind = "expand" | "menu" | "details" | "tab" | "scroll";

export type ExplorationEdge = {
  fromStateId: string;
  toStateId: string;
  action: string;
  kind: ExplorationTransitionKind;
  reversible: boolean;
  restorationError?: string;
};

export type ExploredUiState = {
  id: string;
  signature: string;
  url: string;
  title: string;
  depth: number;
  trigger?: string;
  elements: DomDiscoveryElement[];
  discoveredAt: string;
};

export type StateExplorationReport = {
  startUrl: string;
  states: ExploredUiState[];
  edges: ExplorationEdge[];
  stopReason: ExplorationStopReason;
  frontierRemaining: number;
  limits: { maxDepth: number; maxStates: number; maxScrollSteps: number };
  counts: {
    discovered: number;
    attempted: number;
    restored: number;
    branched: number;
    blocked: number;
    truncated: number;
  };
};

export type StateExplorerOptions = {
  maxDepth?: number;
  maxStates?: number;
  maxScrollSteps?: number;
  includeTabs?: boolean;
  onState?: (state: ExploredUiState) => void | Promise<void>;
};

type Probe = {
  selector: string;
  label: string;
  kind: ExplorationTransitionKind;
  depth: number;
  parentId: string;
  key: string;
};

type StateCapture = {
  snapshot: DomDiscoverySnapshot;
  signature: string;
  stateVector: string;
};

const DEFAULTS = { maxDepth: 3, maxStates: 30, maxScrollSteps: 3 };

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function captureState(page: Page): Promise<StateCapture> {
  const snapshot = await inspectPageDom(page);
  const stateVector = await page.evaluate(() => {
    const visible = (el: Element) => {
      const h = el as HTMLElement;
      const rect = h.getBoundingClientRect();
      const style = getComputedStyle(h);
      return rect.width > 2 && rect.height > 2 && style.display !== "none" &&
        style.visibility !== "hidden" && style.opacity !== "0" &&
        h.getAttribute("aria-hidden") !== "true";
    };
    const activeTab = Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"], [role="tab"][data-state="active"]'))
      .filter(visible).map((el) => (el as HTMLElement).innerText.trim()).join("|");
    const openDialogs = Array.from(document.querySelectorAll('dialog[open], [role="dialog"]:not([aria-hidden="true"]), .modal[open], [data-modal][data-state="open"]'))
      .filter(visible).map((el) => (el as HTMLElement).id || el.getAttribute("aria-label") || (el as HTMLElement).innerText.slice(0, 80)).join("|");
    const expanded = Array.from(document.querySelectorAll('[aria-expanded="true"], details[open], [data-state="open"]'))
      .filter(visible).map((el) => {
        const h = el as HTMLElement;
        return h.id || h.getAttribute("aria-controls") || h.getAttribute("aria-label") || h.innerText.trim().slice(0, 80);
      }).sort().join("|");
    const selected = Array.from(document.querySelectorAll('input:checked, option:checked, [aria-selected="true"], [aria-pressed="true"]'))
      .filter(visible).map((el) => {
        const h = el as HTMLElement;
        return h.id || h.getAttribute("name") || h.getAttribute("aria-label") || h.innerText.trim().slice(0, 60);
      }).sort().join("|");
    return JSON.stringify({ activeTab, openDialogs, expanded, selected });
  });
  const route = new URL(snapshot.url).pathname;
  const signature = stableHash([route, stateVector].join("::"));
  return { snapshot, signature, stateVector };
}

function stateFromCapture(capture: StateCapture, depth: number, trigger?: string): ExploredUiState {
  return {
    id: "state-" + capture.signature,
    signature: capture.signature,
    url: capture.snapshot.url,
    title: capture.snapshot.title,
    depth,
    trigger,
    elements: capture.snapshot.elements,
    discoveredAt: new Date().toISOString(),
  };
}

function probesFromCapture(
  capture: StateCapture,
  parentId: string,
  depth: number,
  includeTabs: boolean,
): Probe[] {
  const probes: Probe[] = [];
  for (const element of capture.snapshot.elements) {
    if (!element.enabled || element.risk !== "safe" || !element.locators?.length) continue;
    const lower = element.label.toLowerCase();
    const kind = element.kind;
    const isExpand = element.kind === "state-change" && (
      /expand|collapse|accordion|advanced|more options|show details|filters?/i.test(lower) ||
      !!element.href && element.href.startsWith("#")
    );
    // State is checked from live DOM during execution; this is only a candidate shortlist.
    const selector = element.selector;
    const probeKind: ExplorationTransitionKind | null =
      isExpand ? "expand" :
      /menu|actions|options|dropdown/i.test(lower) ? "menu" :
      element.tag === "summary" ? "details" :
      includeTabs && (element.role === "tab" || /^(tab)$/.test(element.role)) ? "tab" : null;
    if (probeKind && (kind === "state-change" || element.role === "tab" || element.tag === "summary" || /menu|options|dropdown/i.test(lower))) {
      probes.push({ selector, label: element.label, kind: probeKind, depth, parentId, key: probeKind + ":" + selector });
    }
  }
  // Scroll regions are handled separately because they need restoration and a bounded budget.
  return probes.filter((probe, index) => probes.findIndex((other) => other.key === probe.key) === index);
}

async function liveProbeKind(page: Page, selector: string): Promise<ExplorationTransitionKind | null> {
  return page.evaluate((css) => {
    let el: Element | null;
    try { el = document.querySelector(css); } catch { return null; }
    if (!el) return null;
    const h = el as HTMLElement;
    if (h.matches("summary") && h.closest("details")) return "details";
    const role = h.getAttribute("role");
    if (role === "tab") return "tab";
    const expanded = h.getAttribute("aria-expanded");
    const hasMenu = h.getAttribute("aria-haspopup") === "menu" || h.getAttribute("data-dropdown") !== null ||
      !!h.closest("[data-dropdown-trigger]");
    if (hasMenu && expanded !== "true") return "menu";
    if (expanded === "false" && (h.hasAttribute("aria-controls") || /expand|advanced|more options|show details|filter/i.test(h.innerText + " " + (h.getAttribute("aria-label") || "")))) return "expand";
    return null;
  }, selector);
}

async function readScrollRegions(page: Page): Promise<Array<{ selector: string; key: string }>> {
  return page.evaluate(() => {
    const regions = Array.from(document.querySelectorAll("body *")).filter((el) => {
      const h = el as HTMLElement;
      const style = getComputedStyle(h);
      return /(auto|scroll)/.test(style.overflowY + " " + style.overflowX) &&
        (h.scrollHeight > h.clientHeight + 20 || h.scrollWidth > h.clientWidth + 20) &&
        h.clientWidth > 0 && h.clientHeight > 0;
    }).slice(0, 20);
    return regions.map((el, index) => {
      const h = el as HTMLElement;
      const selector = h.id ? "#" + CSS.escape(h.id) :
        h.getAttribute("data-testid") ? '[data-testid=' + JSON.stringify(h.getAttribute("data-testid")) + ']' :
        "body *:nth-of-type(" + (index + 1) + ")";
      return { selector, key: h.id || h.getAttribute("data-testid") || selector };
    });
  });
}

async function restoreProbe(
  page: Page,
  probe: Probe,
  before: StateCapture,
  originalScroll: Array<{ selector: string; top: number; left: number }>,
): Promise<{ restored: boolean; error?: string }> {
  try {
    if (probe.kind === "scroll") {
      await page.evaluate((positions) => {
        for (const position of positions) {
          let el: Element | null = null;
          try { el = document.querySelector(position.selector); } catch {}
          if (el) { (el as HTMLElement).scrollTop = position.top; (el as HTMLElement).scrollLeft = position.left; }
        }
        window.scrollTo(0, 0);
      }, originalScroll);
    } else if (probe.kind === "details") {
      await page.evaluate((selector) => {
        const summary = document.querySelector(selector);
        const details = summary?.closest("details") as HTMLDetailsElement | null;
        if (details) details.open = false;
      }, probe.selector);
    } else if (probe.kind === "tab") {
      // Tabs are recorded as branches: selecting another tab can be destructive to unsaved form state.
      return { restored: false, error: "tab state preserved as a branch; automatic tab reversal is intentionally skipped" };
    } else {
      await page.keyboard.press("Escape").catch(() => {});
      const stillExpanded = await page.evaluate((selector) => {
        let el: Element | null = null;
        try { el = document.querySelector(selector); } catch {}
        return el?.getAttribute("aria-expanded") === "true";
      }, probe.selector);
      if (stillExpanded) await page.click(probe.selector).catch(() => {});
    }
    const after = await captureState(page);
    if (after.signature === before.signature) return { restored: true };
    return { restored: false, error: "state signature did not return to its pre-probe value" };
  } catch (error) {
    return { restored: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function exploreUiStates(page: Page, options: StateExplorerOptions = {}): Promise<StateExplorationReport> {
  const limits = {
    maxDepth: Math.max(0, options.maxDepth ?? DEFAULTS.maxDepth),
    maxStates: Math.max(1, options.maxStates ?? DEFAULTS.maxStates),
    maxScrollSteps: Math.max(0, options.maxScrollSteps ?? DEFAULTS.maxScrollSteps),
  };
  const initial = await captureState(page);
  const first = stateFromCapture(initial, 0);
  const states: ExploredUiState[] = [first];
  const stateBySignature = new Map([[first.signature, first]]);
  const edges: ExplorationEdge[] = [];
  const frontier: Probe[] = [];
  const visitedProbes = new Set<string>();
  const scrollStepsByRegion = new Map<string, number>();
  let attempted = 0, restoredCount = 0, branched = 0, blocked = 0, truncated = 0;
  let stopReason: ExplorationStopReason = "exhausted";
  const enqueueFrom = async (capture: StateCapture, state: ExploredUiState) => {
    frontier.push(...probesFromCapture(capture, state.id, state.depth, options.includeTabs ?? true));
    const regions = await readScrollRegions(page).catch(() => []);
    for (const region of regions) {
      const used = scrollStepsByRegion.get(region.key) ?? 0;
      if (used >= limits.maxScrollSteps) continue;
      const key = "scroll:" + region.key + ":" + used;
      if (!visitedProbes.has(key + "@" + state.id)) {
        frontier.push({ selector: region.selector, label: "Scroll " + region.key + " (step " + (used + 1) + ")", kind: "scroll", depth: state.depth, parentId: state.id, key });
      }
    }
  };
  await options.onState?.(first);
  await enqueueFrom(initial, first);

  while (frontier.length) {
    const probe = frontier.shift()!;
    if (visitedProbes.has(probe.key + "@" + probe.parentId)) continue;
    visitedProbes.add(probe.key + "@" + probe.parentId);
    if (probe.depth >= limits.maxDepth) { truncated++; stopReason = "truncated_max_depth"; continue; }
    if (states.length >= limits.maxStates) { truncated += frontier.length + 1; stopReason = "truncated_max_states"; break; }

    if (probe.kind === "tab") {
      // Tabs can discard form edits; leave them unclicked until a future explicit policy allows it.
      blocked++;
      edges.push({ fromStateId: probe.parentId, toStateId: probe.parentId, action: probe.label, kind: probe.kind, reversible: false, restorationError: "blocked_safety: tab selection may discard user input" });
      stopReason = "blocked_safety";
      continue;
    }

    const current = await captureState(page);
    const originalScroll = await page.evaluate(() => {
      const result: Array<{ selector: string; top: number; left: number }> = [];
      result.push({ selector: "html", top: document.documentElement.scrollTop, left: document.documentElement.scrollLeft });
      for (const el of Array.from(document.querySelectorAll("[id], [data-testid]"))) {
        const h = el as HTMLElement;
        if (h.scrollHeight > h.clientHeight + 10 || h.scrollWidth > h.clientWidth + 10) {
          const selector = h.id ? "#" + CSS.escape(h.id) : '[data-testid=' + JSON.stringify(h.getAttribute("data-testid")) + ']';
          result.push({ selector, top: h.scrollTop, left: h.scrollLeft });
        }
      }
      return result;
    });
    let resolvedSelector = probe.selector;
    if (probe.kind !== "scroll") {
      const element = current.snapshot.elements.find((item) => item.label === probe.label && item.locators?.length);
      const locator = element ? await resolveRankedLocator(page, element.locators) : null;
      if (!locator) { blocked++; continue; }
      resolvedSelector = locator.selector;
      const liveKind = await liveProbeKind(page, resolvedSelector);
      if (!liveKind || (probe.kind !== "details" && liveKind !== probe.kind)) { blocked++; continue; }
    }
    attempted++;
    let actionSucceeded = false;
    try {
      if (probe.kind === "scroll") {
        await page.evaluate((selector) => {
          let el: Element | null = null;
          try { el = document.querySelector(selector); } catch {}
          if (!el) return false;
          const h = el as HTMLElement;
          const before = h.scrollTop;
          h.scrollTop = Math.min(h.scrollHeight, h.scrollTop + Math.max(100, Math.floor(h.clientHeight * 0.75)));
          return h.scrollTop !== before;
        }, probe.selector).then((moved) => { actionSucceeded = moved; });
        if (actionSucceeded) scrollStepsByRegion.set(probe.key.split(":").slice(1, -1).join(":"), (scrollStepsByRegion.get(probe.key.split(":").slice(1, -1).join(":")) ?? 0) + 1);
      } else if (probe.kind === "details") {
        await page.evaluate((selector) => {
          const summary = document.querySelector(selector);
          const details = summary?.closest("details") as HTMLDetailsElement | null;
          if (details) details.open = true;
        }, probe.selector);
        actionSucceeded = true;
      } else {
        await page.click(resolvedSelector); actionSucceeded = true;
      }
      if (!actionSucceeded) { blocked++; continue; }
      const revealed = await captureState(page);
      let child = stateBySignature.get(revealed.signature);
      if (!child) {
        child = stateFromCapture(revealed, probe.depth + 1, probe.label);
        stateBySignature.set(child.signature, child);
        states.push(child);
        await options.onState?.(child);
      }
      const restored = await restoreProbe(page, probe, current, originalScroll);
      if (restored.restored) restoredCount++;
      else branched++;
      edges.push({
        fromStateId: probe.parentId,
        toStateId: child.id,
        action: probe.label,
        kind: probe.kind,
        reversible: restored.restored,
        restorationError: restored.error,
      });
      if (!restored.restored) {
        // Preserve the child as a branch and do not probe from an unknown state.
        if (restored.error?.startsWith("tab")) stopReason = "blocked_safety";
        else stopReason = "restore_failed";
        continue;
      }
      const restoredCapture = await captureState(page);
      const restoredState = stateBySignature.get(restoredCapture.signature) || stateBySignature.get(probe.parentId);
      if (restoredState) await enqueueFrom(revealed, child);
    } catch (error) {
      blocked++;
      edges.push({
        fromStateId: probe.parentId,
        toStateId: probe.parentId,
        action: probe.label,
        kind: probe.kind,
        reversible: false,
        restorationError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (stopReason === "exhausted" && truncated > 0) stopReason = "truncated_max_depth";
  const scrollRegions = await readScrollRegions(page).catch(() => []);
  for (const region of scrollRegions) {
    const steps = scrollStepsByRegion.get(region.key) ?? 0;
    if (steps >= limits.maxScrollSteps) continue;
    if (states.length >= limits.maxStates) { stopReason = "truncated_max_states"; truncated++; break; }
    // Scroll probes are intentionally not auto-enqueued here until a region is observed as a bounded frontier.
  }
  return {
    startUrl: initial.snapshot.url,
    states,
    edges,
    stopReason,
    frontierRemaining: frontier.length,
    limits,
    counts: { discovered: states.length, attempted, restored: restoredCount, branched, blocked, truncated },
  };
}
