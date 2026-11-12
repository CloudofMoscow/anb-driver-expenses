import assert from "node:assert/strict";
import test from "node:test";
import { api } from "../api-client.js";

test("conditional polling only remembers a revision after consuming a complete successful payload", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let call = 0;
  globalThis.fetch = async (path, options) => {
    requests.push(options.headers.get("If-None-Match"));
    call++;
    if (call === 1) return new Response('{"truncated":', { headers: { "Content-Type": "application/json", ETag: '"revision-1"' } });
    if (call === 2) return new Response('{"value":1}', { headers: { "Content-Type": "application/json", ETag: '"revision-1"' } });
    return new Response(null, { status: 304 });
  };
  try {
    await assert.rejects(api("/qa/revision", { skipUnchanged: true }));
    assert.deepEqual(await api("/qa/revision", { skipUnchanged: true }), { value: 1 });
    assert.equal(await api("/qa/revision", { skipUnchanged: true }), null);
    assert.deepEqual(requests, [null, null, '"revision-1"']);
  } finally { globalThis.fetch = originalFetch; }
});
