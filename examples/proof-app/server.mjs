import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('./index.html',import.meta.url));
createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end(html);}).listen(Number(process.env.SCREENS_CAPTURE_PORT || 4901),'127.0.0.1');
