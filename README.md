# nextモバイル

KatoNext本体とは別の独立PWAです。KatoNextは変更しません。

## 開き方
このフォルダを静的Webサーバーで配信して、ブラウザで index.html を開きます。

例:

```
cd C:\Users\katob\Documents\Codex\2026-07-02\mo\outputs\next-mobile
python -m http.server 4173
```

その後:

```
http://localhost:4173/
```

スマホで同じWi-Fiから試す場合:

```
http://PCのIPアドレス:4173/
```

## API接続
画面右上の設定からAPI URLを指定します。

- KatoNextと同じ配信元で動かす場合: 空欄
- クラウド同期を使う場合: 例 `https://sync.example.com/api`

期待するAPIはKatoNext互換です。

- GET /products/barcode-lookup/:code
- GET /products?q=...
- POST /slips

## モバイル通信で使う場合
スマホのモバイル通信から事務所PCへ直接接続するのではなく、クラウド同期APIを用意して、このアプリのAPI URLに指定します。

## MP-B20
58mmレシート幅のプレビュー、Web Bluetooth送信、ESC/POS風データ保存を用意しています。実機の文字コード設定により、日本語印字は調整が必要になる場合があります。

## バーコード読取

ブラウザ標準の BarcodeDetector が使える場合はそれを利用します。未対応ブラウザでは ZXing ライブラリをCDNから読み込んで読取を試します。インターネットに接続できない場合やカメラ権限がない場合は手入力で登録できます。
