import type {CatalogListing} from './proshoper.ts';
import {enrichmentKey} from './product-enrichment.ts';

export type MagnitProduct={id:string;url:string;slug:string};
export type RetailerTarget={key:string;urls:string[]};

function magnitProduct(value:string):MagnitProduct|null{
  try{
    const url=new URL(value);
    if(url.origin!=='https://magnit.ru'||url.username||url.password||url.search||url.hash)return null;
    const match=url.pathname.match(/^\/product\/(\d+)-([^/\s]+)\/?$/);
    return match?{id:match[1],url:url.href,slug:match[2]}:null;
  }catch{return null;}
}

/** Read an explicit product sitemap; unrelated hosts and duplicate IDs are ignored. */
export function parseMagnitSitemap(xml:string):MagnitProduct[]{
  if(!/<(?:\w+:)?urlset\b[^>]*>[\s\S]*<\/(?:\w+:)?urlset\s*>/i.test(xml))return [];
  const products=new Map<string,MagnitProduct>();
  for(const match of xml.matchAll(/<(?:\w+:)?loc>\s*([^<\s]+)\s*<\/(?:\w+:)?loc\s*>/g)){
    const product=magnitProduct(match[1].replace(/&amp;/g,'&'));
    if(product&&!products.has(product.id))products.set(product.id,product);
  }
  return [...products.values()];
}

const characters:Record<string,string>={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
const translit=(text:string)=>text.toLowerCase().replace(/[а-яё]/g,char=>characters[char]);
const stops=new Set(['dlya','bez','sht','shtuk','upakovka','pachka','banka','butylka','paket','myagkoy','gramm','grammov','sort','kategoriya','produkt','produkty','svezhiy','svezhaya','iz','v','i','s','na','po','so','ot','kg','ml']);
function words(text:string):string[]{
  return [...new Set(translit(text).replace(/([0-9])([a-z])/g,'$1 $2').replace(/([a-z])([0-9])/g,'$1 $2').split(/[^a-z0-9]+/)
    .filter(word=>word.length>=3&&!stops.has(word)&&!/^\d+$/.test(word)).map(word=>word.length>6?word.slice(0,6):word))];
}
function packHints(text:string):{basis:string;value:number}[]{
  const value=translit(text).replace(/(\d+)[_,.](\d+)(?=\s*(?:kg|ml|g|l)(?:$|[^a-z]))/g,'$1.$2').replace(/_/g,' ');
  return [...value.matchAll(/(?:^|[^\d.])(\d+(?:[.,]\d+)?)\s*(kg|ml|g|l)(?=$|[^a-z])/g)]
    .map(match=>({basis:['kg','g'].includes(match[2])?'g':'ml',value:Number(match[1].replace(',','.'))*(['kg','l'].includes(match[2])?1000:1)}));
}

/** Candidate discovery only. A ranked URL never proves identity, mass or nutrition. */
export function retailerTargets(rows:CatalogListing[],products:MagnitProduct[]):RetailerTarget[]{
  const unique=new Map<string,MagnitProduct>();
  for(const input of products){const product=magnitProduct(input.url);if(product&&!unique.has(product.id))unique.set(product.id,product);}
  const catalog=[...unique.values()].map(product=>({...product,tokens:new Set(words(product.slug)),packs:packHints(product.slug)}));
  const index=new Map<string,number[]>();
  catalog.forEach((product,id)=>{for(const token of product.tokens){const ids=index.get(token);if(ids)ids.push(id);else index.set(token,[id]);}});
  const idf=(token:string)=>Math.log(1+catalog.length/(index.get(token)?.length||catalog.length));
  const result=new Map<string,RetailerTarget>();
  for(const row of rows){
    const key=enrichmentKey(row);if(result.has(key))continue;
    const target:RetailerTarget={key,urls:[]};result.set(key,target);
    const tokens=words(row.name),total=tokens.reduce((sum,token)=>sum+idf(token),0);
    if(!tokens.length||!total)continue;
    const localPack=packHints(`${row.name} ${row.packText??''}`);
    if(row.packGrams!==undefined)localPack.push({basis:'g',value:row.packGrams});
    // Accumulate only postings for query tokens, never scan every product per row.
    const overlaps=new Map<number,{weight:number;count:number}>();
    for(const token of tokens)for(const id of index.get(token)??[]){
      const overlap=overlaps.get(id)??{weight:0,count:0};overlap.weight+=idf(token);overlap.count++;overlaps.set(id,overlap);
    }
    const ranked:{url:string;score:number}[]=[];
    for(const [id,overlap] of overlaps){
      const ratio=overlap.weight/total;if(overlap.count<2||ratio<0.56||overlap.weight<5.5)continue;
      const product=catalog[id];
      const packBonus=localPack.length&&product.packs.length?(localPack.some(local=>product.packs.some(remote=>local.basis===remote.basis&&local.value===remote.value))?2:-1.5):0;
      ranked.push({url:product.url,score:ratio*10+overlap.weight*0.15+overlap.count*0.12+packBonus});
    }
    ranked.sort((a,b)=>b.score-a.score);
    target.urls=ranked.slice(0,3).map(product=>product.url);
  }
  return [...result.values()];
}
