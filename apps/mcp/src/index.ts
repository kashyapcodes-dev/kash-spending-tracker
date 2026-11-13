// @kash/app-mcp - MCP server stub
import { createServer } from 'http';
import { createInterface } from 'readline';

const handlers = {
  handleHealth: () => ({ status: 'ok', service: '@kash/app-mcp' }),
};

async function main() {
  const server = createServer((req, res) => {
    res.writeHead(200);
    res.end(JSON.stringify(handlers.handleHealth()));
  });
  server.listen(3001, () => console.log('MCP server running on port 3001'));
}

main();
