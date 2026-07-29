import assert from "node:assert/strict";
import test from "node:test";
import { canonicalStringify, digest } from "../server/canonical.js";

test("canonical serialization is independent of object key order", () => {
  const first = { weapon: "pulse", nested: { b: 2, a: 1 } };
  const second = { nested: { a: 1, b: 2 }, weapon: "pulse" };
  assert.equal(canonicalStringify(first), canonicalStringify(second));
  assert.equal(digest(first), digest(second));
});

test("different build inputs produce different content keys", () => {
  assert.notEqual(
    digest({ world: "foundry", weapon: "pulse" }),
    digest({ world: "foundry", weapon: "rail" })
  );
  assert.match(digest({ value: 1 }), /^[a-f0-9]{64}$/);
});
