import http from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloGateway, IntrospectAndCompose, RemoteGraphQLDataSource } from '@apollo/gateway';
import { GraphQLError, parse } from 'graphql';
import { ports } from '../shared/ports.js';
import { log } from '../shared/logger.js';
import { createMetrics } from '../shared/metrics.js';
import { createCircuitBreaker } from '../shared/circuit.js';
import { createInflight, createRateLimiter, measureDocument } from '../shared/guard.js';
import { recordTrace } from '../shared/traces.js';
import { attachGatewaySockets } from './ws.js';
import { attachMedia } from './media.js';

const metrics = createMetrics();
const limiter = createRateLimiter({ capacity: 40, refillPerSec: 12 });
const inflight = createInflight(24);
const circuits = new Map(
  ['catalog', 'artists', 'reviews', 'platform'].map((name) => [name, createCircuitBreaker()]),
);

class TracedSource extends RemoteGraphQLDataSource {
  constructor({ url, name }) {
    super({ url });
    this.serviceName = name;
    this.breaker = circuits.get(name);
    this.fetcher = (input, init = {}) => fetch(input, {
      ...init,
      signal: AbortSignal.timeout(8000),
    });
  }

  async willSendRequest({ request, context }) {
    if (this.breaker && !this.breaker.canRequest()) {
      throw new GraphQLError(`Подграф «${this.serviceName}» временно отключён предохранителем`, {
        extensions: { code: 'CIRCUIT_OPEN', service: this.serviceName },
      });
    }
    request.http?.headers.set('x-trace-id', context.traceId || '');
    context.services?.add(this.serviceName);
    context.spanStarts?.set(this.serviceName, Date.now());
  }

  async didReceiveResponse({ response, context }) {
    this.breaker?.success();
    const started = context.spanStarts?.get(this.serviceName);
    context.spans?.push({
      service: this.serviceName,
      durationMs: started ? Date.now() - started : null,
      ok: !response.errors?.length,
      error: response.errors?.[0]?.message || null,
    });
    return response;
  }

  didEncounterError(error, _fetchRequest, _fetchResponse, context) {
    this.breaker?.failure();
    context?.services?.add(this.serviceName);
    context?.spans?.push({
      service: this.serviceName,
      durationMs: null,
      ok: false,
      error: error.message,
    });
  }
}

const gateway = new ApolloGateway({
  supergraphSdl: new IntrospectAndCompose({
    pollIntervalInMs: 10000,
    subgraphs: [
      { name: 'catalog', url: `http://127.0.0.1:${ports.catalog}/graphql` },
      { name: 'artists', url: `http://127.0.0.1:${ports.artists}/graphql` },
      { name: 'reviews', url: `http://127.0.0.1:${ports.reviews}/graphql` },
      { name: 'platform', url: `http://127.0.0.1:${ports.platform}/graphql` },
    ],
  }),
  buildService({ name, url }) {
    return new TracedSource({ url, name });
  },
});

const server = new ApolloServer({
  gateway,
  introspection: true,
  includeStacktraceInErrorResponses: false,
  plugins: [{
    async requestDidStart(requestContext) {
      const started = Date.now();
      metrics.incRequests();
      return {
        async didResolveOperation(ctx) {
          const score = measureDocument(ctx.document);
          if (score.tooDeep || score.tooWide) {
            throw new GraphQLError(
              `Запрос отклонён ограничителем: глубина ${score.maxDepth} (макс. ${score.limits.maxDepth}), полей ${score.fields} (макс. ${score.limits.maxFields})`,
              { extensions: { code: 'QUERY_TOO_COMPLEX', maxDepth: score.maxDepth, fields: score.fields } },
            );
          }
        },
        async didEncounterErrors() {
          metrics.incErrors();
        },
        async willSendResponse(ctx) {
          const durationMs = Date.now() - started;
          metrics.observe(durationMs);
          const body = ctx.response.body;
          if (body.kind !== 'single') return;
          const result = body.singleResult;
          const status = result.errors?.length ? (result.data ? 'partial' : 'error') : 'ok';
          const traceId = ctx.contextValue.traceId;
          result.extensions = {
            ...(result.extensions || {}),
            traceId,
            durationMs,
            services: [...(ctx.contextValue.services || [])],
          };
          const error = result.errors?.[0]?.message || null;
          recordTrace({
            id: traceId,
            operation: operationLabel(ctx),
            durationMs,
            status,
            services: [...(ctx.contextValue.services || [])],
            spans: ctx.contextValue.spans || [],
            error,
          });
          log('gateway', status === 'ok' ? 'info' : 'error', operationLabel(ctx), { traceId, durationMs, status });
        },
      };
    },
  }],
});

await server.start();

const app = express();
app.disable('x-powered-by');
app.use(cors());
attachMedia(app);
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({
    service: 'gateway',
    status: 'ok',
    uptime: Math.round(process.uptime()),
    metrics: metrics.snapshot(),
  });
});

app.get('/control', (_req, res) => {
  res.json({
    rateLimit: { capacity: limiter.capacity, refillPerSec: limiter.refillPerSec, rejected: limiter.rejected },
    inflight: { current: inflight.current, max: inflight.max, rejected: inflight.rejected },
    circuits: Object.fromEntries([...circuits].map(([name, breaker]) => [name, breaker.snapshot()])),
  });
});

app.post('/control/reset', (req, res) => {
  const breaker = circuits.get(req.body?.service);
  if (!breaker) {
    res.status(404).json({ ok: false });
    return;
  }
  breaker.reset();
  res.json({ ok: true, circuit: breaker.snapshot() });
});

app.use('/graphql', (req, res, next) => {
  if (req.method !== 'POST') {
    next();
    return;
  }
  const key = req.socket.remoteAddress || 'local';
  if (!limiter.take(key)) {
    reject(res, 429, 'Превышен лимит запросов к шлюзу', 'RATE_LIMITED');
    return;
  }
  if (!inflight.tryEnter()) {
    reject(res, 503, 'Шлюз перегружен, повторите запрос', 'OVERLOADED');
    return;
  }
  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    inflight.leave();
  };
  res.on('finish', leave);
  res.on('close', leave);
  if (typeof req.body?.query === 'string') {
    try {
      const score = measureDocument(parse(req.body.query));
      if (score.tooDeep || score.tooWide) {
        reject(
          res,
          400,
          `Запрос отклонён ограничителем: глубина ${score.maxDepth} (макс. ${score.limits.maxDepth}), полей ${score.fields} (макс. ${score.limits.maxFields})`,
          'QUERY_TOO_COMPLEX',
        );
        return;
      }
    } catch {
      /* синтаксическую ошибку сформулирует Apollo */
    }
  }
  next();
});

app.use('/graphql', expressMiddleware(server, {
  context: async ({ req }) => ({
    traceId: req.header('x-trace-id') || randomUUID(),
    services: new Set(),
    spans: [],
    spanStarts: new Map(),
  }),
}));

const httpServer = http.createServer(app);
attachGatewaySockets(httpServer);
await new Promise((resolve, reject) => {
  httpServer.once('error', reject);
  httpServer.listen(ports.gateway, resolve);
});
log('gateway', 'info', 'gateway listening', { port: ports.gateway });

function reject(res, status, message, code) {
  recordTrace({
    id: randomUUID(),
    operation: 'rejected',
    durationMs: 0,
    status: code.toLowerCase(),
    services: [],
    spans: [],
    error: message,
  });
  res.status(status).json({ errors: [{ message, extensions: { code } }] });
}

function operationLabel(ctx) {
  if (ctx.request.operationName) return ctx.request.operationName;
  const operation = ctx.document?.definitions?.find((def) => def.kind === 'OperationDefinition');
  const field = operation?.selectionSet?.selections?.find((sel) => sel.kind === 'Field');
  return field?.name?.value || operation?.operation || 'anonymous';
}
