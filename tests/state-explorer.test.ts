import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer";
import { exploreUiStates } from "../lib/ai-automation/state-explorer";
import { inspectPageDom, resolveRankedLocator, resolveCurrentDomTarget } from "../lib/ai-automation/dom-first-discovery";

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
