const { createServer } = require('https');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const httpsOptions = {
  key: fs.readFileSync('./192.168.1.108-key.pem'),
  cert: fs.readFileSync('./192.168.1.108.pem')
};

app.prepare().then(() => {
  createServer(httpsOptions, (req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(3001, '0.0.0.0', (err) => {
    if (err) throw err;
    console.log('> Ready on https://192.168.1.108:3001');
  });
});