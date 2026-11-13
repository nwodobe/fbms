export const DEFAULT_MAX_OPERATIONS = 25;

export function createAtomicQueue({
  read,
  write,
  maxOperations = DEFAULT_MAX_OPERATIONS,
  now = () => new Date().toISOString(),
} = {}) {
  if (typeof read !== 'function' || typeof write !== 'function') {
    throw new TypeError('read and write are required');
  }

  function getQueue() {
    const q = read();
    return Array.isArray(q) ? q : [];
  }

  function enqueueTransaction(ops, meta = {}) {
    if (!Array.isArray(ops) || ops.length === 0) {
      return { ok: false, reason: 'EMPTY_TRANSACTION', accepted: 0 };
    }

    const current = getQueue();
    if (current.length + ops.length > maxOperations) {
      return {
        ok: false,
        reason: 'QUEUE_CAPACITY',
        accepted: 0,
        current: current.length,
        required: ops.length,
        maxOperations,
      };
    }

    const transactionId = meta.transactionId || crypto.randomUUID();
    const createdAt = meta.createdAt || now();
    const staged = ops.map((op, index) => ({
      ...op,
      transaction_id: transactionId,
      transaction_index: index,
      transaction_size: ops.length,
      transaction_status: 'PENDING',
      label: meta.label || op.label || 'Transaction',
      t: createdAt,
    }));

    const next = current.concat(staged);
    try {
      write(next);
    } catch (error) {
      return {
        ok: false,
        reason: 'LOCAL_PERSISTENCE_FAILED',
        accepted: 0,
        error,
      };
    }

    return {
      ok: true,
      transactionId,
      accepted: ops.length,
      queueLength: next.length,
    };
  }

  return { getQueue, enqueueTransaction };
}
