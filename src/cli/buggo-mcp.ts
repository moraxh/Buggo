#!/usr/bin/env node
import { runBuggoMcpServer } from '../interfaces/mcp/server.js';

runBuggoMcpServer().catch((err) => {
  console.error('Buggo MCP server failed:', err);
  process.exit(1);
});
