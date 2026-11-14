import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/use/ws';
import { gql } from 'graphql-tag';
import { GraphQLError } from 'graphql';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { ports, rootDir } from '../../shared/paths.js';
import { pollIterable } from '../../shared/live.js';
import { startSubgraph } from '../../shared/server.js';
import { listTraces } from '../../shared/traces.js';
import { ingestDb, ingestionStatus, recentEvents } from '../../shared/ingestStore.js';

const typeDefs = /* GraphQL */ `
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])

  type IngestionSource {
    source: String!
    status: String!
    fetched: Int!
    stored: Int!
    error: String
    updatedAt: String
  }

  type DataTotals {
    artworks: Int!
    artists: Int!
    reviews: Int!
  }

  type IngestionStatus {
    runId: ID
    status: String!
    startedAt: String
    finishedAt: String
    message: String
    sources: [IngestionSource!]!
    totals: DataTotals!
  }

  input IngestLimitsInput {
    aicPages: Int
    perMuseum: Int
    force: Boolean
  }

  type ServiceStatus {
    name: String!
    status: String!
    uptimeSeconds: Int
    requests: Int
    errors: Int
    p95Ms: Float
    circuit: String
    detail: String
  }

  type TraceSpan {
    service: String!
    durationMs: Int
    ok: Boolean!
    error: String
  }

  type TraceEntry {
    id: ID!
    operation: String!
    durationMs: Int!
    status: String!
    services: [String!]!
    spans: [TraceSpan!]!
    error: String
    createdAt: String!
  }

  type RateLimitInfo {
    capacity: Int!
    refillPerSec: Float!
    rejected: Int!
    inflight: Int!
    maxInflight: Int!
    inflightRejected: Int!
  }

  type Observability {
    services: [ServiceStatus!]!
    traces(limit: Int = 30): [TraceEntry!]!
    rateLimit: RateLimitInfo!
    generatedAt: String!
  }

  type Query {
    ingestion: IngestionStatus!
    observability: Observability!
  }

  type Mutation {
    startIngestion(limits: IngestLimitsInput): IngestionStatus!
    resetCircuit(service: String!): Boolean!
  }
`;

let child = null;

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function reconcileRun() {
  const status = ingestionStatus();
  if (status.status !== 'running') return status;
  const row = ingestDb().prepare('SELECT pid FROM runs WHERE id = ?').get(status.runId);
  const alive = (child && child.exitCode === null) || pidAlive(row?.pid);
  if (!alive) {
    ingestDb().prepare(`
      UPDATE runs SET status = 'failed', finished_at = ?, message = ? WHERE id = ?
    `).run(new Date().toISOString(), 'Процесс сбора завершился аварийно', status.runId);
  }
  return ingestionStatus();
}

function startIngestion(limits = {}) {
  const current = reconcileRun();
  if (current.status === 'running') return current;
  const aicPages = clamp(limits.aicPages, 1, 150, 100);
  const perMuseum = clamp(limits.perMuseum, 100, 6000, 4000);
  const args = [
    '--disable-warning=ExperimentalWarning',
    'ingest/run.js',
    '--aic-pages', String(aicPages),
    '--per-museum', String(perMuseum),
  ];
  if (limits.force) args.push('--force');
  child = spawn(process.execPath, args, { cwd: rootDir, stdio: 'inherit' });
  child.on('exit', () => { child = null; });
  return ingestionStatus();
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function observability() {
  const targets = [
    ['gateway', ports.gateway],
    ['catalog', ports.catalog],
    ['artists', ports.artists],
    ['reviews', ports.reviews],
    ['platform', ports.platform],
  ];
  let control = null;
  try {
    control = await readJson(`http://127.0.0.1:${ports.gateway}/control`);
  } catch {
    control = null;
  }
  const services = await Promise.all(targets.map(async ([name, port]) => {
    try {
      const health = await readJson(`http://127.0.0.1:${port}/health`);
      return {
        name,
        status: health.status || 'ok',
        uptimeSeconds: health.uptime ?? null,
        requests: health.metrics?.requests ?? 0,
        errors: health.metrics?.errors ?? 0,
        p95Ms: health.metrics?.p95Ms ?? 0,
        circuit: control?.circuits?.[name]?.state || null,
        detail: health.records ? JSON.stringify(health.records) : null,
      };
    } catch (error) {
      return {
        name,
        status: 'down',
        uptimeSeconds: null,
        requests: 0,
        errors: 0,
        p95Ms: null,
        circuit: control?.circuits?.[name]?.state || null,
        detail: error.message,
      };
    }
  }));
  const rate = control?.rateLimit || {};
  const inflight = control?.inflight || {};
  return {
    services,
    rateLimit: {
      capacity: rate.capacity ?? 0,
      refillPerSec: rate.refillPerSec ?? 0,
      rejected: rate.rejected ?? 0,
      inflight: inflight.current ?? 0,
      maxInflight: inflight.max ?? 0,
      inflightRejected: inflight.rejected ?? 0,
    },
    generatedAt: new Date().toISOString(),
  };
}

async function resetCircuit(_root, { service }) {
  const response = await fetch(`http://127.0.0.1:${ports.gateway}/control/reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ service }),
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) {
    throw new GraphQLError('Не удалось сбросить предохранитель', { extensions: { code: 'BAD_GATEWAY' } });
  }
  return true;
}

const resolvers = {
  Query: {
    ingestion: () => reconcileRun(),
    observability,
  },
  Mutation: {
    startIngestion: (_root, { limits }) => startIngestion(limits || {}),
    resetCircuit,
  },
  Observability: {
    traces: (_parent, args) => listTraces(args.limit || 30),
  },
};

const { httpServer } = await startSubgraph({
  name: 'platform',
  port: ports.platform,
  typeDefs,
  resolvers,
  health: () => ({ records: reconcileRun().totals }),
});

const liveSchema = buildSubgraphSchema([{
  typeDefs: gql`
    type IngestionEvent {
      seq: Int!
      source: String!
      level: String!
      message: String!
      fetched: Int
      createdAt: String!
    }
    type Query { _live: String }
    type Subscription { ingestionProgress: IngestionEvent! }
  `,
  resolvers: {
    Query: { _live: () => 'ok' },
    Subscription: {
      ingestionProgress: {
        subscribe: () => {
          let last = 0;
          return pollIterable(() => {
            const rows = recentEvents(last, 50);
            if (rows.length) last = rows[rows.length - 1].seq;
            return rows.map((row) => ({
              ingestionProgress: {
                seq: row.seq,
                source: row.source,
                level: row.level,
                message: row.message,
                fetched: row.fetched,
                createdAt: row.created_at,
              },
            }));
          }, 700);
        },
      },
    },
  },
}]);

useServer({ schema: liveSchema }, new WebSocketServer({ server: httpServer, path: '/ws' }));

process.on('SIGTERM', () => {
  if (child && child.exitCode === null) child.kill();
});
