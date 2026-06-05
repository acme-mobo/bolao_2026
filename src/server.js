import http from 'node:http';
import { config } from './config.js';
import { asyncHandler } from './http.js';
import { createRouter } from './routes.js';
import { store } from './store.js';

const router = createRouter(store);
const server = http.createServer(asyncHandler(router));

server.listen(config.port, () => {
  store.load().catch((error) => {
    console.error('Falha ao carregar store', error);
    process.exitCode = 1;
  });
  console.log(`Bolao26 API listening on http://localhost:${config.port}`);
});
