import fs from 'node:fs';
import path from 'node:path';
// Admin verification helper. Never accepts credentials via argv or files.
const terminal=process.stdin.isTTY;
if(terminal)process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stderr.write('Ready for service request JSON on stdin (input is hidden).\n');
const input=await new Promise((resolve,reject)=>{let value='';const onData=chunk=>{value+=chunk;if(value.includes('\u0003'))reject(new Error('Cancelled'));if(value.length>500000)reject(new Error('Input too large'));if(value.includes('\n')||value.includes('\r')){process.stdin.off('data',onData);process.stdin.pause();resolve(value);}};process.stdin.on('data',onData);process.stdin.resume();});
if(terminal)process.stdin.setRawMode(false);
const {url,token,body,batchPath}=JSON.parse(input);
const target=new URL(url);
if(target.origin!=='https://eda-da-kogalym.social-grape-1472.chatgpt.site'||!['/api/refresh-service','/api/catalog-service'].includes(target.pathname))throw new Error('Only this project catalog writers are allowed');
if(typeof token!=='string'||!token)throw new Error('Missing service access');
let requests=[body??{}];
if(batchPath){const resolved=fs.realpathSync(batchPath);const root=path.resolve('D:/projects/edada/work')+path.sep;if(!resolved.startsWith(root)||!resolved.endsWith('.json')||fs.statSync(resolved).size>4000000)throw new Error('Only a bounded non-secret catalog batch in the task work directory is allowed');requests=JSON.parse(fs.readFileSync(resolved,'utf8'));if(!Array.isArray(requests)||requests.length>100)throw new Error('Invalid batch');}
for(let i=0;i<requests.length;i++){
  const response=await fetch(target,{method:'POST',headers:{'OAI-Sites-Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(requests[i]),redirect:'error',signal:AbortSignal.timeout(180000)});
  const value=await response.text();const result=response.headers.get('content-type')?.includes('json')?JSON.parse(value):'Non-JSON response';
  process.stdout.write(JSON.stringify({request:i+1,status:response.status,result})+'\n');if(!response.ok){process.exitCode=1;break;}
}
