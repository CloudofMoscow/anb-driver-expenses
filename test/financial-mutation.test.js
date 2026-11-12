import assert from "node:assert/strict";
import test from "node:test";

import { stableJson, submitIdempotentMutation } from "../financial-mutation.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };
}

test("lost financial response reuses the same mutation id and prepared attachment", async () => {
  const storage = memoryStorage();
  let prepared = 0;
  let sequence = 0;
  const sentBodies = [];
  const options = {
    storage,
    storageKey: "office:test",
    key: "payment:trip-1",
    draft: { amountKopecks: 700_000, comment: "Аванс" },
    createId: () => `mutation-${++sequence}`,
    prepareBody: async (id) => {
      prepared += 1;
      return { amountKopecks: 700_000, attachmentId: "att-proof", clientMutationId: id };
    }
  };

  await assert.rejects(
    submitIdempotentMutation({
      ...options,
      send: async (body) => {
        sentBodies.push(body);
        throw new TypeError("network response lost");
      }
    }),
    /network response lost/
  );

  const result = await submitIdempotentMutation({
    ...options,
    send: async (body) => {
      sentBodies.push(body);
      return { duplicate: true };
    }
  });

  assert.deepEqual(result, { duplicate: true });
  assert.equal(prepared, 1);
  assert.equal(sentBodies.length, 2);
  assert.equal(sentBodies[0].clientMutationId, "mutation-1");
  assert.equal(sentBodies[1].clientMutationId, "mutation-1");
  assert.equal(sentBodies[1].attachmentId, "att-proof");
});

test("definitive HTTP rejection clears a pending mutation for corrected input", async () => {
  const storage = memoryStorage();
  let sequence = 0;
  const base = {
    storage,
    storageKey: "office:http-error",
    key: "adjustment:trip-1",
    draft: { amountKopecks: -500_000 },
    createId: () => `mutation-${++sequence}`,
    prepareBody: async (id) => ({ amountKopecks: -500_000, clientMutationId: id })
  };
  const rejection = new Error("validation");
  rejection.status = 400;
  await assert.rejects(submitIdempotentMutation({ ...base, send: async () => { throw rejection; } }));
  let retriedId;
  await submitIdempotentMutation({
    ...base,
    send: async (body) => { retriedId = body.clientMutationId; return { ok: true }; }
  });
  assert.equal(retriedId, "mutation-2");
});

test("stableJson ignores object key insertion order", () => {
  assert.equal(stableJson({ b: 2, a: { d: 4, c: 3 } }), stableJson({ a: { c: 3, d: 4 }, b: 2 }));
});

test("memory fallback keeps mutation id when browser storage rejects writes", async () => {
  const storage = {
    getItem: () => null,
    setItem: () => { throw new Error("quota denied"); }
  };
  let sequence = 0;
  let prepared = 0;
  const options = {
    storage,
    storageKey: `office:denied:${Date.now()}`,
    key: "transfer",
    draft: { amountKopecks: 123_400 },
    createId: () => `denied-${++sequence}`,
    prepareBody: async (id) => {
      prepared += 1;
      return { amountKopecks: 123_400, clientMutationId: id };
    }
  };
  await assert.rejects(submitIdempotentMutation({
    ...options,
    send: async () => { throw new TypeError("offline"); }
  }));
  let repeatedId;
  await submitIdempotentMutation({
    ...options,
    send: async (body) => { repeatedId = body.clientMutationId; return { ok: true }; }
  });
  assert.equal(repeatedId, "denied-1");
  assert.equal(prepared, 1);
});

test("ambiguous 502 response retains the prepared mutation for a safe retry", async () => {
  const storage = memoryStorage();
  let sequence = 0;
  let prepared = 0;
  const options = {
    storage,
    storageKey: "office:gateway-error",
    key: "company-expense",
    draft: { amountKopecks: 99_900 },
    createId: () => `gateway-${++sequence}`,
    prepareBody: async (id) => {
      prepared += 1;
      return { amountKopecks: 99_900, clientMutationId: id };
    }
  };
  const gatewayError = new Error("bad gateway");
  gatewayError.status = 502;
  await assert.rejects(submitIdempotentMutation({
    ...options,
    send: async () => { throw gatewayError; }
  }));
  let repeatedId;
  await submitIdempotentMutation({
    ...options,
    send: async (body) => { repeatedId = body.clientMutationId; return { duplicate: true }; }
  });
  assert.equal(repeatedId, "gateway-1");
  assert.equal(prepared, 1);
});

test("changed draft reconciles an ambiguous previous command before allowing a new id", async () => {
  const storage = memoryStorage();
  let sequence = 0;
  const sent = [];
  const base = {
    storage,
    storageKey: "office:changed-after-loss",
    key: "transfer",
    createId: () => `changed-${++sequence}`
  };
  await assert.rejects(submitIdempotentMutation({
    ...base,
    draft: { amountKopecks: 100_000 },
    prepareBody: async (id) => ({ amountKopecks: 100_000, clientMutationId: id }),
    send: async (body) => { sent.push(body); throw new TypeError("response lost"); }
  }));

  await assert.rejects(
    submitIdempotentMutation({
      ...base,
      draft: { amountKopecks: 200_000 },
      prepareBody: async (id) => ({ amountKopecks: 200_000, clientMutationId: id }),
      send: async (body) => { sent.push(body); return { duplicate: true }; }
    }),
    (error) => error.code === "PREVIOUS_MUTATION_RECONCILED"
  );
  assert.equal(sequence, 1);
  assert.equal(sent[1].clientMutationId, "changed-1");
  assert.equal(sent[1].amountKopecks, 100_000);

  let newId;
  await submitIdempotentMutation({
    ...base,
    draft: { amountKopecks: 200_000 },
    prepareBody: async (id) => ({ amountKopecks: 200_000, clientMutationId: id }),
    send: async (body) => { newId = body.clientMutationId; return { ok: true }; }
  });
  assert.equal(newId, "changed-2");
});
