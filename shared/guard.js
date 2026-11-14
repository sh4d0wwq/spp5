const LIMITS = { maxDepth: 8, maxFields: 220 };

export function measureDocument(document) {
  const fragments = new Map();
  for (const def of document.definitions) {
    if (def.kind === 'FragmentDefinition') fragments.set(def.name.value, def);
  }

  let maxDepth = 0;
  let fields = 0;
  let introspection = false;

  const walk = (selectionSet, depth, stack) => {
    if (!selectionSet) return;
    for (const sel of selectionSet.selections) {
      if (sel.kind === 'Field') {
        if (sel.name.value === '__typename') continue;
        fields += 1;
        maxDepth = Math.max(maxDepth, depth);
        walk(sel.selectionSet, depth + 1, stack);
      } else if (sel.kind === 'InlineFragment') {
        walk(sel.selectionSet, depth, stack);
      } else if (sel.kind === 'FragmentSpread') {
        if (stack.has(sel.name.value)) continue;
        const frag = fragments.get(sel.name.value);
        if (!frag) continue;
        stack.add(sel.name.value);
        walk(frag.selectionSet, depth, stack);
        stack.delete(sel.name.value);
      }
    }
  };

  for (const def of document.definitions) {
    if (def.kind !== 'OperationDefinition') continue;
    const roots = def.selectionSet.selections
      .filter((sel) => sel.kind === 'Field')
      .map((sel) => sel.name.value);
    if (roots.length && roots.every((name) => name.startsWith('__'))) {
      introspection = true;
      continue;
    }
    walk(def.selectionSet, 1, new Set());
  }

  return {
    maxDepth,
    fields,
    introspection,
    tooDeep: !introspection && maxDepth > LIMITS.maxDepth,
    tooWide: !introspection && fields > LIMITS.maxFields,
    limits: LIMITS,
  };
}

export function createRateLimiter({ capacity = 40, refillPerSec = 12 } = {}) {
  const buckets = new Map();
  let rejected = 0;
  return {
    capacity,
    refillPerSec,
    get rejected() { return rejected; },
    take(key) {
      const now = Date.now();
      const bucket = buckets.get(key) || { tokens: capacity, ts: now };
      const elapsed = (now - bucket.ts) / 1000;
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerSec);
      bucket.ts = now;
      if (bucket.tokens < 1) {
        buckets.set(key, bucket);
        rejected += 1;
        return false;
      }
      bucket.tokens -= 1;
      buckets.set(key, bucket);
      return true;
    },
  };
}

export function createInflight(max = 24) {
  let current = 0;
  let rejected = 0;
  return {
    max,
    get current() { return current; },
    get rejected() { return rejected; },
    tryEnter() {
      if (current >= max) {
        rejected += 1;
        return false;
      }
      current += 1;
      return true;
    },
    leave() {
      current = Math.max(0, current - 1);
    },
  };
}
