// Capture the Lobster — Server entry point
import { GameServer } from './api.js';

const port = Number(process.env.PORT) || 3000;
const server = new GameServer();
server.listen(port);
