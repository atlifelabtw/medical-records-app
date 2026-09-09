# medical-records-app

AT Case Library 個人版，沿用 GitHub Pages 與既有 Supabase 資料。

## Build 49：不改畫面的效能優化

- 將 v2 到 v13 的樣式依原順序整合為 `app-style.css`，減少逐層載入。
- 搜尋文字只暫存在記憶體，每次成功重新取得資料後清除。不新增本機持久資料，也不更改搜尋範圍與結果。
- 首頁分類數量改為一次計算，最近使用數量不再為了計數而排序所有病歷。
- 日期顯示重用格式器，維持原有語系、本地時區及舊資料顯示。
- 不修改資料庫、帳號權限、儲存、備份或最近使用的排序邏輯。

## 建置與測試

需要 Node.js。修改樣式時請修改原本的 `v*-style.css`，再執行：

```sh
node scripts/build.mjs
node scripts/build.mjs --check
node --check v2-app.js
node --test tests/*.test.mjs
```

部署需包含產生的 `app-style.css`，不要只上傳原始樣式檔。更新版本時，同步更新 `index.html`、`build.json` 與「關於系統」版本。

瀏覽器回歸測試需本機 Playwright 與 Chrome：

```sh
node tests/performance-browser.mjs
```

可用 `PLAYWRIGHT_MODULE` 指定既有 Playwright 套件路徑。測試只使用虛擬個案，攔截所有後端請求，不會接觸正式資料。測試會比對 Build 48 的手機、平板及桌面 DOM／樣式，檢查搜尋、單擊導覽、表單入口、匯出與權限顯示，並輸出模擬資料的效能量測；不代表正式資料庫 CRUD 的端對端驗證。
