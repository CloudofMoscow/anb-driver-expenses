import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { captureUiState } from "../ui-state.js";

const driver = readFileSync(new URL("../driver.js", import.meta.url), "utf8");
const chooseSource = driver.slice(driver.indexOf("function chooseTrip()"), driver.indexOf("\nfunction render()"));
const choose = new Function("state", "selectedTripId", "localStorage", "selectedTripStorageKey", `${chooseSource}; chooseTrip(); return selectedTripId;`);

test("explicit driver selection survives polling with multiple assignments and an existing draft", () => {
  const writes = [];
  const storage = { setItem: (...args) => writes.push(args) };
  const state = { trips: [{ id: "first", status: "assigned" }, { id: "second", status: "assigned" }] };
  assert.equal(choose(state, "second", storage, () => "selection"), "second");
  assert.deepEqual(writes, [["selection", "second"]]);
  state.trips.unshift({ id: "active", status: "in_progress" });
  assert.equal(choose(state, "second", storage, () => "selection"), "second");
});

test("missing driver selection falls back to an active trip, then an assignment", () => {
  const storage = { setItem() {} };
  const state = { trips: [{ id: "assigned", status: "assigned" }, { id: "active", status: "in_progress" }] };
  assert.equal(choose(state, "removed", storage, () => "selection"), "active");
  state.trips.pop();
  assert.equal(choose(state, "removed", storage, () => "selection"), "assigned");
  state.trips = [];
  assert.equal(choose(state, "removed", storage, () => "selection"), "");
});

test("UI restoration retains attachments for the same trip and never transfers them to another trip", () => {
  const previousDocument = globalThis.document, previousCss = globalThis.CSS, previousDataTransfer = globalThis.DataTransfer;
  const selectedFile = { name: "odometer.jpg" };
  const selectedFiles = [selectedFile];
  let control = { id: "odometerPhoto", type: "file", files: selectedFiles, form: { dataset: { tripId: "second" } } };
  const body = {};
  globalThis.CSS = { escape: (value) => value };
  globalThis.DataTransfer = class {
    files = [];
    items = { add: (file) => this.files.push(file) };
  };
  globalThis.document = {
    body, activeElement: body,
    querySelectorAll: (selector) => selector === 'input[type="file"]' ? [control] : [],
    querySelector: () => control
  };
  try {
    const restoreSameTrip = captureUiState();
    selectedFiles.length = 0; // Native form.reset() empties its original FileList.
    control = { ...control, files: [] };
    restoreSameTrip();
    assert.deepEqual(control.files, [selectedFile]);
    const restoreDifferentTrip = captureUiState();
    control = { ...control, files: [], form: { dataset: { tripId: "first" } } };
    restoreDifferentTrip();
    assert.deepEqual(control.files, []);
  } finally { globalThis.document = previousDocument; globalThis.CSS = previousCss; globalThis.DataTransfer = previousDataTransfer; }
});
