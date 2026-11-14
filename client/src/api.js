import { createClient } from 'graphql-ws';

let socket;

function wsClient() {
  if (!socket) {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = createClient({ url: `${protocol}://${location.host}/graphql` });
  }
  return socket;
}

export async function gql(query, variables) {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 200) || `HTTP ${response.status}`);
  }
  json.httpStatus = response.status;
  window.dispatchEvent(new CustomEvent('atlas-meta', {
    detail: { ...(json.extensions || {}), httpStatus: response.status },
  }));
  return json;
}

export function errorText(json) {
  if (!json?.errors?.length) return '';
  return json.errors.map((error) => error.message).join(' · ');
}

export function subscribe(query, onData) {
  return wsClient().subscribe({ query }, {
    next: (payload) => onData(payload?.data),
    error: () => {},
    complete: () => {},
  });
}

export function num(value) {
  return new Intl.NumberFormat('ru-RU').format(value ?? 0);
}
