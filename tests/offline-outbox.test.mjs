import assert from 'node:assert/strict';
import { createAtomicQueue } from '../shared/offline-outbox.mjs';

function harness(seedCount, maxOperations = 25, failWrite = false) {
  let state = Array.from({ length: seedCount }, (_, i) => ({ seed: i }));
  const queue = createAtomicQueue({
    read: () => structuredClone(state),
    write: (next) => {
      if (failWrite) throw new Error('quota exceeded');
      state = structuredClone(next);
    },
    maxOperations,
    now: () => '2026-08-22T09:27:00.000Z',
  });
  return { queue, state: () => state };
}

for (const [seed, ops] of [[24, 2], [23, 3], [24, 3], [25, 2]]) {
  const h = harness(seed);
  const before = h.state().length;
  const result = h.queue.enqueueTransaction(
    Array.from({ length: ops }, (_, i) => ({ kind: 'insert', i })),
    { transactionId: `tx-${seed}-${ops}` },
  );
  assert.equal(result.ok, false, `${seed}+${ops} must reject atomically`);
  assert.equal(result.accepted, 0, `${seed}+${ops} must accept zero operations`);
  assert.equal(h.state().length, before, `${seed}+${ops} must leave queue unchanged`);
}

{
  const h = harness(23);
  const result = h.queue.enqueueTransaction([{ kind: 'a' }, { kind: 'b' }], { transactionId: 'tx-ok' });
  assert.equal(result.ok, true);
  assert.equal(result.accepted, 2);
  assert.equal(h.state().length, 25);
  assert.equal(h.state()[23].transaction_id, 'tx-ok');
  assert.equal(h.state()[24].transaction_id, 'tx-ok');
}

{
  const h = harness(0, 25, true);
  const result = h.queue.enqueueTransaction([{ kind: 'a' }], { transactionId: 'tx-quota' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'LOCAL_PERSISTENCE_FAILED');
  assert.equal(result.accepted, 0);
  assert.equal(h.state().length, 0);
}

console.log('PASS offline-outbox atomic enqueue tests');
