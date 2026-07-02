# nextモバイル Cloud版

KatoNext本体を変更せず、nextモバイル画面と同期APIを同じクラウドURLで配信する構成です。

## ローカル起動

```powershell
cd C:\Users\katob\Documents\Codex\2026-07-02\mo\outputs\next-mobile-cloud
node server.mjs
```

開くURL:

```text
http://localhost:8080/
```

## クラウド配置

Render / Railway / Fly.io / Azure App Service など、Node.js が動くクラウドに配置できます。クラウド側ではHTTPS URLが発行されます。

必須環境変数:

```text
PORT=8080
NEXT_MOBILE_SYNC_KEY=長いランダム文字列
ALLOW_PUBLIC_MASTER=1
```

HTTPS URLで nextモバイル画面とAPIが同じドメインになるため、画面右上のAPI URLは空欄のままで使えます。

## PC側KatoNextとの連携

Claude側でKatoNext本体に以下の処理を追加します。

1. 商品マスタを `POST /api/sync/products` に送信
2. 顧客マスタを `POST /api/sync/customers` に送信
3. 未取込納品書を `GET /api/sync/slips/pending` で取得
4. KatoNextへ登録後、`POST /api/sync/slips/:id/ack` を送信

PC側から同期APIを呼ぶときは、ヘッダーに認証キーを付けます。

```text
X-Sync-Key: NEXT_MOBILE_SYNC_KEYの値
```

## API一覧

- `GET /api/health`
- `GET /api/products?q=...`
- `GET /api/products/barcode-lookup/:code`
- `GET /api/customers?q=...`
- `POST /api/slips`
- `POST /api/sync/products`
- `POST /api/sync/customers`
- `GET /api/sync/slips/pending`
- `POST /api/sync/slips/:id/ack`
