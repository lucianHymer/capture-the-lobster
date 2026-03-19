// Capture the Lobster — Server entry point
import { GameServer } from './api.js';

// Catch unhandled errors so the server stays up
process.on('uncaughtException', (err) => {
  console.error('[CRASH] Uncaught exception:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRASH] Unhandled rejection:', reason);
});

const port = Number(process.env.PORT) || 3000;
const server = new GameServer();
server.listen(port);
