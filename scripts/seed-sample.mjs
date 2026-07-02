const base = process.env.SYNC_URL || 'http://localhost:' + (process.env.PORT || 8080) + '/api';
const key = process.env.NEXT_MOBILE_SYNC_KEY || '';
const headers = { 'Content-Type': 'application/json' };
if (key) headers['X-Sync-Key'] = key;
const products = [
  { code: '4901234567894', barcode: '4901234567894', name: 'サンプル飲料 500ml', price: 120, tax_category: 'reduced' },
  { code: '4909876543210', barcode: '4909876543210', name: '業務用タオル', price: 350, tax_category: 'std' }
];
const customers = [{ code: 'C001', name: '株式会社サンプル商店', kana: 'サンプルショウテン' }];
for (const [p, body] of [['/sync/products', { products }], ['/sync/customers', { customers }]]) {
  const res = await fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) });
  console.log(p, res.status, await res.text());
}
