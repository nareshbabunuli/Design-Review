import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import puppeteer from "puppeteer";
import { drainDomNavigationEvents, exploreInternalLinkAndReturn, installDomNavigationObserver } from "../lib/ai-automation/dom-first-discovery";

test("production navigation observer captures SPA and hash changes", async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent("<button id=spa>SPA</button><a id=hash href=#details>Details</a><div id=details>Details</div><script>document.querySelector(\"#spa\").onclick=()=>history.pushState({},\"\",\"#dashboard\")</script>");
    await installDomNavigationObserver(page);
    await page.click("#spa");
    await page.click("#hash");
    await page.waitForFunction(() => window.location.hash === "#details");
    // hashchange is dispatched after the URL mutation, so allow the event
    // task to run before draining the observer's queue.
    await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
    const events = await drainDomNavigationEvents(page);
    assert.ok(events.some(event => event.kind === "pushState" && event.to.endsWith("#dashboard")));
    assert.ok(events.some(event => event.kind === "hashchange" && event.to.endsWith("#details")));
  } finally { await browser.close(); }
});

test("production link explorer reports a real source-restoration failure", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/destination") { res.writeHead(200, { "content-type": "text/html" }); res.end("<title>Destination</title><p>Destination page</p>"); return; }
    res.writeHead(200, { "content-type": "text/html" }); res.end("<title>Source</title><a id=internal href=/destination>Internal destination</a>");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const sourceUrl = "http://127.0.0.1:" + address.port + "/";
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });
    const originalGoto = page.goto.bind(page);
    page.goto = async (url, options) => { if (String(url) === sourceUrl) throw new Error("intentional restoration failure"); return originalGoto(url, options); };
    const result = await exploreInternalLinkAndReturn(page, "#internal", sourceUrl + "destination");
    assert.equal(result.restored, false);
    assert.match(result.observation, /source URL restoration failed|restoration failure/i);
    assert.equal(page.url(), sourceUrl + "destination");
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
