# 設計書: 日付指定時の集計欠落（同一分の複数試合が丸ごと欠落する） — issue #358

ステータス: 実装済み（レビュー反映済み）

## 追記：マージ前の方針変更（バックフィル/旧データ移行を削除）

レビュー後の調査で、**熟練度バックフィル機構が実質デッドコード**であることが判明したため、本 PR で**削除**した。理由と影響:

- 熟練度取得ロジックの導入は 2026-05-07〜13。バックフィルの対象窓（直近30日）はまるごと導入後で、対象日は常にゼロ（実データでも直近30日・全日欠損ゼロを確認）。
- そもそも熟練度は**フロントエンドで一切消費されていない**（表示・分析ともに使用箇所ゼロ）。読まれない項目を埋めるための再スクレイプであり、ユーザー価値なし。
- 削除に伴い、下記「⚠️ 破壊的操作 1（旧 doc 移行 = `migrateLegacy`）」も**不要となり削除**。旧データ移行はバックフィル（古い日の再スクレイプ）時にのみ走る後始末であり、バックフィルが無ければ発生しないため。
  - 副次効果: レビュー指摘の「IndexedDB orphan による二重計上」「`MatchIDFromURL` コメントの self-healing 過大主張」も、トリガー（キーの切り替わり＝再スクレイプ）が消えるため構造的に解消。
- **doc ID の新方式（`分精度_MatchID`）は維持**。同一分の別試合を別 doc に分けるのは #358 修正の核であり、バックフィル削除とは独立して必要。新規試合は最初から新 doc ID で書かれ、旧 doc との二重化は起きない。

## ⚠️ 冒頭：ユーザー確認が要る重要判断

- **バグ修正そのものに破壊的マイグレーションは不要。** 新キーは後方互換フォールバック（`MatchID` 空なら従来の分精度キー）で設計するため、既存 Firestore データはそのまま読み続けられる。この修正で**今後の**同一分複数試合は正しく保存・集計される。
- **すでに恒久ロスした過去試合（同一分衝突で一度も保存されなかった分）の回復は、この修正のスコープ外**。回復には対象日の**再スクレイプ**が必要で、rate-limit(403) コストと（全件やり直す場合は）Firestore の破棄を伴う。別 issue として起票し、ユーザー判断に委ねる。
- 本 PR に含める破壊的っぽい操作は 2 つ。いずれも自己回復的で安全と判断するが、明示しておく:
  1. **バックフィル再スクレイプ時のみ**、同一試合の旧「分精度 doc」を削除して新「MatchID doc」へ置き換える（重複防止。同一保存内で正しい doc を書き直すため net で非破壊）。
  2. **IndexedDB キャッシュのバージョン更新でクライアントキャッシュを一度クリア**（サーバ再取得で全件復元されるため、ソースデータには非破壊）。

## 1. 方針

### 根本原因（確定済み）
試合の一意キーが分精度 `MatchKeyFormat = "2006-01-02T1504"`（`internal/model/types.go:11`）。同一分に2試合あると 1グループに 8 エントリ入り、`len(entries) != 4` 判定で**両試合が丸ごと欠落**する。欠落は grouping/dedup を分精度で行う **4箇所**:

| # | 箇所 | 症状 |
|---|------|------|
| 1 | `internal/firestore/scores.go` groupByDatetime→len!=4 skip | Firestore へ書かれず恒久ロス（[WARN]ログあり） |
| 2 | `internal/pipeline/matchdata.go` grouping→len!=4 skip | JSON 生成から欠落（ログなし） |
| 3 | `internal/pipeline/pipeline.go` mergeScores の分精度 dedup | 既存×新規マージ時に同一分の既存を巻き添えで破棄 |
| 4 | `static/lib/db.js` `id = userKey+'_'+date`（分精度） | IndexedDB で同一分の試合を相互上書き |

### 一意キーの検証（detailURL）
- 日別ページの各 `li.item > a[href]` が 1 試合の詳細ページ URL（`scraper.go:417-422`）。
- `parseDetailPage` は**その 1 ページから 4 プレイヤー全員**の `DatedScore` を生成（`scraper.go:657-757`）。
- したがって **1 detailURL = 1 試合 = 4 プレイヤーで共有**。同一分の 2 試合は必ず別々の detailURL を持つ。
- **結論**: detailURL は「同一試合の 4 人を 1 グループにまとめ、同一分の別試合を区別する」自然かつ冪等な一意キー。ただし `DatedScore` に detailURL 相当のフィールドは**存在しない**ため伝播経路の新設が必要。

### 採用案
**detailURL から安定ハッシュ `MatchID` を導出し、scraper → DatedScore → Firestore(doc field + doc ID) → LoadScores → 全 grouping/dedup へ伝播。** grouping/dedup キーは「`MatchID` があればそれ、無ければ従来の分精度」の**フォールバック方式**（後方互換）。
`MatchID = SHA256(stripQuery(detailURL))[:8] の16進` — 既存 `model.UserKey` と同じ 8バイトhex 方式に揃える。

### 代替案とトレードオフ

| 案 | 冪等性 | 同一分の区別 | 実装コスト | 判定 |
|----|--------|------------|-----------|------|
| **A. detailURL 由来 MatchID（採用）** | ◎ 同一試合→常に同一URL→同一ID。再スクレイプで上書き・重複なし | ◎ URL が別なら別ID | 中 | **採用** |
| B. 秒精度キー `...150405` | ◎ | ✕ 元データが分精度しかない（`p.datetime.fz-ss` は "HH:MM"） | 低 | 却下（実現不能） |
| C. 分内 連番付与 | ✕ 並列取得で付与順が非決定的。再スクレイプで番号ずれ | △ | 低 | 却下（非冪等） |
| D. 内容ハッシュ（4人のスコア等） | ○ 但しサイト訂正やパース変更で ID が変わる | ◎ | 中 | detailURL 不可時のフォールバックとして文書化 |

**detailURL のクエリ扱い（要検証点）**: 実 URL サンプル未確認。**既定は `stripQuery` してパスをハッシュ**（session token 等の揮発パラメータで ID 不安定化を防ぐ）。implementer は実 URL を1件ログ出力して確認し、パスが試合ごとに一意でない場合のみクエリを含める（or 案D）。この判断点はテストで固定。

## 2. 変更ファイルと変更内容

### `internal/model/types.go`
- `DatedScore` に `MatchID string` を追加（detailURL 由来。同一試合の4人で共有、legacy データでは空）。
- `MatchIDFromURL(detailURL string) string` を追加（`stripQuery`→`sha256[:8]`hex）。
- `DatedScore.GroupKey() string` を追加（`MatchID != ""` なら `MatchID`、空なら `Datetime.Format(MatchKeyFormat)`）。**4箇所すべてこの1メソッドを使い共通化**。
- `MatchKeyFormat` コメントを「legacy（MatchID 未設定データ）用フォールバックキー」に更新。

### `internal/scraper/scraper.go`
- `fetchSingleDetail` で `matchID := model.MatchIDFromURL(e.detailURL)` を計算し `parseDetailPage` へ渡す。
- `parseDetailPage` 内、生成する 4 つの `DatedScore` すべてに `MatchID: matchID` をセット。

### `internal/firestore/scores.go`
- `matchDoc` に `MatchID string firestore:"match_id"` を追加。
- `groupByDatetime` を `s.GroupKey()` ベースに変更（`groupByMatch` にリネーム）。`len(entries) != 4` skip は**残す**（4人未満の不完全試合除外は正しい防御）。
- `buildMatchDoc`: `MatchID: entries[0].MatchID` をセット。
- `docsToScores`: 各プレイヤーの `ds.MatchID = md.MatchID` をセット（legacy doc は空）。
- **doc ID を新方式に**: `matchDocID(entries)` = `Datetime.Format(MatchKeyFormat)` + （`MatchID` があれば）`"_" + MatchID`。legacy（空）は従来通り suffix なし。
- `SaveScores` に `migrateLegacy bool` 引数を追加。`true` のとき各試合を新 doc ID で書くと同時に旧「分精度 doc」を BulkWriter で **Delete**（新IDと異なる場合のみ）。`false`（新規・増分）では delete しない。
- 補足: `GetLatestDatetime`/`LoadScoresAfter`/`BackfillDates` は `datetime` **フィールド**でクエリしており doc ID 変更の影響を受けない。

### `internal/pipeline/matchdata.go`
- `BuildMatchData` の grouping を `d.GroupKey()` に変更。`len(entries) != 4` skip は残す。
- `MatchData` に `MatchID string json:"match_id"` を追加し `entries[0].MatchID` をセット。

### `internal/pipeline/pipeline.go`
- `mergeScores` の dedup を **MatchID 対応**に変更（分精度 dedup を廃止）:
  - `newGroupKeys` = 新規の `GroupKey()` 集合、`newMinutes` = 新規の分精度文字列集合。
  - 既存 `e` を破棄する条件: `e.MatchID != "" && newGroupKeys[e.GroupKey()]`（精密一致で破棄）、または `e.MatchID == "" && newMinutes[e.Datetime.Format(MatchKeyFormat)]`（legacy 既存がその分の再スクレイプで置換）。
  - 「既存に同一分2試合(MatchIDあり)＋新規に1試合」でも精密一致で兄弟を保持。
- `SaveScores(...)` 呼び出しを `SaveScores(..., len(backfillDates) > 0)` に変更。

### `static/lib/db.js`
- id 生成を純粋関数 `matchRecordId(userKey, match)` に切り出し **export**: `return userKey + '_' + (match.match_id || match.date);`。
- **`MATCH_DB_VERSION` を上げ**、`onupgradeneeded` で旧 `matches` ストアを削除→再作成（stale レコード一掃）。サーバ再取得で全件復元されるため非破壊。

### ドキュメント
- `CLAUDE.md` 主要技術情報に「試合の一意キーは detailURL 由来 MatchID。分精度は legacy フォールバック」を1行追記。

## 3. テスト計画

検証: `make test`（`go test -race ./internal/...`）/ `go vet ./...` / `gofmt -l .`（差分ゼロ）/ `make test-js`。

### Go
- `internal/model/types_test.go`: `TestMatchIDFromURL`（冪等・別URL別ID・クエリ除去・16文字hex）、`TestDatedScore_GroupKey`。
- `internal/firestore/scores_test.go`（新規）: `TestGroupByMatch_SameMinuteDistinctMatchID`（**#358 核リグレッション**: 同一 Datetime・異なる MatchID の 8 エントリ→2グループ×4件）、`TestGroupByMatch_LegacyFallback`、`TestMatchDocID`。
- `internal/pipeline/matchdata_test.go`: `TestBuildMatchData_SameMinuteTwoMatches`、既存 incomplete skip 維持。
- `internal/pipeline/pipeline_test.go`: `TestMergeScores_SameMinuteMatchIDPreserved`、`TestMergeScores_LegacySupersededByRescrape`。

### JS
- `static/__tests__/db.test.js`（新規）: `matchRecordId` を import し、同一 date・異なる match_id → 異なる id（**IndexedDB 衝突リグレッション**）、match_id 欠落時は date フォールバック。

## 4. 完了条件（done-criteria）

- [ ] `DatedScore.MatchID` / `MatchIDFromURL` / `GroupKey()` を追加、scraper が 4 人全員へ同一 MatchID をセット。
- [ ] 4 箇所すべて `GroupKey()`（Go）/`match_id`（JS）ベースに統一、分精度単独 grouping/dedup が残っていない。
- [ ] Firestore doc に `match_id` を永続化し `docsToScores` で読み戻す。doc ID が同一分の別試合で衝突しない。
- [ ] `SaveScores` に `migrateLegacy` を追加、バックフィル時のみ旧 doc 削除で二重化防止。
- [ ] `MatchData.MatchID` を配信、`db.js` が `matchRecordId` を使用、`MATCH_DB_VERSION` 更新でキャッシュ再構築。
- [ ] 新規リグレッションテスト（Go/JS）が緑。
- [ ] `make test` 全緑 / `go vet` 無警告 / `gofmt -l .` 差分ゼロ / `make test-js` 全緑。既存テスト退行なし。
- [ ] CLAUDE.md に一意キー方針を1行追記。

**受け入れの本質**: 同一分に2試合ある日を「1日」指定時、両試合が集計に含まれる（欠落ゼロ）。Go/JS ユニットテストで機械的に担保。

## 5. 残課題・起票候補

- **過去に恒久ロスした試合の回復**（別 issue）: 対象日の再スクレイプ or 全件やり直し。rate-limit/破棄コストを伴うためユーザー判断。
- ナレッジ候補: 「元データが分精度しか持たず、同一分の複数試合は datetime だけでは区別不能。ゆえに detailURL 由来 MatchID を採用」。
