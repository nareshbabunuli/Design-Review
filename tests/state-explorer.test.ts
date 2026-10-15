import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer";
import { exploreUiStates } from "../lib/ai-automation/state-explorer";
import { inspectPageDom, resolveRankedLocator, resolveCurrentDomTarget } from "../lib/ai-automation/dom-first-discovery";
import { createStagehandObservationProvider, resolveGroundedTarget } from "../lib/ai-automation/target-resolution";

test("ranked locator resolution rejects ambiguous selectors and chooses a unique fallback", async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent('<button>Save</button><button data-testid="save-action">Save</button>');
    const snapshot = await inspectPageDom(page);
    const save = snapshot.elements.find((element) => element.label === "Save" && element.locators.some((locator) => locator.selector.includes("save-action")));
    assert.ok(save, "expected Save control to have ranked locator candidates");
    const resolved = await resolveRankedLocator(page, save.locators);
    assert.ok(resolved, "expected a unique live locator");
    assert.equal(await page.$eval(resolved.selector, (element) => element.getAttribute("data-testid")), "save-action");
  } finally {
    await browser.close();
  }
});

test("current DOM target resolver recovers from stale selectors using a unique semantic label", async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent('<button data-testid="open-menu" aria-label="Open menu"><svg class="lucide-menu"></svg></button>');
    const resolved = await resolveCurrentDomTarget(page, {
      selector: "button:nth-of-type(99)",
      label: "Open menu",
      role: "button",
      elementType: "button",
    });
    assert.ok(resolved, "expected a fresh semantic locator for the menu button");
    assert.equal(resolved.matchedBy, "label");
    assert.equal(await page.$eval(resolved.selector, (element) => element.getAttribute("data-testid")), "open-menu");
  } finally {
    await browser.close();
  }
});

test("icon-only controls can be discovered and resolved from inferred SVG names", async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent('<button data-testid="menu-control"><svg class="lucide-menu"></svg></button>');
    const snapshot = await inspectPageDom(page);
    const menu = snapshot.elements.find((element) => element.label === "Menu");
    assert.ok(menu, "expected icon-only menu button to be inventoried");
    const resolved = await resolveRankedLocator(page, menu.locators);
    assert.ok(resolved, "expected inferred icon name to resolve the actual control");
    assert.equal(await page.$eval(resolved.selector, (element) => element.getAttribute("data-testid")), "menu-control");
  } finally {
    await browser.close();
  }
});

test("current DOM target resolver rejects ambiguous semantic labels", async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent('<button aria-label="More options">A</button><button aria-label="More options">B</button>');
    const resolved = await resolveCurrentDomTarget(page, { selector: "button:nth-of-type(99)", label: "More options", role: "button", elementType: "button" });
    assert.equal(resolved, null, "must not guess when multiple live controls have the same semantic name");
  } finally {
    await browser.close();
  }
});

test("bounded state explorer discovers and restores a modal state", async () => {
  const html = await readFile(resolve("tests/fixtures/dom-discovery.html"), "utf8");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const report = await exploreUiStates(page, { maxDepth: 2, maxStates: 8, maxScrollSteps: 1 });
    assert.ok(report.states.length > 1, "expected at least one discovered UI state");
    assert.ok(report.edges.length > 0, "expected a recorded state transition");
    assert.ok(report.edges.some((edge) => edge.selector && edge.reversible), "expected a replayable modal transition");
    assert.ok(report.counts.attempted <= 100, "probe work must remain bounded");
  } finally {
    await browser.close();
  }
});

test("state explorer reports frontier truncation instead of claiming completeness", async () => {
  const html = await readFile(resolve("tests/fixtures/dom-discovery.html"), "utf8");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const report = await exploreUiStates(page, { maxDepth: 0, maxStates: 1, maxScrollSteps: 0 });
    assert.notEqual(report.stopReason, "exhausted");
    assert.ok(report.frontierRemaining > 0 || report.counts.truncated > 0);
  } finally {
    await browser.close();
  }
});


test("current target resolver rejects a reused selector and falls back only to the expected semantic target", async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent('<button id="reused">Delete</button><button id="save">Save</button>');
    const resolved = await resolveCurrentDomTarget(page, {
      selector: "#reused",
      label: "Save",
      role: "button",
      elementType: "button",
    });
    assert.ok(resolved, "expected the unique live Save button to be recovered");
    assert.equal(resolved.selector, "#save");
    assert.equal(resolved.label, "Save");
    assert.equal(resolved.matchedBy, "label");
  } finally {
    await browser.close();
  }
});

test("current target resolver fails closed when a link destination changed", async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent('<a id="dashboard" href="https://example.com/account">Dashboard</a>');
    const resolved = await resolveCurrentDomTarget(page, {
      selector: "#dashboard",
      label: "Dashboard",
      role: "link",
      elementType: "a",
      href: "https://example.com/billing",
    });
    assert.equal(resolved, null, "matching label must not override an unexpected destination");
  } finally {
    await browser.close();
  }
});

test("grounded resolver uses Stagehand proposals only after DOM resolution fails and revalidates them", async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent('<button id="secondary">Save</button><button id="primary">Save</button><button id="delete">Delete</button>');
    let observeCalls = 0;
    const resolved = await resolveGroundedTarget(page, {
      description: "Save in the primary panel",
      hint: { selector: "#stale", label: "Save", role: "button", elementType: "button" },
    }, async () => {
      observeCalls++;
      return [{ selector: "#primary", label: "Save", role: "button", elementType: "button" }];
    });
    assert.equal(observeCalls, 1, "observe fallback should run only after ambiguous DOM grounding");
    assert.ok(resolved, "expected a semantically compatible Stagehand proposal to be re-grounded");
    assert.equal(resolved.source, "stagehand-observe");
    assert.equal(resolved.selector, "#primary");
    assert.equal(resolved.label, "Save");
    assert.ok(resolved.confidence < 0.8, "AI-assisted grounding should have a lower heuristic score");
  } finally {
    await browser.close();
  }
});

test("grounded resolver cannot use Stagehand to override the planned semantic identity", async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent('<button id="secondary">Save</button><button id="primary">Save</button><button id="delete">Delete</button>');
    const resolved = await resolveGroundedTarget(page, {
      description: "Save in the primary panel",
      hint: { selector: "#stale", label: "Save", role: "button", elementType: "button" },
    }, async () => [{ selector: "#delete", label: "Delete", role: "button", elementType: "button" }]);
    assert.equal(resolved, null, "Stagehand's suggestion must not override the planned label");
  } finally {
    await browser.close();
  }
});

test("grounded resolver will not ask Stagehand to guess when the plan has no stable identity", async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent('<button id="save">Save</button>');
    let observeCalls = 0;
    const resolved = await resolveGroundedTarget(page, {
      description: "some button",
      hint: { selector: "#missing" },
    }, async () => {
      observeCalls++;
      return [{ selector: "#save", label: "Save", role: "button", elementType: "button" }];
    });
    assert.equal(resolved, null);
    assert.equal(observeCalls, 0, "AI must not invent the target identity");
  } finally {
    await browser.close();
  }
});


test("Stagehand provider uses observe-only suggestions and converts XPath to a live unique CSS target", async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent('<button id="save">Save</button>');
    const observed: { instruction: string; page?: unknown; timeout?: number }[] = [];
    let executionCalls = 0;
    const fakeStagehand = {
      observe: async (instruction: string, options?: { page?: unknown; timeout?: number }) => {
        observed.push({ instruction, page: options?.page, timeout: options?.timeout });
        return [{ selector: "/html/body/button[1]", description: "Save button", method: "click", arguments: [] }];
      },
      act: async () => { executionCalls++; },
    };
    const provider = createStagehandObservationProvider(fakeStagehand, page);
    const snapshot = await inspectPageDom(page);
    const proposals = await provider({
      description: "Save button in the main form",
      hint: { label: "Save", role: "button", elementType: "button" },
      snapshot,
    });
    assert.equal(observed.length, 1, "expected exactly one observation request");
    assert.match(observed[0].instruction, /OBSERVE ONLY/);
    assert.equal(observed[0].page, page);
    assert.ok(proposals?.length);
    assert.equal(proposals?.[0].selector, "#save");
    assert.equal(proposals?.[0].label, "Save");
    assert.equal(executionCalls, 0, "provider must never call Stagehand act()");
  } finally {
    await browser.close();
  }
});
