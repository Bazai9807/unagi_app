const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../shared/www');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
http.createServer((req,res)=>{
  const url = new URL(req.url,'http://localhost');
  let pathname;
  try {pathname=decodeURIComponent(url.pathname);} catch {res.writeHead(400).end();return;}
  const target = path.resolve(root, '.' + (pathname==='/'?'/index.html':pathname));
  if(!target.startsWith(root + path.sep)){res.writeHead(403).end();return;}
  fs.readFile(target,(error,data)=>{
    if(error){res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(data);
  });
}).listen(4173,'127.0.0.1',()=>console.log('Unagi preview: http://127.0.0.1:4173'));
