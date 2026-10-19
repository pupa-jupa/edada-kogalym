// Admin verification helper. Never accepts credentials via argv or files.
const terminal=process.stdin.isTTY;
if(terminal)process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stderr.write('Ready for service request JSON on stdin (input is hidden).\n');
const input=await new Promise((resolve,reject)=>{let value='';const onData=chunk=>{value+=chunk;if(value.includes('\u0003'))reject(new Error('Cancelled'));if(value.length>20000)reject(new Error('Input too large'));if(value.includes('\n')||value.includes('\r')){process.stdin.off('data',onData);process.stdin.pause();resolve(value);}};process.stdin.on('data',onData);process.stdin.resume();});
if(terminal)process.stdin.setRawMode(false);
const {url,token,body}=JSON.parse(input);
const target=new URL(url);
if(target.origin!=='https://eda-da-kogalym.social-grape-1472.chatgpt.site'||target.pathname!=='/api/refresh-service')throw new Error('Only the project refresh writer is allowed');
if(typeof token!=='string'||!token)throw new Error('Missing service access');
const response=await fetch(target,{method:'POST',headers:{'OAI-Sites-Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body??{}),redirect:'error',signal:AbortSignal.timeout(180000)});
const text=await response.text();
process.stdout.write(JSON.stringify({status:response.status,result:response.headers.get('content-type')?.includes('json')?JSON.parse(text):'Non-JSON response'})+'\n');
if(!response.ok)process.exitCode=1;
