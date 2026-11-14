import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { gql } from 'graphql-tag';
import { createMetrics } from './metrics.js';
import { log } from './logger.js';

export async function startSubgraph({ name, port, typeDefs, resolvers, context, health }) {
  const metrics = createMetrics();
  const startedAt = Date.now();
  const schema = buildSubgraphSchema([{ typeDefs: gql(typeDefs), resolvers }]);
  const apollo = new ApolloServer({
    schema,
    introspection: true,
    includeStacktraceInErrorResponses: false,
    plugins: [
      ApolloServerPluginLandingPageDisabled(),
      {
        async requestDidStart() {
          const t0 = performance.now();
          metrics.incRequests();
          return {
            async didEncounterErrors() {
              metrics.incErrors();
            },
            async willSendResponse() {
              metrics.observe(performance.now() - t0);
            },
          };
        },
      },
    ],
  });
  await apollo.start();

  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.get('/health', (_req, res) => {
    const extra = health?.() ?? {};
    res.json({
      service: name,
      status: 'ok',
      uptime: Math.round(process.uptime()),
      startedAt: new Date(startedAt).toISOString(),
      metrics: metrics.snapshot(),
      ...extra,
    });
  });
  app.get('/metrics', (_req, res) => {
    res.type('text/plain; version=0.0.4').send(metrics.prometheus(name));
  });
  app.use('/graphql', expressMiddleware(apollo, {
    context: async ({ req }) => ({
      traceId: req.header('x-trace-id') || '',
      ...(typeof context === 'function' ? context({ req }) : {}),
    }),
  }));

  const httpServer = http.createServer(app);
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, resolve);
  });
  log(name, 'info', 'subgraph listening', { port });
  return { httpServer, schema, metrics };
}
