import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const ports = {
  gateway: 4000,
  catalog: 4001,
  artists: 4002,
  reviews: 4003,
  platform: 4004,
  client: 5173,
};
