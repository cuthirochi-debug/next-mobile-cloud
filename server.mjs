import http from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const API_KEY = process.env.NEXT_MOBILE_SYNC_KEY || '';
const ALLOW_PUBLIC_MASTER = process.env.ALLOW_PUBLIC_MASTER !== '0';
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8', '.svg':'image/svg+xml; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.ico':'image/x-icon' };
function emptyStore(){ return { products:[], customers:[], slips:[], updated_at:null }; }
async function loadStore(){ try { return JSON.parse(await readFile(DATA_FILE,'utf8')); } catch { return emptyStore(); } }
async function saveStore(store){ await mkdir(DATA_DIR,{recursive:true}); store.updated_at = new Date().toISOString(); await writeFile(DATA_FILE, JSON.stringify(store,null,2),'utf8'); }
function sendJson(res,status,body){ res.writeHead(status,{ 'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization,X-Sync-Key','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); }
function normalize(value){ return String(value||'').trim().toLowerCase(); }
function authOk(req){ if(!API_KEY) return true; return req.headers['x-sync-key'] === API_KEY || req.headers.authorization === 'Bearer ' + API_KEY; }
async function readJson(req){ const chunks=[]; for await (const chunk of req) chunks.push(chunk); if(!chunks.length) return {}; return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
function productMatches(product,q){ const query=normalize(q); if(!query) return true; return [product.code, product.barcode, product.name, product.kana].some((value)=>normalize(value).includes(query)); }
function stripHtml(value){ return String(value||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim(); }
function firstMatch(text, re){ const m = String(text||'').match(re); return m ? stripHtml(m[1]) : ''; }
async function fetchText(url){ const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 next-mobile product lookup', 'Accept-Language': 'ja,en;q=0.8' } }); if(!res.ok) throw new Error('fetch failed ' + res.status); return await res.text(); }
function productFromPageHtml(html, url, code){
  let name = '';
  const jsonLdBlocks = [...String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m)=>stripHtml(m[1]));
  for (const block of jsonLdBlocks) {
    try {
      const parsed = JSON.parse(block);
      const list = Array.isArray(parsed) ? parsed : [parsed, ...(Array.isArray(parsed['@graph']) ? parsed['@graph'] : [])];
      const prod = list.find((item)=>String(item['@type']||'').toLowerCase().includes('product') && item.name);
      if (prod) { name = String(prod.name || '').trim(); break; }
    } catch {}
  }
  if (!name) name = firstMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || firstMatch(html, /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) || firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  name = name.replace(/[|｜].*$/,'').replace(/通販.*$/,'').replace(/価格.*$/,'').trim();
  if (!name || name.length < 2) return null;
  return { code, barcode: code, name: name.slice(0, 80), price: 0, tax_category: 'std', source: 'web_lookup', source_url: url, needs_review: true };
}
function cleanProductName(name, code){
  return stripHtml(name)
    .replace(new RegExp(code, 'g'), '')
    .replace(/JANコード|バーコード|商品情報|価格|通販|楽天市場|Yahoo!ショッピング|Amazon|ヨドバシ|ビックカメラ|商品検索/gi, ' ')
    .replace(/[|｜:：].*$/,'')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0, 80);
}
function productFromSearchHtml(html, sourceUrl, code){
  const titles = [];
  for (const re of [/<a[^>]*>([\s\S]{0,220}?)<\/a>/gi, /<h3[^>]*>([\s\S]{0,220}?)<\/h3>/gi, /<title[^>]*>([\s\S]*?)<\/title>/i]) {
    for (const m of String(html).matchAll(re)) {
      const title = cleanProductName(m[1], code);
      if (title && title.length >= 3 && /[一-龠ぁ-んァ-ヶA-Za-z0-9]/.test(title)) titles.push(title);
    }
  }
  const name = titles.find((t)=>!/^https?/.test(t) && !/ログイン|検索|画像|動画|ニュース/.test(t));
  return name ? { code, barcode: code, name, price: 0, tax_category: 'std', source: 'web_search_title', source_url: sourceUrl, needs_review: true } : null;
}
async function webLookupProduct(code){
  const encoded = encodeURIComponent(code);
  const query = encodeURIComponent(code + ' 商品名 JAN');
  const searchUrls = [
    'https://www.bing.com/search?q=' + query,
    'https://duckduckgo.com/html/?q=' + query,
    'https://search.rakuten.co.jp/search/mall/' + encoded + '/',
    'https://shopping.yahoo.co.jp/search?p=' + encoded
  ];
  const candidates = [];
  for (const searchUrl of searchUrls) {
    try {
      const html = await fetchText(searchUrl);
      const direct = productFromSearchHtml(html, searchUrl, code);
      if (direct && !candidates.some((p)=>p.name===direct.name)) candidates.push(direct);
      const links = [...html.matchAll(/href=["'](https?:\/\/[^"'#]+)["']/gi)]
        .map((m)=>m[1].replace(/&amp;/g,'&'))
        .filter((url)=>!url.includes('duckduckgo.com')&&!url.includes('bing.com')&&!url.includes('microsoft.com')&&!url.includes('yahoo.co.jp/search'))
        .slice(0,8);
      for (const url of links) {
        try {
          const page = await fetchText(url);
          const product = productFromPageHtml(page, url, code) || productFromSearchHtml(page, url, code);
          if (product && !candidates.some((p)=>p.name===product.name)) candidates.push(product);
          if (candidates.length >= 3) return candidates;
        } catch {}
      }
    } catch {}
  }
  return candidates;
}
async function handleApi(req,res,url){ if(req.method==='OPTIONS') return sendJson(res,200,{ok:true}); const store=await loadStore(); if(url.pathname==='/api/health') return sendJson(res,200,{ok:true,products:store.products.length,customers:store.customers.length,slips:store.slips.filter((s)=>s.status==='pending').length,updated_at:store.updated_at}); if(!ALLOW_PUBLIC_MASTER && !authOk(req) && (url.pathname==='/api/products'||url.pathname==='/api/customers'||url.pathname.startsWith('/api/products/barcode-lookup/'))) return sendJson(res,401,{error:'unauthorized'}); if(url.pathname==='/api/products'&&req.method==='GET'){ const q=url.searchParams.get('q')||''; return sendJson(res,200,store.products.filter((product)=>productMatches(product,q)).slice(0,100)); } const webLookupMatch=url.pathname.match(/^\/api\/products\/web-lookup\/(.+)$/); if(webLookupMatch&&req.method==='GET'){ const code=decodeURIComponent(webLookupMatch[1]); const existing=store.products.find((item)=>String(item.barcode||'')===code||String(item.code||'')===code); if(existing) return sendJson(res,200,{ok:true,product:existing,source:'master'}); const candidates=await webLookupProduct(code); if(candidates.length){ store.products=upsertByKey(store.products,[candidates[0]],['code','barcode']); await saveStore(store); return sendJson(res,200,{ok:true,product:candidates[0],candidates,source:'web_lookup',needs_review:true}); } return sendJson(res,200,{ok:false,reason:'notfound',candidates:[]}); } const barcodeMatch=url.pathname.match(/^\/api\/products\/barcode-lookup\/(.+)$/); if(barcodeMatch&&req.method==='GET'){ const code=decodeURIComponent(barcodeMatch[1]); const product=store.products.find((item)=>String(item.barcode||'')===code||String(item.code||'')===code); return sendJson(res,200,product?{ok:true,product}:{ok:false,reason:'notfound'}); } if(url.pathname==='/api/customers'&&req.method==='GET'){ const q=normalize(url.searchParams.get('q')||''); const rows=store.customers.filter((customer)=>!q||[customer.code,customer.name,customer.kana].some((value)=>normalize(value).includes(q))).slice(0,100); return sendJson(res,200,rows); } if(url.pathname==='/api/slips'&&req.method==='POST'){ const body=await readJson(req); const slip={id:crypto.randomUUID(),mobile_id:body.mobile_id||crypto.randomUUID(),status:'pending',created_at:new Date().toISOString(),received_at:new Date().toISOString(),payload:body}; store.slips.push(slip); await saveStore(store); return sendJson(res,201,{ok:true,id:slip.id,mobile_id:slip.mobile_id,status:slip.status}); } if(url.pathname==='/api/sync/products'&&req.method==='POST'){ if(!authOk(req)) return sendJson(res,401,{error:'unauthorized'}); const body=await readJson(req); const rows=Array.isArray(body)?body:body.products||[]; store.products=upsertByKey(store.products,rows,['code','barcode']); await saveStore(store); return sendJson(res,200,{ok:true,products:store.products.length}); } if(url.pathname==='/api/sync/customers'&&req.method==='POST'){ if(!authOk(req)) return sendJson(res,401,{error:'unauthorized'}); const body=await readJson(req); const rows=Array.isArray(body)?body:body.customers||[]; store.customers=upsertByKey(store.customers,rows,['code','id']); await saveStore(store); return sendJson(res,200,{ok:true,customers:store.customers.length}); } if(url.pathname==='/api/sync/slips/pending'&&req.method==='GET'){ if(!authOk(req)) return sendJson(res,401,{error:'unauthorized'}); return sendJson(res,200,store.slips.filter((slip)=>slip.status==='pending')); } const ackMatch=url.pathname.match(/^\/api\/sync\/slips\/([^/]+)\/ack$/); if(ackMatch&&req.method==='POST'){ if(!authOk(req)) return sendJson(res,401,{error:'unauthorized'}); const body=await readJson(req).catch(()=>({})); const slip=store.slips.find((item)=>item.id===ackMatch[1]); if(!slip) return sendJson(res,404,{error:'not found'}); slip.status='imported'; slip.imported_at=new Date().toISOString(); slip.katonext_slip_id=body.katonext_slip_id||null; await saveStore(store); return sendJson(res,200,{ok:true,id:slip.id,status:slip.status}); } return sendJson(res,404,{error:'not found'}); }
const server=http.createServer(async(req,res)=>{ try { const url=new URL(req.url,'http://localhost'); if(url.pathname.startsWith('/api/')) return await handleApi(req,res,url); return await serveStatic(req,res,url); } catch(error){ return sendJson(res,500,{error:error.message}); } });
server.listen(PORT,HOST,()=>console.log('next-mobile cloud server listening on :' + PORT));
