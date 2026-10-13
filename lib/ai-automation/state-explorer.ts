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
  key: string;
  regionKey?: string;
};

type Capture = {
  snapshot: DomDiscoverySnapshot;
  signature: string;
  restorationSignature: string;
};

type ScrollPosition = { selector: string; top: number; left: number };

const DEFAULTS = { maxDepth: 3, maxStates: 30, maxScrollSteps: 3 };

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

async function capture(page: Page): Promise<Capture> {
  const snapshot = await inspectPageDom(page);
  const vector = await page.evaluate(() => {
    const text = (el: Element) => ((el as HTMLElement).innerText || "").replace(/\s+/g, " ").trim().slice(0, 100);
    const activeTab = Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"],[role="tab"][data-state="active"]'))
      .map(text).join("|");
    const dialogs = Array.from(document.querySelectorAll('dialog[open],[role="dialog"]:not([aria-hidden="true"]),.modal[open],[data-modal][data-state="open"]'))
      .map((el) => (el as HTMLElement).id || el.getAttribute("aria-label") || text(el)).join("|");
    const expanded = Array.from(document.querySelectorAll('[aria-expanded="true"],details[open],[data-state="open"]'))
      .map((el) => {
        const h = el as HTMLElement;
        return h.id || h.getAttribute("aria-controls") || h.getAttribute("aria-label") || text(h);
      }).sort().join("|");
    const selected = Array.from(document.querySelectorAll('input:checked,option:checked,[aria-selected="true"],[aria-pressed="true"]'))
      .map((el) => {
        const h = el as HTMLElement;
        return h.id || h.getAttribute("name") || h.getAttribute("aria-label") || text(h);
      }).sort().join("|");
    const scroll = [
      "window:" + Math.round(window.scrollX) + "," + Math.round(window.scrollY),
      ...Array.from(document.querySelectorAll("body *")).filter((el) => {
        const h = el as HTMLElement;
        return h.scrollHeight > h.clientHeight + 20 || h.scrollWidth > h.clientWidth + 20;
      }).slice(0, 20).map((el) => {
        const h = el as HTMLElement;
        return (h.id || h.getAttribute("data-testid") || h.tagName) + ":" + Math.round(h.scrollLeft) + "," + Math.round(h.scrollTop);
      }),
    ].join("|");
    return JSON.stringify({ activeTab, dialogs, expanded, selected, scroll });
  });
  const route = new URL(snapshot.url).pathname;
  const visibleInventory = snapshot.elements.map((element) => element.tag + ":" + element.role + ":" + element.label).sort().join("|");
  return { snapshot, signature: hash([route, vector, visibleInventory].join("::")), restorationSignature: hash([route, vector].join("::")) };
}

function toState(captureResult: Capture, depth: number, trigger?: string): ExploredUiState {
  return {
    id: "state-" + captureResult.signature,
    signature: captureResult.signature,
    url: captureResult.snapshot.url,
    title: captureResult.snapshot.title,
    depth,
    trigger,
    elements: captureResult.snapshot.elements,
    discoveredAt: new Date().toISOString(),
  };
}

async function uniqueSelector(page: Page, selector: string): Promise<string | null> {
  const candidates = [{ selector, strategy: "structural" as const, confidence: 0.4, uniqueAtDiscovery: false }];
  const result = await resolveRankedLocator(page, candidates);
  return result?.selector ?? null;
}

async function getProbes(
  page: Page,
  captureResult: Capture,
  includeTabs: boolean,
  scrollSteps: Map<string, number>,
  maxScrollSteps: number,
  onScrollTruncated?: () => void,
): Promise<Probe[]> {
  const probes: Probe[] = [];
  const activeDialogSelector = await page.evaluate(() => {
    const dialog = document.querySelector("dialog[open],[role=dialog]:not([aria-hidden=true]),.modal[open],[data-modal][data-state=open]") as HTMLElement | null;
    if (!dialog) return null;
    if (dialog.id) return "#" + CSS.escape(dialog.id);
    const label = dialog.getAttribute("aria-label");
    return label ? "[aria-label=" + JSON.stringify(label) + "]" : null;
  });
  for (const element of captureResult.snapshot.elements) {
    if (!element.enabled || element.risk !== "safe" || !element.locators?.length) continue;
    const label = element.label;
    const lower = label.toLowerCase();
    let kind: ExplorationTransitionKind | null = null;
    if (element.tag === "summary") kind = "details";
    else if (element.role === "tab") kind = "tab";
    else if (element.kind === "state-change" && /expand|accordion|advanced|more options|show details|filter|dialog|modal|open confirmation/i.test(lower)) kind = "expand";
    else if (/menu|actions|dropdown/i.test(lower)) kind = "menu";
    if (!kind) continue;
    const selector = await uniqueSelector(page, element.selector);
    if (!selector) continue;
    if (activeDialogSelector) {
      const insideDialog = await page.evaluate(({ css, dialogCss }) => {
        const target = document.querySelector(css);
        const dialog = document.querySelector(dialogCss);
        return !!target && !!dialog && dialog.contains(target);
      }, { css: selector, dialogCss: activeDialogSelector });
      if (!insideDialog) continue;
    }
    const live = await page.evaluate((css) => {
      const el = document.querySelector(css) as HTMLElement | null;
      if (!el) return null;
      return {
        expanded: el.getAttribute("aria-expanded"),
        popup: el.getAttribute("aria-haspopup"),
        hasControls: el.hasAttribute("aria-controls"),
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role"),
        detailsOpen: !!el.closest("details[open]"),
      };
    }, selector);
    if (!live) continue;
    if (kind === "menu" && (live.expanded === "true" || !(live.popup === "menu" || live.hasControls || /menu|actions|dropdown/i.test(lower)))) continue;
    if (kind === "expand" && (live.expanded === "true" || !(live.expanded === "false" || live.hasControls || live.popup === "dialog"))) continue;
    if (kind === "details" && (live.tag !== "summary" || live.detailsOpen)) continue;
    if (kind === "tab" && !includeTabs) continue;
    probes.push({ selector, label, kind, key: kind + ":" + selector });
  }

  const regions = await page.evaluate(() => {
    const selectorFor = (el: Element) => {
      const h = el as HTMLElement;
      if (h.id) {
        const id = "#" + CSS.escape(h.id);
        if (document.querySelectorAll(id).length === 1) return id;
      }
      for (const attr of ["data-testid", "data-cy"]) {
        const value = h.getAttribute(attr);
        if (value) {
          const selector = "[" + attr + "=" + JSON.stringify(value) + "]";
          if (document.querySelectorAll(selector).length === 1) return selector;
        }
      }
      const parts: string[] = [];
      let current: Element | null = el;
      while (current && current !== document.documentElement) {
        const parent = current.parentElement;
        const tag = current.tagName.toLowerCase();
        if (!parent) { parts.unshift(tag); break; }
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current!.tagName);
        parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")" : tag);
        const selector = parts.join(" > ");
        try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
        current = parent;
      }
      return parts.join(" > ");
    };
    return Array.from(document.querySelectorAll("body *")).filter((el) => {
      const h = el as HTMLElement;
      const style = getComputedStyle(h);
      return /(auto|scroll)/.test(style.overflowY + " " + style.overflowX) &&
        (h.scrollHeight > h.clientHeight + 20 || h.scrollWidth > h.clientWidth + 20) &&
        h.clientWidth > 0 && h.clientHeight > 0;
    }).slice(0, 12).map((el) => {
      const h = el as HTMLElement;
      const selector = selectorFor(el);
      return { selector, key: h.id || h.getAttribute("data-testid") || selector, canScroll: h.scrollTop + h.clientHeight < h.scrollHeight - 2 };
    });
  });
  for (const region of regions) {
    const used = scrollSteps.get(region.key) ?? 0;
    if (region.canScroll && used >= maxScrollSteps) onScrollTruncated?.();
    if (region.canScroll && used < maxScrollSteps) {
      probes.push({
        selector: region.selector,
        label: "Scroll " + region.key + " step " + (used + 1),
        kind: "scroll",
        key: "scroll:" + region.key + ":" + used,
        regionKey: region.key,
      });
    }
  }
  return probes.filter((probe, index) => probes.findIndex((other) => other.key === probe.key) === index);
}

async function captureScroll(page: Page): Promise<ScrollPosition[]> {
  return page.evaluate(() => {
    const result: ScrollPosition[] = [{ selector: "html", top: document.documentElement.scrollTop, left: document.documentElement.scrollLeft }];
    for (const el of Array.from(document.querySelectorAll("[id],[data-testid]"))) {
      const h = el as HTMLElement;
      if (h.scrollHeight > h.clientHeight + 10 || h.scrollWidth > h.clientWidth + 10) {
        const selector = h.id ? "#" + CSS.escape(h.id) : '[data-testid=' + JSON.stringify(h.getAttribute("data-testid")) + "]";
        result.push({ selector, top: h.scrollTop, left: h.scrollLeft });
      }
    }
    return result;
  });
}

async function restoreScroll(page: Page, positions: ScrollPosition[]): Promise<void> {
  await page.evaluate((items) => {
    for (const item of items) {
      let el: Element | null = null;
      try { el = document.querySelector(item.selector); } catch {}
      if (el) { (el as HTMLElement).scrollTop = item.top; (el as HTMLElement).scrollLeft = item.left; }
    }
    window.scrollTo(positionsWindowX(items), positionsWindowY(items));
    function positionsWindowX(values: ScrollPosition[]) { return values.find((item) => item.selector === "html")?.left ?? 0; }
    function positionsWindowY(values: ScrollPosition[]) { return values.find((item) => item.selector === "html")?.top ?? 0; }
  }, positions);
}

async function restoreDisclosure(page: Page, probe: Probe): Promise<void> {
  if (probe.kind === "details") {
    await page.evaluate((selector) => {
      const summary = document.querySelector(selector);
      const details = summary?.closest("details") as HTMLDetailsElement | null;
      if (details) details.open = false;
    }, probe.selector);
    return;
  }
  await page.keyboard.press("Escape").catch(() => {});
  const expanded = await page.evaluate((selector) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    return el?.getAttribute("aria-expanded") === "true";
  }, probe.selector);
  if (expanded) await page.click(probe.selector).catch(() => {});
}

export async function exploreUiStates(page: Page, options: StateExplorerOptions = {}): Promise<StateExplorationReport> {
  const limits = {
    maxDepth: Math.max(0, options.maxDepth ?? DEFAULTS.maxDepth),
    maxStates: Math.max(1, options.maxStates ?? DEFAULTS.maxStates),
    maxScrollSteps: Math.max(0, options.maxScrollSteps ?? DEFAULTS.maxScrollSteps),
  };
  const initial = await capture(page);
  const root = toState(initial, 0);
  const states = [root];
  const bySignature = new Map<string, ExploredUiState>([[root.signature, root]]);
  const edges: ExplorationEdge[] = [];
  const expandedStates = new Set<string>();
  const scrollSteps = new Map<string, number>();
  let attempted = 0, restored = 0, branched = 0, blocked = 0, truncated = 0, frontierRemaining = 0;
  let stopReason: ExplorationStopReason = "exhausted";

  const markStop = (reason: ExplorationStopReason) => {
    const priority: Record<ExplorationStopReason, number> = {
      exhausted: 0, blocked_safety: 1, truncated_scroll_budget: 2,
      truncated_max_depth: 3, truncated_max_states: 4, restore_failed: 5,
    };
    if (priority[reason] > priority[stopReason]) stopReason = reason;
  };

  const visit = async (current: Capture, state: ExploredUiState): Promise<void> => {
    if (expandedStates.has(state.signature)) return;
    expandedStates.add(state.signature);
    if (state.depth >= limits.maxDepth) {
      const candidates = await getProbes(page, current, options.includeTabs ?? true, scrollSteps, limits.maxScrollSteps, () => markStop("truncated_scroll_budget"));
      if (candidates.length) { truncated += candidates.length; frontierRemaining += candidates.length; markStop("truncated_max_depth"); }
      return;
    }
    const probes = await getProbes(page, current, options.includeTabs ?? true, scrollSteps, limits.maxScrollSteps, () => markStop("truncated_scroll_budget"));
    for (let probeIndex = 0; probeIndex < probes.length; probeIndex++) {
      const probe = probes[probeIndex];
      if (states.length >= limits.maxStates) {
        const remaining = probes.length - probeIndex;
        truncated += remaining;
        frontierRemaining += remaining;
        markStop("truncated_max_states");
        return;
      }
      if (probe.kind === "tab") {
        blocked++;
        markStop("blocked_safety");
        edges.push({ fromStateId: state.id, toStateId: state.id, action: probe.label, kind: probe.kind, reversible: false, restorationError: "blocked_safety: tab changes are not auto-clicked because they may replace unsaved form state" });
        continue;
      }
      const before = await capture(page);
      const scrollBefore = await captureScroll(page);
      let succeeded = false;
      try {
        if (probe.kind === "scroll") {
          const moved = await page.evaluate((selector) => {
            const el = document.querySelector(selector) as HTMLElement | null;
            if (!el) return false;
            const previous = el.scrollTop;
            el.scrollTop = Math.min(el.scrollHeight, previous + Math.max(100, Math.floor(el.clientHeight * 0.75)));
            return el.scrollTop !== previous;
          }, probe.selector);
          succeeded = moved;
        } else {
          const currentElement = before.snapshot.elements.find((item) => item.label === probe.label);
          const locator = currentElement ? await resolveRankedLocator(page, currentElement.locators) : null;
          if (!locator) { blocked++; continue; }
          await page.click(locator.selector);
          succeeded = true;
        }
        if (!succeeded) continue;
        attempted++;
        if (probe.kind === "scroll" && probe.regionKey) scrollSteps.set(probe.regionKey, (scrollSteps.get(probe.regionKey) ?? 0) + 1);
        const after = await capture(page);
        let child = bySignature.get(after.signature);
        if (!child) {
          child = toState(after, state.depth + 1, probe.label);
          bySignature.set(child.signature, child);
          states.push(child);
          await options.onState?.(child);
        }
        edges.push({ fromStateId: state.id, toStateId: child.id, action: probe.label, kind: probe.kind, reversible: true });
        await visit(after, child);

        if (probe.kind === "scroll") await restoreScroll(page, scrollBefore);
        else await restoreDisclosure(page, probe);
        const restoredCapture = await capture(page);
        if (restoredCapture.restorationSignature !== before.restorationSignature) {
          branched++;
          edges[edges.length - 1].reversible = false;
          edges[edges.length - 1].restorationError = "state signature did not return to its pre-probe value";
          markStop("restore_failed");
          return;
        }
        restored++;
      } catch (error) {
        blocked++;
        edges.push({
          fromStateId: state.id,
          toStateId: state.id,
          action: probe.label,
          kind: probe.kind,
          reversible: false,
          restorationError: error instanceof Error ? error.message : String(error),
        });
        markStop("blocked_safety");
        frontierRemaining += probes.length - probeIndex - 1;
        // Do not continue from a state we cannot prove is restored.
        return;
      }
    }
  };

  await options.onState?.(root);
  await visit(initial, root);
  return {
    startUrl: initial.snapshot.url,
    states,
    edges,
    stopReason,
    frontierRemaining,
    limits,
    counts: { discovered: states.length, attempted, restored, branched, blocked, truncated },
  };
}
