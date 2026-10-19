async function key(master: string) {
  if (!/^[a-f\d]{64}$/i.test(master)) throw new Error('Серверный ключ шифрования не настроен');
  return crypto.subtle.importKey('raw', Uint8Array.from(master.match(/../g)!, h => parseInt(h,16)), 'AES-GCM', false, ['encrypt','decrypt']);
}
export async function seal(value: string, master: string): Promise<string> {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const bytes=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(master),new TextEncoder().encode(value)));
  return 'v1.'+btoa(String.fromCharCode(...iv))+'.'+btoa(String.fromCharCode(...bytes));
}
export async function unseal(value: string, master: string): Promise<string> {
  const [v,iv,body]=value.split('.');
  if(v!=='v1'||!iv||!body)throw new Error('Некорректный зашифрованный ключ');
  const bytes=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv)},await key(master),bytes(body)));
}
