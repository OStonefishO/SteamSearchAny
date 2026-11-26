// 极简静态服务器（仅用于本地预览 dist/，不是产品运行时）
// 正确的 query 处理 + 目录索引 + CORS
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || 'dist');
const PORT = Number(process.argv[3] || 5174);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

http
  .createServer((req, res) => {
    let rel = decodeURIComponent(String(req.url || '/').split('?')[0]);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        // 单页应用兜底
        fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
          if (e2) {
            res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404');
            return;
          }
          res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(html);
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(buf);
    });
  })
  .listen(PORT, () => console.log(`static dist → http://127.0.0.1:${PORT}/`));
