export function log(service, level, message, extra = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    service,
    level,
    message,
    ...extra,
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}
