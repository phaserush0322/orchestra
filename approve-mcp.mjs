// A tiny MCP server (stdio, JSON-RPC) that the chat agent uses as its permission prompt.
// When Claude wants to run a command or change a file, it calls `approve`; this asks the user in the
// Orchestra app and waits for their answer. Started by the claude CLI through --mcp-config.
import { createInterface } from 'node:readline';
import http from 'node:http';

const { ORCHESTRA_URL, ORCHESTRA_TOKEN, ORCHESTRA_CHAT } = process.env;
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');

// Plain http (no fetch): the user may take minutes to answer, and fetch would time out.
function ask(body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(`${ORCHESTRA_URL}/internal/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'x-orchestra-token': ORCHESTRA_TOKEN },
    }, (res) => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({ allow: false, message: 'Orchestra gave no answer.' }); } });
    });
    req.on('error', e => resolve({ allow: false, message: `Orchestra could not ask the user: ${e.message}` }));
    req.end(data);
  });
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === 'initialize')
    return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} },
      serverInfo: { name: 'orchestra', version: '1.0.0' } } });
  if (m.method === 'tools/list')
    return send({ jsonrpc: '2.0', id: m.id, result: { tools: [{
      name: 'approve', description: 'Asks the user in the Orchestra app to allow or deny a tool call.',
      inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] },
    }] } });
  if (m.method === 'tools/call') {
    const a = m.params?.arguments ?? {};
    const d = await ask({ chat: ORCHESTRA_CHAT, tool: a.tool_name, input: a.input ?? {} });
    const out = d.allow ? { behavior: 'allow', updatedInput: a.input ?? {} } : { behavior: 'deny', message: d.message || 'The user denied this action.' };
    return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(out) }] } });
  }
  if (m.id !== undefined && m.method) send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
});
