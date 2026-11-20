import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateChecks, formatReport } from "./require-green.mjs";

const run = (name, status, conclusion, id = 1) => ({ id, name, status, conclusion, html_url: `https://x/${name}/${id}` });
const names = ["a", "b"];
const green = [run("a", "completed", "success"), run("b", "completed", "success")];

test("success passes", () => assert.equal(evaluateChecks(green, names).ok, true));

test("skipped counts as passing", () => {
  assert.equal(evaluateChecks([run("a", "completed", "skipped"), green[1]], names).ok, true);
});

test("failure is reported with url", () => {
  const r = evaluateChecks([run("a", "completed", "failure"), green[1]], names);
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems, [{ name: "a", state: "failed (failure)", url: "https://x/a/1" }]);
});

test("cancelled is not passing", () => {
  assert.equal(evaluateChecks([run("a", "completed", "cancelled"), green[1]], names).ok, false);
});

test("pending is reported", () => {
  const r = evaluateChecks([run("a", "in_progress", null), green[1]], names);
  assert.equal(r.problems[0].state, "pending");
});

test("missing is reported", () => {
  const r = evaluateChecks([green[0]], names);
  assert.deepEqual(r.problems, [{ name: "b", state: "missing", url: null }]);
});

test("latest rerun wins", () => {
  const r = evaluateChecks([run("a", "completed", "failure", 1), run("a", "completed", "success", 2), green[1]], names);
  assert.equal(r.ok, true);
  const r2 = evaluateChecks([run("a", "completed", "success", 1), run("a", "completed", "failure", 2), green[1]], names);
  assert.equal(r2.ok, false);
});

test("report names each problem", () => {
  const text = formatReport("abc", [{ name: "a", state: "pending", url: "u" }, { name: "b", state: "missing", url: null }]);
  assert.match(text, /`a`: pending u/);
  assert.match(text, /`b`: missing/);
});
