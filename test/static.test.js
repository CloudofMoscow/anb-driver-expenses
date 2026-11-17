import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

for (const [htmlName, scriptName] of [
  ["login.html", "login.js"],
  ["office.html", "office.js"],
  ["driver.html", "driver.js"]
]) {
  test(`${htmlName} contains unique IDs required by ${scriptName}`, () => {
    const html = readFileSync(resolve(root, htmlName), "utf8");
    const script = readFileSync(resolve(root, scriptName), "utf8");
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${htmlName} contains duplicate IDs`);
    const queriedIds = [...script.matchAll(/querySelector\("#([A-Za-z0-9_-]+)"\)/g)].map((match) => match[1]);
    for (const id of queriedIds) assert.equal(ids.includes(id), true, `${scriptName} expects missing #${id}`);
    assert.equal(/<script(?![^>]+\bsrc=)/i.test(html), false, `${htmlName} must not use inline scripts under CSP`);
  });
}

test("service worker precache only references existing public files", () => {
  const worker = readFileSync(resolve(root, "sw.js"), "utf8");
  const assetsBlock = worker.match(/const ASSETS = \[([\s\S]*?)\];/)?.[1] || "";
  const paths = [...assetsBlock.matchAll(/"\.\/([^"?]+)(?:\?[^\"]*)?"/g)].map((match) => match[1]);
  assert.ok(paths.length > 0);
  for (const path of paths) assert.equal(existsSync(resolve(root, path)), true, `missing precache asset ${path}`);
  assert.equal(paths.includes("index.html"), false, "legacy index.html must not be precached");
  assert.equal(paths.includes("app.js"), false, "legacy app.js must not be precached");
});

test("PWA cache-busting references use the active service-worker version", () => {
  const worker = readFileSync(resolve(root, "sw.js"), "utf8");
  const activeVersion = worker.match(/CACHE_NAME\s*=\s*"anb-fleet-v(\d+)"/)?.[1];
  assert.ok(activeVersion, "service-worker cache version is missing");
  const sources = [
    worker,
    ...["login.js", "office.js", "driver.js", "driver-outbox.js", "form-feedback.js", "app-shell.js"].map((name) => readFileSync(resolve(root, name), "utf8")),
    readFileSync(resolve(root, "login.html"), "utf8"),
    readFileSync(resolve(root, "office.html"), "utf8"),
    readFileSync(resolve(root, "driver.html"), "utf8"),
    readFileSync(resolve(root, "manifest.webmanifest"), "utf8")
  ].join("\n");
  const versions = [...sources.matchAll(/(?:styles\.css|api-client\.js|financial-mutation\.js|login\.js|driver\.js|office\.js|manifest\.webmanifest|icon(?:-\d+)?\.(?:png|svg))\?v=(\d+)/g)]
    .map((match) => match[1]);
  assert.ok(versions.length > 0, "no versioned PWA assets found");
  assert.deepEqual([...new Set(versions)], [activeVersion]);
  for (const name of ["login.js", "office.js", "driver.js", "driver-outbox.js", "form-feedback.js", "app-shell.js"]) {
    for (const [, imported] of readFileSync(resolve(root, name), "utf8").matchAll(/from "(\.\/[^"\n]+\.js(?:\?v=\d+)?)"/g)) {
      assert.equal(imported.endsWith(`?v=${activeVersion}`), true, `${name}: ${imported} must bypass stale HTTP module caches`);
      assert.ok(worker.includes(`"${imported}"`), `${imported} must be available offline`);
    }
  }
});

test("shell version, offline assets and server allowlist agree without disabling zoom", () => {
  const shell = readFileSync(resolve(root, "app-shell.js"), "utf8");
  const worker = readFileSync(resolve(root, "sw.js"), "utf8");
  const version = shell.match(/APP_VERSION = "(\d+)"/)[1];
  assert.ok(worker.includes(`anb-fleet-v${version}`));
  assert.ok(worker.includes(`"./app-shell.js?v=${version}"`));
  assert.ok(readFileSync(resolve(root, "server/app.js"), "utf8").includes('"app-shell.js"'));
  assert.ok(JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).scripts.check.includes("node --check app-shell.js"));
  for (const name of ["driver.html", "office.html", "login.html"]) {
    const html = readFileSync(resolve(root, name), "utf8");
    const viewport = html.match(/name="viewport" content="([^"]+)"/)[1];
    assert.ok(viewport.includes("viewport-fit=cover"));
    assert.ok(viewport.includes("interactive-widget=resizes-content"));
    assert.doesNotMatch(viewport, /maximum-scale|user-scalable/);
    if (name !== "login.html") assert.ok(html.includes(`data-app-version>Версия интерфейса v${version}`));
  }
});

test("manifest is valid and opens the role-aware login", () => {
  const manifest = JSON.parse(readFileSync(resolve(root, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.start_url, "./login.html");
  assert.equal(manifest.display, "standalone");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
});

test("role portals expose stable hash routing without browser prompt dialogs", () => {
  const office = readFileSync(resolve(root, "office.js"), "utf8");
  const driver = readFileSync(resolve(root, "driver.js"), "utf8");
  for (const [name, source] of [["office.js", office], ["driver.js", driver]]) {
    assert.equal(/\b(?:prompt|confirm)\s*\(/.test(source), false, `${name} must use an in-product dialog`);
    assert.match(source, /addEventListener\("hashchange"/);
  }
  assert.match(office, /function applyOfficeRoute/);
  assert.match(driver, /function applyDriverRoute/);
});

test("tabs have matching accessible panels", () => {
  for (const htmlName of ["office.html", "driver.html"]) {
    const html = readFileSync(resolve(root, htmlName), "utf8");
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((match) => match[0]);
    assert.ok(tabs.length > 0, `${htmlName} must expose role tabs`);
    for (const tab of tabs) {
      const controls = tab.match(/aria-controls="([^"]+)"/)?.[1];
      assert.ok(controls, `${htmlName} tab is missing aria-controls`);
      assert.equal(ids.has(controls), true, `${htmlName} tab points to missing #${controls}`);
    }
  }
});

test("driver compensation stays capability-gated and hidden by default", () => {
  const html = readFileSync(resolve(root, "driver.html"), "utf8");
  const script = readFileSync(resolve(root, "driver.js"), "utf8");
  assert.match(html, /data-driver-tab="money"[^>]*hidden/);
  assert.match(html, /data-driver-panel="money"[^>]*hidden/);
  assert.match(script, /compensationVisible:\s*false/);
  assert.match(script, /driverCompensationVisible\(\)/);
});
