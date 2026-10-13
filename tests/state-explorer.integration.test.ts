import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer";
import { exploreUiStates } from "../lib/ai-automation/state-explorer";

test("bounded explorer discovers safe menu, accordion, details, modal, and scroll states", async () => {
  const html = await readFile(resolve("tests/fixtures/state-exploration.html"), "utf8");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const report = await exploreUiStates(page, { maxDepth: 3, maxStates: 24, maxScrollSteps: 2 });

    assert.ok(report.states.length > 1, "exploration should produce child states");
    assert.ok(report.states.some((state) => state.elements.some((element) => element.label === "Settings action")), "menu state should expose menu items");
    assert.ok(report.states.some((state) => state.elements.some((element) => element.label === "Conditional field")), "accordion state should expose conditional form fields");
    assert.ok(report.states.some((state) => state.elements.some((element) => element.label === "Details-only action")), "native details state should expose its nested action");
    assert.ok(report.states.some((state) => state.elements.some((element) => element.label === "Confirm harmless fixture action")), "dialog state should expose modal actions");
    assert.ok(report.edges.some((edge) => edge.kind === "scroll"), "scrollable regions should be explored with a bounded budget");
    assert.ok(report.edges.some((edge) => edge.toStateId !== edge.fromStateId && Boolean(edge.selector)), "state transitions must retain selectors so the full-app engine can replay discovered states");
    assert.ok(report.counts.attempted > 0);
    assert.ok(report.counts.restored > 0, "reversible transitions should restore the prior state");
    assert.ok(["exhausted", "truncated_max_depth", "truncated_max_states", "truncated_scroll_budget", "blocked_safety", "restore_failed"].includes(report.stopReason));
    assert.equal(page.url(), "about:blank", "state exploration must not navigate away from the supplied page");
    assert.equal(await page.$eval("#menu-trigger", (el) => el.getAttribute("aria-expanded")), "false", "menu trigger should be restored");
    assert.equal(await page.$eval("#accordion-trigger", (el) => el.getAttribute("aria-expanded")), "false", "accordion trigger should be restored");
    assert.equal(await page.$eval("#fixture-dialog", (el) => el.open), false, "modal should be closed after probing");
    assert.equal(await page.$eval("#native-details", (el) => el.open), false, "native details should be restored closed");
    assert.equal(await page.$eval("#lazy-scroll-region", (el) => el.scrollTop), 0, "nested scroll position should be restored");
  } finally {
    await browser.close();
  }
});

test("state and depth limits are reported instead of silently claiming exhaustive discovery", async () => {
  const html = await readFile(resolve("tests/fixtures/state-exploration.html"), "utf8");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const report = await exploreUiStates(page, { maxDepth: 0, maxStates: 1, maxScrollSteps: 0 });
    assert.equal(report.states.length, 1);
    assert.equal(report.stopReason, "truncated_max_depth");
    assert.ok(report.counts.truncated > 0);
    assert.equal(report.frontierRemaining, report.counts.truncated);
  } finally {
    await browser.close();
  }
});
