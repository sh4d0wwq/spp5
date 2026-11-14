export function createMetrics() {
  let requests = 0;
  let errors = 0;
  const samples = [];

  return {
    incRequests() { requests += 1; },
    incErrors() { errors += 1; },
    observe(ms) {
      samples.push(ms);
      if (samples.length > 500) samples.shift();
    },
    snapshot() {
      const sorted = [...samples].sort((a, b) => a - b);
      const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
      return { requests, errors, p95Ms: Math.round(p95 * 10) / 10, samples: sorted.length };
    },
    prometheus(service) {
      const snap = this.snapshot();
      return [
        `# TYPE graphql_requests_total counter`,
        `graphql_requests_total{service="${service}"} ${snap.requests}`,
        `# TYPE graphql_errors_total counter`,
        `graphql_errors_total{service="${service}"} ${snap.errors}`,
        `# TYPE graphql_latency_p95_ms gauge`,
        `graphql_latency_p95_ms{service="${service}"} ${snap.p95Ms}`,
        '',
      ].join('\n');
    },
  };
}
