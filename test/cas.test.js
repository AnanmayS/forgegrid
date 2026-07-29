import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ContentAddressedStore } from "../server/cas.js";
import { digest } from "../server/canonical.js";

test("content-addressed store writes, reads, counts, and clears artifacts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgegrid-cas-"));
  const store = new ContentAddressedStore(directory);
  const key = digest({ task: "compile", input: "pulse" });
  const artifact = { output: { checksum: "abc123" } };
  try {
    await store.initialize();
    assert.equal(await store.has(key), false);
    await store.put(key, artifact);
    assert.equal(await store.has(key), true);
    assert.deepEqual(await store.get(key), artifact);
    assert.equal(await store.count(), 1);
    await store.clear();
    assert.equal(await store.count(), 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("content-addressed store rejects unsafe keys", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgegrid-cas-"));
  const store = new ContentAddressedStore(directory);
  try {
    await assert.rejects(store.put("../escape", {}), /invalid content key/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
