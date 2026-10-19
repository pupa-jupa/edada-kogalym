import fs from 'node:fs';
import path from 'node:path';
// Admin verification helper. Never accepts credentials via argv or files.
const terminal=process.stdin.isTTY;
if(terminal)process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stderr.write('Ready for service request JSON on stdin (input is hidden).\n');
const input=await new Promise((resolve,reject)=>{let value='';const onData=chunk=>{value+=chunk;if(value.includes('\u0003'))reject(new Error('Cancelled'));if(value.length>500000)reject(new Error('Input too large'));if(value.includes('\n')||value.includes('\r')){process.stdin.off('data',onData);process.stdin.pause();resolve(value);}};process.stdin.on('data',onData);process.stdin.resume();});
if(terminal)process.stdin.setRawMode(false);
const {url,token,body,batchPath,exportPath,resultPath,compact}=JSON.parse(input);
const target=new URL(url);
if(target.origin!=='https://eda-da-kogalym.social-grape-1472.chatgpt.site'||!['/api/refresh-service','/api/catalog-service','/api/enrichment-service','/api/recipe-service'].includes(target.pathname))throw new Error('Only this project catalog writers are allowed');
if(typeof token!=='string'||!token)throw new Error('Missing service access');
let requests=[body??{}];
if(exportPath){
  const resolved=path.resolve(exportPath);const root=fs.realpathSync('D:/projects/edada/work')+path.sep;
  if(!resolved.startsWith(root)||!resolved.endsWith('.json')||fs.realpathSync(path.dirname(resolved))!==root.slice(0,-1)||target.pathname!=='/api/catalog-service')throw new Error('Only a product-only export within the task work directory is allowed');
  const listings=[];let offset=0;
  do{const r=await fetch(target,{method:'POST',headers:{'OAI-Sites-Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({operation:'export',offset,limit:75}),redirect:'error'});if(!r.ok)throw new Error('Catalog export HTTP '+r.status);const result=await r.json();if(!Array.isArray(result.listings))throw new Error('Invalid product-only export');listings.push(...result.listings);offset=result.nextOffset;if(listings.length>5000)throw new Error('Export limit');}while(offset!==null);
  fs.writeFileSync(resolved,JSON.stringify(listings,null,2));process.stdout.write(JSON.stringify({exported:listings.length,path:resolved})+'\n');process.exit(0);
}
if(batchPath){const resolved=fs.realpathSync(batchPath);const root=path.resolve('D:/projects/edada/work')+path.sep;if(!resolved.startsWith(root)||!resolved.endsWith('.json')||fs.statSync(resolved).size>4000000)throw new Error('Only a bounded non-secret catalog batch in the task work directory is allowed');requests=JSON.parse(fs.readFileSync(resolved,'utf8'));if(!Array.isArray(requests)||requests.length>100)throw new Error('Invalid batch');}
for(let i=0;i<requests.length;i++){
  const response=await fetch(target,{method:'POST',headers:{'OAI-Sites-Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(requests[i]),redirect:'error',signal:AbortSignal.timeout(180000)});
  const value=await response.text();const result=response.headers.get('content-type')?.includes('json')?JSON.parse(value):'Non-JSON response';
  if(resultPath){const resolved=path.resolve(resultPath);const root=fs.realpathSync('D:/projects/edada/work')+path.sep;if(!resolved.startsWith(root)||!resolved.endsWith('.json')||fs.realpathSync(path.dirname(resolved))!==root.slice(0,-1))throw new Error('Only a product service result in the task work directory is allowed');fs.writeFileSync(resolved,JSON.stringify(result,null,2));}
  process.stdout.write(JSON.stringify({request:i+1,status:response.status,result:compact?{summary:result.summary,bulk:result.bulk,checked:result.checked,matched:result.matched,cached:result.cached,complete:result.complete,busy:result.busy,error:result.error,eligibleFoods:result.eligibleFoods,coveredFoods:result.coveredFoods,generatedRecipes:result.generatedRecipes,pendingFoods:result.pendingFoods,needsReview:result.needsReview,dailyUsed:result.dailyUsed,dailyLimit:result.dailyLimit,message:result.message}:result})+'\n');if(!response.ok){process.exitCode=1;break;}
  if(requests[i]?.operation==='fill'&&(result.error||result.complete||result.busy||result.configured===false)){if(result.error)process.exitCode=1;break;}
}
