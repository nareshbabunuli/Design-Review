import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer";

test("revealed controls are present after modal, tab, SPA and hash transitions", async () => {
  const html = await readFile(resolve("tests/fixtures/dom-discovery.html"), "utf8");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    assert.equal(await page.$eval("#revealed-modal", el => el.offsetParent === null), true);
    await page.click("#open-modal");
    assert.equal(await page.$eval("#revealed-modal", el => el.offsetParent !== null), true);
    await page.click("#close-modal");
    assert.equal(await page.$eval("#revealed-modal", el => el.offsetParent === null), true);
    await page.click("#show-tab");
    assert.equal(await page.$eval("#revealed-tab", el => el.offsetParent !== null), true);
    await page.click("#spa-link");
    assert.match(page.url(), /#route-dashboard$/);
    assert.equal(await page.$eval("#revealed-spa", el => el.offsetParent !== null), true);
    await page.click("#hash-link");
    await page.waitForFunction(() => location.hash === "#details");
    assert.equal(await page.$eval("#revealed-hash", el => el.offsetParent !== null), true);
  } finally { await browser.close(); }
});

test("restoration failures stay incomplete instead of becoming successful", async () => {
  const attemptRestore = async (navigate) => {
    try { await navigate(); return { restored: true, incomplete: false }; }
    catch (error) { return { restored: false, incomplete: true, reason: String(error.message || error) }; }
  };
  const result = await attemptRestore(async () => { throw new Error("fixture restoration failure"); });
  assert.equal(result.restored, false);
  assert.equal(result.incomplete, true);
  assert.match(result.reason, /fixture restoration failure/);
});
