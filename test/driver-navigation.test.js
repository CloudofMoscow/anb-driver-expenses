import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { updateTabStops } from "../ui-state.js";

test("expense uses the visible Expenses tab and restores its history panel connection on return", () => {
  function node(name, kind, hidden = false) {
    return {
      dataset: { [kind]: name }, hidden, attributes: {},
      classList: { toggle() {} },
      setAttribute(key, value) { this.attributes[key] = value; },
      getAttribute(key) { return this.attributes[key]; },
      getClientRects() { return this.hidden ? [] : [{}]; }
    };
  }
  const tabs = ["home", "trip", "expense", "journal", "messages", "money"].map((name) => node(name, "driverTab", ["expense", "money"].includes(name)));
  const panels = ["home", "trip", "expense", "journal", "messages", "money"].map((name) => node(name, "driverPanel"));
  const journal = tabs.find((tab) => tab.dataset.driverTab === "journal");
  const location = { hash: "#home", pathname: "/driver.html", search: "" };
  const document = { querySelector: () => journal, title: "" };
  const source = readFileSync(new URL("../driver.js", import.meta.url), "utf8");
  const routeSource = source.slice(source.indexOf("function applyDriverRoute("), source.indexOf("\nfunction handleDriverTabKeydown("));
  const apply = new Function("els", "location", "history", "document", "window", "driverCompensationVisible", "updateTabStops", "reducedMotionEnabled", `${routeSource}; return applyDriverRoute;`)(
    { tabs, panels }, location, { replaceState() {} }, document, { scrollTo() {} }, () => false, updateTabStops, () => true
  );
  for (const route of ["expense", "history", "home", "expense"]) {
    location.hash = `#${route}`;
    apply({ scroll: false });
    const expectedTab = route === "expense" || route === "history" ? "journal" : "home";
    assert.deepEqual(tabs.filter((tab) => tab.attributes["aria-selected"] === "true").map((tab) => tab.dataset.driverTab), [expectedTab]);
    assert.equal(tabs.find((tab) => tab.dataset.driverTab === expectedTab).tabIndex, 0);
    assert.equal(journal.attributes["aria-controls"], route === "expense" ? "driverPanelExpense" : "driverPanelJournal");
    assert.deepEqual(panels.filter((panel) => !panel.hidden).map((panel) => panel.dataset.driverPanel), [route === "history" ? "journal" : route]);
  }
});
