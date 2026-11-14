export function createCircuitBreaker({ failureThreshold = 4, resetMs = 20000 } = {}) {
  let failures = 0;
  let state = 'closed';
  let openedAt = 0;

  return {
    get state() { return state; },
    get failures() { return failures; },
    canRequest() {
      if (state === 'open' && Date.now() - openedAt >= resetMs) {
        state = 'half-open';
        return true;
      }
      return state !== 'open';
    },
    success() {
      failures = 0;
      state = 'closed';
    },
    failure() {
      failures += 1;
      if (state === 'half-open' || failures >= failureThreshold) {
        state = 'open';
        openedAt = Date.now();
      }
    },
    reset() {
      failures = 0;
      state = 'closed';
      openedAt = 0;
    },
    snapshot() {
      return { state, failures, resetMs };
    },
  };
}
