import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer";
import { inspectPageDom, resolveRankedLocator } from "../lib/ai-automation/dom-first-discovery";

test("ranked locator candidates prioritize accessible names and revalidate uniqueness", async () => {
  const html = await readFile(resolve("tests/fixtures/state-exploration.html"), "utf8");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const snapshot = await inspectPageDom(page);
    const icon = snapshot.elements.find((element) => element.label === "Open details");
    assert.ok(icon, "icon-only SVG action should be inventoried");
    assert.ok(icon.locators.length >= 2, "each action should retain locator alternatives");
    assert.equal(icon.locators[0].strategy, "role", "accessible role/name is the highest-ranked candidate");
    const resolved = await resolveRankedLocator(page, icon.locators);
    assert.ok(resolved, "a live unique locator should resolve");
    assert.equal(await page.$eval(resolved.selector, (el) => el.id), "icon-action");

    const duplicateName = snapshot.elements.find((element) => element.label === "First duplicate name");
    assert.ok(duplicateName);
    const nameCandidate = duplicateName.locators.find((candidate) => candidate.strategy === "attribute" && candidate.attribute === "name");
    assert.ok(nameCandidate);
    assert.equal(nameCandidate.uniqueAtDiscovery, false, "duplicate attributes must not be called unique");

    await page.click("#menu-trigger");
    const menuSnapshot = await inspectPageDom(page);
    assert.ok(menuSnapshot.elements.some((element) => element.label === "Settings action"), "opening a menu reveals its controls");
    await page.click("#accordion-trigger");
    const accordionSnapshot = await inspectPageDom(page);
    assert.ok(accordionSnapshot.elements.some((element) => element.label === "Conditional field"), "expanding an accordion reveals conditional form fields");
    await page.click("#open-modal");
    const modalSnapshot = await inspectPageDom(page);
    assert.ok(modalSnapshot.elements.some((element) => element.label === "Confirm harmless fixture action"), "opening a dialog reveals modal controls");
    await page.click("#dialog-close");
    await page.click("#load-more");
    const lazySnapshot = await inspectPageDom(page);
    assert.ok(lazySnapshot.elements.some((element) => element.label === "Lazy-loaded action"), "lazy-loaded actions are inventoried after the state changes");
  } finally {
    await browser.close();
  }
});
