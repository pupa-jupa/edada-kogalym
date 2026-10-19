type Part={id:string;payload:string};
export function packStatePayload(value:unknown):{payload:string;parts:Part[]}{
 const text=JSON.stringify(value);if(text.length<=200000)return {payload:text,parts:[]};
 const parts:Part[]=[];for(let i=0;i<text.length;){let end=Math.min(text.length,i+200000);const c=text.charCodeAt(end-1);if(c>=0xd800&&c<=0xdbff)end--;parts.push({id:crypto.randomUUID(),payload:text.slice(i,end)});i=end;}
 if(parts.length>100)throw new Error('Превышен размер личного каталога');return {payload:JSON.stringify({__edadaParts:parts.map(p=>p.id)}),parts};
}
export async function unpackStatePayload<T>(payload:string,read:(ids:string[])=>Promise<Part[]>):Promise<T>{
 const parsed=JSON.parse(payload);if(!parsed.__edadaParts)return parsed as T;
 const ids:unknown=parsed.__edadaParts;if(!Array.isArray(ids)||ids.length<1||ids.length>100||ids.some(id=>typeof id!=='string'||!/^[a-z0-9-]{36}$/i.test(id))||new Set(ids).size!==ids.length)throw new Error('Некорректное сохранение каталога');
 const parts=await read(ids);const byId=new Map(parts.map(p=>[p.id,p.payload]));if(parts.length!==ids.length||byId.size!==ids.length||ids.some(id=>!byId.has(id)))throw new Error('Неполное сохранение каталога; повторите чтение');
 return JSON.parse(ids.map(id=>byId.get(id)).join('')) as T;
}
