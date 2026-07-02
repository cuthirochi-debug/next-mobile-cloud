'use strict';
const $ = (id) => document.getElementById(id);
function defaultApiBase(){ if (location.protocol === 'http:' && location.port === '4173') return location.protocol + '//' + location.hostname + ':4180/api'; return ''; }
const state = { items: [], stream: null, scanTimer: null, lastCode: '', savedSlip: null, zxingReader: null, zxingControls: null, audioCtx: null, apiBaseUrl: localStorage.getItem('next-mobile-api-base') || defaultApiBase() };
const sampleProducts = { '4901234567894': { code: '4901234567894', barcode: '4901234567894', name: 'サンプル飲料 500ml', price: 120, tax_category: 'reduced' }, '4909876543210': { code: '4909876543210', barcode: '4909876543210', name: '業務用タオル', price: 350, tax_category: 'std' } };
const el = { camera: $('camera'), cameraText: $('cameraText'), scanState: $('scanState'), connectionState: $('connectionState'), connectionText: $('connectionText'), startCamera: $('startCamera'), stopCamera: $('stopCamera'), manualForm: $('manualForm'), manualCode: $('manualCode'), customerName: $('customerName'), issuerName: $('issuerName'), itemList: $('itemList'), itemTemplate: $('itemTemplate'), lineCount: $('lineCount'), receiptPreview: $('receiptPreview'), saveSlip: $('saveSlip'), saveState: $('saveState'), printBluetooth: $('printBluetooth'), downloadPrintData: $('downloadPrintData'), browserPrint: $('browserPrint'), clearAll: $('clearAll'), settingsOpen: $('settingsOpen'), settingsDialog: $('settingsDialog'), apiBaseUrl: $('apiBaseUrl'), settingsSave: $('settingsSave') };
function apiRoot(){ return state.apiBaseUrl.replace(/\/$/, ''); }
async function api(method, path, body) { const root = apiRoot(); const url = (root || '/api') + path; const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); const text = await res.text(); const data = text ? JSON.parse(text) : null; if (!res.ok) throw new Error((data && data.error) || '通信に失敗しました'); return data; }
async function updateConnection(){
  el.apiBaseUrl.value = state.apiBaseUrl;
  el.connectionState.textContent = state.apiBaseUrl ? '確認中' : '同一API';
  el.connectionText.textContent = state.apiBaseUrl ? state.apiBaseUrl : '同じサーバーの /api を参照します。未接続時はサンプル商品で入力確認できます。';
  if (!state.apiBaseUrl) return;
  try {
    const res = await fetch(apiRoot() + '/health', { cache: 'no-store' });
    const data = await res.json();
    if (data && data.ok) {
      el.connectionState.textContent = '接続中';
      el.connectionText.textContent = state.apiBaseUrl + ' / 商品 ' + data.products + ' 件・顧客 ' + data.customers + ' 件・未取込 ' + data.slips + ' 件';
    } else {
      el.connectionState.textContent = '未接続';
    }
  } catch (error) {
    el.connectionState.textContent = '未接続';
    el.connectionText.textContent = state.apiBaseUrl + ' に接続できません。同期サーバーを起動してください。';
  }
}
function primeAudio(){
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    state.audioCtx = state.audioCtx || new AudioContext();
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
  } catch {}
}
function notifyScanSuccess(){
  if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = state.audioCtx || new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch {}
}
function todayIso(){ return new Date().toISOString().slice(0,10); }
function nowText(){ return new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date()); }
function itemKey(item){ return item.product_id ? 'p:' + item.product_id : 'c:' + item.code; }
async function lookupProduct(code){ const normalized = String(code || '').trim(); if (!normalized) return null; try { const barcode = await api('GET','/products/barcode-lookup/' + encodeURIComponent(normalized)); if (barcode && barcode.ok && barcode.product) return barcode.product; } catch (e) {}
  try { const list = await api('GET','/products?q=' + encodeURIComponent(normalized)); if (Array.isArray(list) && list.length) return list.find((p)=>p.code===normalized || p.barcode===normalized) || list[0]; } catch (e) {}
  try { const web = await api('GET','/products/web-lookup/' + encodeURIComponent(normalized)); if (web && web.ok && web.product) { alert('商品マスタ未登録のためWebから候補を抽出しました。内容を確認してください。'); return web.product; } } catch (e) {}
  return sampleProducts[normalized] || { code: normalized, barcode: normalized, name: '未登録商品 ' + normalized.slice(-4), price: 0, tax_category: 'std', needs_review: true };
}
async function confirmUnknownProduct(product, code){
  if (product && product.name && !String(product.name).startsWith('未登録商品')) return product;
  const name = prompt('商品名をWebから取得できませんでした。商品名を入力してください。', product?.name && !String(product.name).startsWith('未登録商品') ? product.name : '');
  if (!name || !name.trim()) return null;
  return { ...(product || {}), code: String(code).trim(), barcode: String(code).trim(), name: name.trim(), price: Number(product?.price) || 0, tax_category: product?.tax_category || 'std', needs_review: true };
}
async function addCode(code){ let product = await lookupProduct(code); product = await confirmUnknownProduct(product, code); if (!product) return; notifyScanSuccess(); const item = { product_id: product.id || null, code: product.code || product.barcode || String(code).trim(), barcode: product.barcode || String(code).trim(), name: product.name || '未登録商品', price: Number(product.price) || 0, tax_category: product.tax_category || 'std', qty: 1 }; const key = itemKey(item); const existing = state.items.find((row)=>itemKey(row)===key); if (existing) existing.qty += 1; else state.items.unshift(item); state.lastCode = String(code).trim(); state.savedSlip = null; el.saveState.textContent = '未送信'; el.scanState.textContent = '登録済'; render(); }
function setQty(key, qty){ const item = state.items.find((row)=>itemKey(row)===key); if (!item) return; item.qty = Math.max(0, Number.parseInt(qty,10) || 0); state.items = state.items.filter((row)=>row.qty>0); state.savedSlip = null; el.saveState.textContent = '未送信'; render(); }
function renderItems(){ el.itemList.innerHTML = ''; el.lineCount.textContent = String(state.items.length); if (!state.items.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '商品をスキャンすると、ここに追加されます。'; el.itemList.append(empty); return; } state.items.forEach((item)=>{ const row = el.itemTemplate.content.firstElementChild.cloneNode(true); const key = itemKey(item); row.querySelector('.item-name').textContent = item.name; row.querySelector('.item-code').textContent = item.barcode ? item.code + ' / ' + item.barcode : item.code; const input = row.querySelector('.qty-input'); input.value = item.qty; input.addEventListener('change',()=>setQty(key,input.value)); row.querySelector('.qty-minus').addEventListener('click',()=>setQty(key,item.qty-1)); row.querySelector('.qty-plus').addEventListener('click',()=>setQty(key,item.qty+1)); el.itemList.append(row); }); }
function padRight(value,width){ const text=String(value==null?'':value); return text.length>=width ? text.slice(0,width) : text + ' '.repeat(width-text.length); }
function padLeft(value,width){ const text=String(value==null?'':value); return text.length>=width ? text.slice(0,width) : ' '.repeat(width-text.length) + text; }
function receiptText(){ const width=32; const lines=['          納品書','-'.repeat(width),'発行: '+nowText(),'納品先: '+(el.customerName.value.trim() || '未入力'),'担当: '+(el.issuerName.value.trim() || 'nextモバイル')]; if (state.savedSlip) lines.push('伝票: ' + (state.savedSlip.mgmt_no || state.savedSlip.voucher_no || state.savedSlip.id || '送信済')); lines.push('-'.repeat(width)); if (!state.items.length) lines.push('商品が登録されていません'); else state.items.slice().reverse().forEach((item)=>{ lines.push(padRight(item.name,24)+padLeft(item.qty,4)); lines.push('  '+item.code); }); lines.push('-'.repeat(width)); lines.push(padRight('合計数量',24)+padLeft(state.items.reduce((sum,item)=>sum+item.qty,0),4)); lines.push('','受領印:','',''); return lines.join('\n'); }
function render(){ renderItems(); el.receiptPreview.textContent = receiptText(); }
function loadScript(src){ return new Promise((resolve,reject)=>{ const script=document.createElement('script'); script.src=src; script.async=true; script.onload=resolve; script.onerror=reject; document.head.append(script); }); }
async function loadZxing(){ if (window.ZXing && window.ZXing.BrowserMultiFormatReader) return window.ZXing; const urls=['https://cdn.jsdelivr.net/npm/@zxing/library@latest/umd/index.min.js','https://unpkg.com/@zxing/library@latest/umd/index.min.js']; for (const url of urls) { try { await loadScript(url); if (window.ZXing && window.ZXing.BrowserMultiFormatReader) return window.ZXing; } catch (error) {} } return null; }
async function startBarcodeDetector(){
  state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  el.camera.srcObject = state.stream;
  await el.camera.play();
  el.cameraText.textContent = '';
  el.scanState.textContent = '読取中';
  const detector = new BarcodeDetector({ formats: ['ean_13','ean_8','code_128','code_39','itf','qr_code'] });
  state.scanTimer = window.setInterval(async()=>{ const results = await detector.detect(el.camera).catch(()=>[]); if (!results.length) return; const code = results[0].rawValue; if (code && code !== state.lastCode) await addCode(code); },700);
}
async function startZxing(){
  el.scanState.textContent = '準備中';
  el.cameraText.textContent = '読取ライブラリを読み込んでいます。';
  const ZXing = await loadZxing();
  if (!ZXing) { el.scanState.textContent = '手入力'; el.cameraText.textContent = '読取ライブラリを読み込めませんでした。手入力で追加してください。'; return; }
  state.zxingReader = new ZXing.BrowserMultiFormatReader();
  el.cameraText.textContent = '';
  el.scanState.textContent = '読取中';
  state.zxingControls = await state.zxingReader.decodeFromVideoDevice(null, el.camera, async (result) => {
    if (!result) return;
    const code = typeof result.getText === 'function' ? result.getText() : String(result.text || result);
    if (code && code !== state.lastCode) await addCode(code);
  });
}
async function startCamera(){
  primeAudio();
  stopCamera();
  const localHost = ['localhost','127.0.0.1','::1'].includes(location.hostname);
  if (!window.isSecureContext && !localHost) {
    el.scanState.textContent = 'HTTPS必要';
    el.cameraText.textContent = 'スマホのHTTP接続ではカメラを使えません。手入力で試すか、HTTPS/クラウド同期URLで開いてください。';
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    el.scanState.textContent = '非対応';
    el.cameraText.textContent = 'このブラウザではカメラ起動に対応していません。ChromeやSafariで開いてください。';
    return;
  }
  try { if ('BarcodeDetector' in window) await startBarcodeDetector(); else await startZxing(); }
  catch (error) { el.scanState.textContent = '未許可'; el.cameraText.textContent = 'カメラを起動できませんでした。ブラウザのカメラ許可を確認してください。'; }
}
function stopCamera(){
  if (state.scanTimer) window.clearInterval(state.scanTimer);
  state.scanTimer = null;
  if (state.zxingControls && typeof state.zxingControls.stop === 'function') state.zxingControls.stop();
  state.zxingControls = null;
  if (state.zxingReader && typeof state.zxingReader.reset === 'function') state.zxingReader.reset();
  if (state.stream) state.stream.getTracks().forEach((track)=>track.stop());
  state.stream = null;
  el.camera.srcObject = null;
  el.cameraText.textContent = 'カメラを起動してバーコードを枠に合わせてください。';
  el.scanState.textContent = '待機中';
}
async function saveSlip(){ if (!state.items.length) { alert('商品を登録してください。'); return; } const payload = { slip_date: todayIso(), customer_name: el.customerName.value.trim() || 'モバイル納品先', issuer: el.issuerName.value.trim() || 'nextモバイル', tax_mode: 'excl', rate: 100, doc_type: 'sales', slip_kind: 'sales', source: 'next-mobile', mgmt_prefix: '126', note: 'nextモバイルで作成', lines: state.items.slice().reverse().map((item)=>({ product_id:item.product_id, code:item.code, name:item.name, price:item.price, qty:item.qty, tax_category:item.tax_category })) }; try { state.savedSlip = await api('POST','/slips',payload); el.saveState.textContent = '送信済'; } catch (error) { const drafts = JSON.parse(localStorage.getItem('next-mobile-drafts') || '[]'); drafts.push({ created_at: new Date().toISOString(), payload }); localStorage.setItem('next-mobile-drafts', JSON.stringify(drafts)); state.savedSlip = { id: '未送信保存' }; el.saveState.textContent = '端末保存'; alert('送信できなかったため端末に保存しました。接続後に再送機能を追加します。'); } render(); }
function escPosBytes(text){ const encoder = new TextEncoder(); const init=[0x1b,0x40]; const lineSpacing=[0x1b,0x33,0x18]; const body=Array.from(encoder.encode(text.replace(/\n/g,'\r\n'))); const feed=[0x0a,0x0a,0x0a]; return new Uint8Array([...init,...lineSpacing,...body,...feed]); }
async function printBluetooth(){ if (!navigator.bluetooth) { alert('このブラウザはBluetooth印刷に未対応です。MP-B20用データ保存、または画面から印刷を使ってください。'); return; } try { const device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'MP-B20' }], optionalServices: [0xffe0,'0000ffe0-0000-1000-8000-00805f9b34fb'] }); const server = await device.gatt.connect(); const service = await server.getPrimaryService(0xffe0); const characteristic = await service.getCharacteristic(0xffe1); const bytes = escPosBytes(receiptText()); for (let i=0; i<bytes.length; i+=180) await characteristic.writeValue(bytes.slice(i,i+180)); } catch (error) { alert('Bluetooth印刷に失敗しました。MP-B20の接続方式に合わせた調整が必要な場合があります。'); } }
function downloadPrintData(){ const blob = new Blob([escPosBytes(receiptText())], { type: 'application/octet-stream' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'next-mobile-mp-b20-' + Date.now() + '.bin'; link.click(); URL.revokeObjectURL(url); }
el.startCamera.addEventListener('click', startCamera); el.stopCamera.addEventListener('click', stopCamera); el.manualForm.addEventListener('submit',(event)=>{ event.preventDefault(); addCode(el.manualCode.value).catch((error)=>alert(error.message)); el.manualCode.value=''; }); el.saveSlip.addEventListener('click',()=>saveSlip().catch((error)=>alert(error.message))); el.printBluetooth.addEventListener('click', printBluetooth); el.downloadPrintData.addEventListener('click', downloadPrintData); el.browserPrint.addEventListener('click',()=>window.print()); el.customerName.addEventListener('input', render); el.issuerName.addEventListener('input', render); el.clearAll.addEventListener('click',()=>{ state.items=[]; state.lastCode=''; state.savedSlip=null; el.saveState.textContent='未送信'; render(); }); el.settingsOpen.addEventListener('click',()=>el.settingsDialog.showModal()); el.settingsSave.addEventListener('click',()=>{ state.apiBaseUrl = el.apiBaseUrl.value.trim(); localStorage.setItem('next-mobile-api-base', state.apiBaseUrl); updateConnection(); el.settingsDialog.close(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
updateConnection(); render();
