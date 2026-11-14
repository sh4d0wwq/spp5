import { parse } from 'graphql';
import { createClient } from 'graphql-ws';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { ports } from '../shared/ports.js';

const ROUTES = {
  reviewCreated: `ws://127.0.0.1:${ports.reviews}/ws`,
  ingestionProgress: `ws://127.0.0.1:${ports.platform}/ws`,
};

export function attachGatewaySockets(httpServer) {
  const upstream = new Map();
  const wss = new WebSocketServer({ server: httpServer, path: '/graphql' });

  const clientFor = (url) => {
    if (!upstream.has(url)) {
      upstream.set(url, createClient({
        url,
        webSocketImpl: WebSocket,
        lazy: true,
        retryAttempts: 2,
        connectionAckWaitTimeout: 4000,
      }));
    }
    return upstream.get(url);
  };

  wss.on('connection', (socket) => {
    const subscriptions = new Map();
    const send = (message) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };

    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        socket.close(4400, 'invalid json');
        return;
      }
      if (message.type === 'connection_init') {
        send({ type: 'connection_ack' });
        return;
      }
      if (message.type === 'ping') {
        send({ type: 'pong', payload: message.payload });
        return;
      }
      if (message.type === 'complete') {
        subscriptions.get(message.id)?.();
        subscriptions.delete(message.id);
        return;
      }
      if (message.type !== 'subscribe') return;
      try {
        const field = rootField(message.payload?.query || '');
        const url = ROUTES[field];
        if (!url) throw new Error(`Подписка «${field}» не поддерживается шлюзом`);
        const dispose = clientFor(url).subscribe({
          query: message.payload.query,
          variables: message.payload.variables,
          operationName: message.payload.operationName,
        }, {
          next: (payload) => send({ type: 'next', id: message.id, payload }),
          error: (error) => send({
            type: 'error',
            id: message.id,
            payload: [{ message: errorText(error) }],
          }),
          complete: () => send({ type: 'complete', id: message.id }),
        });
        subscriptions.set(message.id, dispose);
      } catch (error) {
        send({ type: 'error', id: message.id, payload: [{ message: error.message }] });
        send({ type: 'complete', id: message.id });
      }
    });

    socket.on('close', () => {
      for (const dispose of subscriptions.values()) dispose();
      subscriptions.clear();
    });
  });
}

function rootField(query) {
  const document = parse(query);
  const operation = document.definitions.find((def) => def.kind === 'OperationDefinition');
  if (!operation || operation.operation !== 'subscription') {
    throw new Error('Ожидалась операция subscription');
  }
  const fields = operation.selectionSet.selections.filter((sel) => sel.kind === 'Field');
  if (fields.length !== 1) throw new Error('В одной подписке нужно одно корневое поле');
  return fields[0].name.value;
}

function errorText(error) {
  if (Array.isArray(error)) return error.map((item) => item.message || String(item)).join('; ');
  return error?.message || String(error);
}
