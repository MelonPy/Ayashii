// Serveur de développement : sert le site + un mini relais compatible ntfy
// (POST /relay/<topic>, GET /relay/<topic>/sse?since=all|<id>), en mémoire.
//
//   node tools/dev-server.mjs            → http://localhost:8787/?relay=http://localhost:8787/relay

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT || 8787);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
};

const topics = new Map(); // topic → { messages: [], clients: Set<res> }
const topicOf = name => {
  if (!topics.has(name)) topics.set(name, { messages: [], clients: new Set() });
  return topics.get(name);
};

const cors = { 'Access-Control-Allow-Origin': '*' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const relay = url.pathname.match(/^\/relay\/([-_A-Za-z0-9]{1,64})(\/sse)?$/);

  if (relay && req.method === 'POST' && !relay[2]) {
    let body = '';
    for await (const chunk of req) body += chunk;
    const topic = topicOf(relay[1]);
    const msg = {
      id: randomBytes(6).toString('hex'),
      time: Math.floor(Date.now() / 1000),
      event: 'message',
      topic: relay[1],
      message: body,
    };
    topic.messages.push(msg);
    for (const client of topic.clients) client.write(`data: ${JSON.stringify(msg)}\n\n`);
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(msg));
  }

  if (relay && req.method === 'GET' && relay[2]) {
    const topic = topicOf(relay[1]);
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(`event: open\ndata: ${JSON.stringify({ event: 'open', topic: relay[1] })}\n\n`);
    const since = url.searchParams.get('since');
    let backlog = [];
    if (since === 'all') backlog = topic.messages;
    else if (since) backlog = topic.messages.slice(topic.messages.findIndex(m => m.id === since) + 1);
    for (const msg of backlog) res.write(`data: ${JSON.stringify(msg)}\n\n`);
    topic.clients.add(res);
    req.on('close', () => topic.clients.delete(res));
    return;
  }

  const path = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!path.startsWith(root)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    const file = path.endsWith('/') ? join(path, 'index.html') : path;
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(port, () => {
  console.log(`http://localhost:${port}/?relay=http://localhost:${port}/relay`);
});
