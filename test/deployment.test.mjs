import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const harness = `
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {Store} from './src/store.mjs';
import {requestHandler} from './src/server.mjs';
const directory=mkdtempSync(join(tmpdir(),'screens-deployment-'));
const store=new Store(directory);
const port=Number(process.env.TEST_EXPECTED_PORT);
const handler=requestHandler(store,()=>port);
const paths=[];
globalThis.fetch=async (address,options={})=>{
  const url=new URL(address);
  assert.equal(url.origin,'http://127.0.0.1:'+port);
  paths.push(url.pathname);
  const request=Readable.from([Buffer.from(options.body || '')]);
  Object.assign(request,{url:url.pathname,method:options.method || 'GET',headers:{host:url.host,...Object.fromEntries(new Headers(options.headers).entries())}});
  const response={status:200,setHeader(){},writeHead(status){this.status=status},end(body){this.body=body}};
  await handler(request,response);
  return {ok:response.status<400,status:response.status,json:async()=>JSON.parse(response.body)};
};
try {
  process.argv[2]='write';
  await import('./scripts/smoke-deployment.mjs?write');
  process.argv[2]='read';
  await import('./scripts/smoke-deployment.mjs?read');
  assert.equal(store.projects().some(p=>p.id==='deployment-check'),true);
  assert.deepEqual(paths,['/api/health','/api/projects','/api/projects','/mcp','/api/health','/api/projects','/mcp']);
} finally {store.close();rmSync(directory,{recursive:true,force:true});}
`;
for(const scenario of [
  {name:'container PORT',PORT:'4900',SCREENS_PORT:'',expected:'4900'},
  {name:'host compose port',PORT:'',SCREENS_PORT:'4900',expected:'4900'},
  {name:'service port takes precedence',PORT:'4901',SCREENS_PORT:'4900',expected:'4901'},
  {name:'default port',PORT:'',SCREENS_PORT:'',expected:'4800'},
]) {
  test(`deployment smoke check uses ${scenario.name} for HTTP and MCP`,()=>{
    const result=spawnSync(process.execPath,['--input-type=module','-e',harness],{
      env:{...process.env,PORT:scenario.PORT,SCREENS_PORT:scenario.SCREENS_PORT,TEST_EXPECTED_PORT:scenario.expected},encoding:'utf8',timeout:15000,
    });
    assert.equal(result.status,0,result.error?.message || result.stderr);
    assert.match(result.stdout,/registry persistence smoke check passed/);
  });
}
