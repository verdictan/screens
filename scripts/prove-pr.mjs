import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
import {Store} from '../src/store.mjs';
import {captureComparison,resolvePullRequest} from '../src/capture.mjs';
import {createDiff} from '../src/diff.mjs';
const context=await resolvePullRequest(process.env.GITHUB_REPOSITORY,process.env.SCREENS_PR_NUMBER);
const token=process.env.GITHUB_TOKEN;
delete process.env.GITHUB_TOKEN;
const store=new Store(resolve('test-results/pr-registry'));
try {
  const result=await captureComparison(store,{repo:resolve('.'),config:resolve('examples/picker.capture.json'),output:resolve('test-results/actual-pr'),context,execute:'yes'});
  if(token!==undefined)process.env.GITHUB_TOKEN=token;
  const latest=await resolvePullRequest(context.repository,context.number);
  if(latest.head!==context.head)throw Error('PR changed during proof capture');
  const comparison=store.compare(result.run.id);
  const measurements=[];
  for(const entry of comparison.entries)measurements.push(await createDiff(store,{left:entry.captures.current.id,right:entry.captures.pr.id,threshold:0}));
  writeFileSync('test-results/actual-pr/proof.json',JSON.stringify({source:context,run:result.run,measurements,scope:'Actual Screens PR, deterministic seeded registry, browser UI only. No approved design target was supplied.'},null,2));
  console.log(JSON.stringify({head:context.head,base:context.mergeBase,variants:comparison.entries.length,measurements:measurements.map(d=>({id:d.id,status:d.status,changedRatio:d.changedRatio}))}));
} finally {if(token!==undefined)process.env.GITHUB_TOKEN=token;store.close();}
