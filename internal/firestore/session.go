package firestore

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// sessionTTL はセッションドキュメントの有効期間。Cookie の MaxAge（server.sessionMaxAge = 30日）
// と揃える。SaveSession が expire_at に now+sessionTTL を書き、Firestore の TTL ポリシー
// （infra/shared/firestore.ts の sessions.expire_at）が期限到来後に浮いたドキュメントを
// 自動削除する。TTL の削除時刻はフィールド値そのものなので ServerTimestamp は使えない。
const sessionTTL = 30 * 24 * time.Hour

// SaveSession は暗号化されたCookieJarをFirestoreに保存する。
// token はセッション識別子（ランダムUUID）、userKey はユーザー識別子。
func SaveSession(token, userKey string, encryptedJar []byte) error {
	c := getClient()
	if c == nil {
		return fmt.Errorf("firestore client not initialized")
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	ref := c.Collection("sessions").Doc(token)
	_, err := ref.Set(ctx, map[string]interface{}{
		"user_key":   userKey,
		"jar":        base64.StdEncoding.EncodeToString(encryptedJar),
		"updated_at": firestore.ServerTimestamp,
		"expire_at":  time.Now().Add(sessionTTL),
	})
	if err != nil {
		return fmt.Errorf("save session: %w", err)
	}

	log.Printf("[INFO] Firestore: saved session for user %s", userKey)
	return nil
}

// LoadSession はFirestoreからセッション情報を読み取る。
// 存在しない場合はuserKey=""、jar=nilを返す。
func LoadSession(token string) (userKey string, encryptedJar []byte, err error) {
	c := getClient()
	if c == nil {
		return "", nil, fmt.Errorf("firestore client not initialized")
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	ref := c.Collection("sessions").Doc(token)
	doc, err := ref.Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return "", nil, nil
		}
		return "", nil, fmt.Errorf("get session: %w", err)
	}

	data := doc.Data()
	uk, _ := data["user_key"].(string)
	jarStr, _ := data["jar"].(string)
	if uk == "" || jarStr == "" {
		return "", nil, nil
	}

	jarBytes, err := base64.StdEncoding.DecodeString(jarStr)
	if err != nil {
		return "", nil, fmt.Errorf("decode jar: %w", err)
	}

	return uk, jarBytes, nil
}

// DeleteSession はFirestoreからセッション情報を削除する。
func DeleteSession(token string) error {
	c := getClient()
	if c == nil {
		return fmt.Errorf("firestore client not initialized")
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	ref := c.Collection("sessions").Doc(token)
	_, err := ref.Delete(ctx)
	if err != nil {
		return fmt.Errorf("delete session: %w", err)
	}

	log.Printf("[INFO] Firestore: deleted session (token: %s...)", token[:8])
	return nil
}
