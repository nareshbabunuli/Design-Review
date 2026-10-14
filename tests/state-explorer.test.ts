import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer";
import { exploreUiStates } from "../lib/ai-automation/state-explorer";

test("bounded state explorer discovers a reversible modal state", async () => {
  const html = await readFile(resolve("tests/fixtures/dom-discovery.html"), "utf8");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const report = await exploreUiStates(page, { maxDepth: 2, maxStates: 8, maxScrollSteps: 1 });
    assert.ok(report.states.length > 1, "expected at least one discovered UI state");
    assert.ok(report.edges.length > 0, "expected a recorded state transition");
    assert.ok(report.edges.some((edge) => edge.selector && edge.reversible), "expected a replayable transition");
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
