import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DEFAULTS, LightingController, validateSettings } from './lighting.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8'],
  '/device.svg': ['public/device.svg', 'image/svg+xml'],
  '/vendor/lucide.js': ['node_modules/lucide/dist/umd/lucide.js', 'text/javascript; charset=utf-8']
};

export async function createApplication({ controller, dataDir = path.join(root, 'data') }) {
  let settings = structuredClone(DEFAULTS);
  let warning = null;
  try {
    const saved = JSON.parse(await readFile(path.join(dataDir, 'settings.json'), 'utf8'));
    settings = { keyboard: validateSettings('keyboard', saved.keyboard), slash: validateSettings('slash', saved.slash) };
  } catch (error) {
    if (error.code !== 'ENOENT') warning = 'Saved settings could not be read; defaults loaded without applying to hardware.';
  }
  const token = randomBytes(32).toString('hex');
  const appliedAt = { keyboard: null, slash: null };
  const events = [];
  let queue = Promise.resolve();
  const record = (target, status, message) => {
    events.unshift({ target, status, message, time: new Date().toISOString() });
    events.splice(20);
  };
  const json = (response, status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  };

  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const address = server.address();
      const expectedHost = `127.0.0.1:${address.port}`;
      const origin = `http://${expectedHost}`;
      if (request.headers.host !== expectedHost || (request.headers.origin && request.headers.origin !== origin) || ['cross-site', 'same-site'].includes(request.headers['sec-fetch-site'])) {
        return json(response, 403, { error: 'Only same-origin local requests are allowed' });
      }
      const pathname = new URL(request.url, origin).pathname;
      if (request.method === 'GET' && pathname === '/api/state') {
        let device;
        try { device = await controller.inspect(); }
        catch (error) { device = { keyboard: false, slash: false, error: error.message }; }
        return json(response, 200, { settings, device, appliedAt, events, warning, token });
      }
      if (request.method === 'POST' && pathname.startsWith('/api/apply/')) {
        if (request.headers.origin !== origin || request.headers['x-control-token'] !== token) return json(response, 403, { error: 'Invalid control token or origin; refresh the page' });
        if (request.headers['content-type'] !== 'application/json') return json(response, 415, { error: 'JSON content type required' });
        const target = pathname.slice('/api/apply/'.length);
        let body = '';
        for await (const chunk of request) {
          body += chunk.toString('utf8');
          if (Buffer.byteLength(body) > 8192) return json(response, 413, { error: 'Request too large' });
        }
        let input;
        try { input = validateSettings(target, JSON.parse(body)); }
        catch (error) { return json(response, 400, { error: error.message }); }
        const operation = queue.then(async () => {
          try {
            await controller.apply(target, input);
          } catch (error) {
            record(target, 'error', error.message);
            throw error;
          }
          settings[target] = input;
          appliedAt[target] = new Date().toISOString();
          record(target, 'success', 'Applied');
          try {
            await mkdir(dataDir, { recursive: true });
            const temporary = path.join(dataDir, 'settings.json.tmp');
            await writeFile(temporary, JSON.stringify(settings, null, 2) + '\n', 'utf8');
            await rename(temporary, path.join(dataDir, 'settings.json'));
            warning = null;
          } catch {
            warning = 'Lighting applied, but settings could not be saved to disk.';
          }
          return { settings: input, appliedAt: appliedAt[target], warning };
        });
        queue = operation.catch(() => {});
        return json(response, 200, await operation);
      }
      if (request.method === 'GET' && Object.hasOwn(assets, pathname)) {
        const [filename, contentType] = assets[pathname];
        const content = await readFile(path.join(root, filename));
        response.writeHead(200, { 'Content-Type': contentType });
        return response.end(content);
      }
      return json(response, 404, { error: 'Not found' });
    } catch (error) {
      if (!response.headersSent) json(response, error.statusCode || 500, { error: error.message || 'Operation failed' });
      else response.end();
    }
  });
  server.requestTimeout = 15000;
  return server;
}

async function start() {
  const hid = (await import('node-hid')).default;
  const server = await createApplication({ controller: new LightingController(hid) });
  const firstPort = Number(process.env.PORT || 3210);
  if (!Number.isInteger(firstPort) || firstPort < 1024 || firstPort > 65525) throw new Error('PORT must be between 1024 and 65525');
  for (let port = firstPort; port < firstPort + 10; port++) {
    try {
      await new Promise((resolve, reject) => {
        const onError = error => { server.off('listening', onListen); reject(error); };
        const onListen = () => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListen);
        server.listen(port, '127.0.0.1');
      });
      const url = `http://127.0.0.1:${port}`;
      console.log(`ASUS Light: ${url}\nLocal access only. Startup does not change lighting. Ctrl+C to stop.`);
      if (process.argv.includes('--open')) {
        const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' });
        browser.on('error', error => console.error(`Open ${url} manually: ${error.message}`));
        browser.unref();
      }
      const shutdown = () => { server.close(() => process.exit(0)); };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
      return;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('No available port in the requested range');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  start().catch(error => { console.error(error.message); process.exitCode = 1; });
}