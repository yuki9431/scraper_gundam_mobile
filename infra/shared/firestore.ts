import * as gcp from "@pulumi/gcp";
import { services } from "./apis";

// Firestoreデータベース（Native mode）
export const firestoreDb = new gcp.firestore.Database(
  "firestore-db",
  {
    name: "exvs-analyzer",
    locationId: gcp.config.region!,
    type: "FIRESTORE_NATIVE",
  },
  { dependsOn: services }
);

// sessions コレクションの TTL ポリシー。
// アプリが SaveSession 時に書く expire_at（失効時刻 = 保存時 + 30日）を対象にし、
// 到来後 GCP が浮いたセッションドキュメントを自動削除する（通常24時間以内）。
// Cookie 失効後もログアウト・再分析が起きず残り続けるドキュメントの掃除が目的（issue #368）。
// ttlConfig は空オブジェクトで有効化（フィールド値そのものが削除時刻）。
// indexConfig: {} で single-field インデックスを無効化し、TTL タイムスタンプ列の
// ホットスポットを回避する（Firestore 公式推奨。expire_at で検索しないため実害なし）。
export const sessionTtlField = new gcp.firestore.Field(
  "session-expire-at-ttl",
  {
    database: firestoreDb.name,
    collection: "sessions",
    field: "expire_at",
    ttlConfig: {},
    indexConfig: {},
  },
  { dependsOn: [firestoreDb] }
);
