const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');
const path = require('path');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// Helper function to set cache headers for model files
const setModelFileHeaders = (req, res) => {
  // Cache for 1 week (604800 seconds)
  res.setHeader('Cache-Control', 'public, max-age=604800, must-revalidate');
  res.setHeader('Vary', 'Accept-Encoding');
  // Set appropriate content type
  if (req.url.endsWith('.json')) {
    res.setHeader('Content-Type', 'application/json');
  } else if (req.url.endsWith('.bin')) {
    res.setHeader('Content-Type', 'application/octet-stream');
  }
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

// Helper to handle model file requests
const handleModelFile = (req, res) => {
  const filePath = path.join(process.cwd(), 'public', req.url);
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.end('File not found');
    return;
  }
  // Set headers
  setModelFileHeaders(req, res);
  // Handle OPTIONS request for CORS
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  // Stream the file
  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);
};

app.prepare().then(() => {
  createServer((req, res) => {
    const parsedUrl = parse(req.url, true);

    // Set security headers for service worker
    if (req.url === '/service-worker.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Service-Worker-Allowed', '/');
      // Important security headers
      res.setHeader('X-Content-Type-Options', 'nosniff');
      
      // In development, set appropriate CSP
      if (dev) {
        res.setHeader('Content-Security-Policy', "default-src 'self' http://localhost:3001");
      }
      
      const swPath = path.join(process.cwd(), 'public', 'service-worker.js');
      const swContent = fs.readFileSync(swPath, 'utf8');
      res.end(swContent);
      return;
    }

    // Set headers for model files
    if (req.url.startsWith('/graph_model_client/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }

    // Handle all other requests with Next.js
    handle(req, res, parsedUrl);
  }).listen(3001, '0.0.0.0', (err) => {
    if (err) throw err;
    console.log('> Ready on http://0.0.0.0:3001');
  });
});

// Add error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});