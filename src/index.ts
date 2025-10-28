#!/usr/bin/env node

import { TemporalGraphServer } from './mcp/server.js';

// Get database path from environment or use default
const dbPath = process.env.DB_PATH || 'graph.db';

console.error(`Starting Temporal Graph MCP Server v0.1.0`);
console.error(`Database: ${dbPath}`);

const server = new TemporalGraphServer(dbPath);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('\nShutting down...');
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('\nShutting down...');
  server.close();
  process.exit(0);
});

// Start server
server.run().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
