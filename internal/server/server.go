// Package server provides the HTTP server and API handlers.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"mime"
	"net/http"
	"net/mail"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/yuki9431/catalyzer/internal/firestore"
	"github.com/yuki9431/catalyzer/internal/model"
	"github.com/yuki9431/catalyzer/internal/mslist"
	"github.com/yuki9431/catalyzer/internal/pipeline"
	"github.com/yuki9431/catalyzer/internal/session"
	"golang.org/x/time/rate"
)

const sessionCookieName = "catalyzer_session"
const sessionMaxAge = 30 * 24 * 60 * 60 // 30 days

type analyzeRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Remember bool   `json:"remember"`
}

var requestLimiter = make(chan struct{}, 3)

// StartServer はHTTPサーバーを起動する
func StartServer() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Firestore初期化（FIRESTORE_DATABASE未設定時はスキップ）
	if os.Getenv("FIRESTORE_DATABASE") != "" {
		var err error
		if p := os.Getenv("GOOGLE_CLOUD_PROJECT"); p != "" {
			err = firestore.InitWithProjectID(context.Background(), p)
		} else {
			err = firestore.Init(context.Background())
		}
		if err != nil {
			log.Printf("[WARN] Firestore initialization failed, continuing without Firestore: %v", err)
		} else {
			defer func() {
				if cerr := firestore.Close(); cerr != nil {
					log.Printf("[WARN] Firestore close error: %v", cerr)
				}
			}()
		}
	} else {
		log.Printf("[INFO] FIRESTORE_DATABASE not set, Firestore disabled")
	}

	// 完了済みジョブの定期クリーンアップ（1時間経過したジョブを削除）
	go pipeline.CleanupJobs(1 * time.Hour)

	// レート制限の設定（RATE_LIMIT環境変数: 1時間あたりの最大リクエスト数、0または未設定で無制限）
	var rl *rateLimiter
	if v := os.Getenv("RATE_LIMIT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			// n回/時間 = n/3600回/秒、バーストはnと同じ
			rl = newRateLimiter(rate.Limit(float64(n)/3600), n)
			log.Printf("[INFO] Rate limit enabled: %d requests/hour per IP", n)
		}
	}

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprint(w, "ok")
	})

	// POST /analyze → ジョブ作成、IDを返す
	http.HandleFunc("/analyze", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// レート制限チェック
		if rl != nil {
			ip := clientIP(r)
			if !rl.getLimiter(ip).Allow() {
				sendJSON(w, http.StatusTooManyRequests, map[string]string{"error": "リクエスト回数の上限に達しました。しばらく時間をおいてから再度お試しください"})
				return
			}
		}

		// リクエストボディサイズを1KBに制限
		r.Body = http.MaxBytesReader(w, r.Body, 1024)

		var req analyzeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			sendJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
			return
		}

		if req.Username == "" || req.Password == "" {
			sendJSON(w, http.StatusBadRequest, map[string]string{"error": "Username and password are required"})
			return
		}

		// メールアドレス形式チェック
		if _, err := mail.ParseAddress(req.Username); err != nil {
			sendJSON(w, http.StatusBadRequest, map[string]string{"error": "有効なメールアドレスを入力してください"})
			return
		}

		// 入力長の制限（メールアドレス: RFC 5321準拠254文字、パスワード: 128文字）
		if len(req.Username) > 254 || len(req.Password) > 128 {
			sendJSON(w, http.StatusBadRequest, map[string]string{"error": "Username or password is too long"})
			return
		}

		// 403ブロックチェック
		userHash := model.UserKey(req.Username)
		if forbidden403.IsBlocked(userHash) {
			sendJSON(w, http.StatusTooManyRequests, map[string]string{"error": "対戦履歴ページへのアクセスが拒否されました。ブラウザからガンダムモバイル(https://web.vsmobile.jp)にログインし、対戦履歴が閲覧できるか確認してください。"})
			return
		}

		// 同時実行数制限
		select {
		case requestLimiter <- struct{}{}:
		default:
			sendJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Server is busy, please try again later"})
			return
		}

		// ジョブ作成
		j := pipeline.NewJob()

		// remember=true かつセッション暗号化が有効な場合、セッショントークンを生成
		if req.Remember && session.Enabled() {
			j.Remember = true
			j.SessionToken = uuid.New().String()
		}

		// バックグラウンドで実行
		go func() {
			defer func() { <-requestLimiter }()
			pipeline.Run(j, req.Username, req.Password, forbidden403.Block)
		}()

		sendJSON(w, http.StatusAccepted, map[string]string{"id": j.ID})
	})

	// GET /status/{id} → ジョブ状態を返す
	http.HandleFunc("/status/", func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Path[len("/status/"):]

		j, ok := pipeline.GetJob(id)
		if !ok {
			sendJSON(w, http.StatusNotFound, map[string]string{"error": "Job not found"})
			return
		}

		snap := j.Snapshot()
		resp := map[string]interface{}{
			"id":     snap.ID,
			"status": string(snap.Status),
		}
		if snap.Message != "" {
			resp["message"] = snap.Message
		}
		if snap.Progress > 0 {
			resp["progress"] = snap.Progress
		}
		// 総数はPhase2確定後のみ。0の間はフロントが不定表示にする
		if snap.ProgressTotal > 0 {
			resp["progress_total"] = snap.ProgressTotal
		}
		if snap.Error != "" {
			resp["error"] = snap.Error
		}
		if snap.LoggedIn {
			resp["logged_in"] = true
		}
		if snap.PreliminaryReport != "" {
			resp["has_preliminary_report"] = true
			resp["preliminary_version"] = snap.PreliminaryVersion
		}

		sendJSON(w, http.StatusOK, resp)
	})

	// POST /cancel/{id} → 実行中のジョブ（スクレイピング）を中断する（ログアウト時などに使用）
	http.HandleFunc("/cancel/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		id := r.URL.Path[len("/cancel/"):]
		if id == "" {
			sendJSON(w, http.StatusBadRequest, map[string]string{"error": "Job id is required"})
			return
		}
		pipeline.CancelJob(id)
		sendJSON(w, http.StatusOK, map[string]string{"ok": "true"})
	})

	// GET /result/{id} → 分析結果(JSON)を返す
	http.HandleFunc("/result/", func(w http.ResponseWriter, r *http.Request) {
		handleResult(w, r, r.URL.Path[len("/result/"):])
	})

	// GET /tag-partners?user_key=... → タッグ相方情報
	http.HandleFunc("/tag-partners", func(w http.ResponseWriter, r *http.Request) {
		handleTagPartners(w, r)
	})

	// GET /matches?user_key=...&after=... → 試合データ配信（IndexedDBキャッシュ用）
	http.HandleFunc("/matches", func(w http.ResponseWriter, r *http.Request) {
		handleMatches(w, r)
	})

	// GET /ms-list → MSリスト（機体名→画像URL）を配信。
	// フロントの試合検索一覧が機体名から公式CDNのサムネイル画像を解決するために使う。
	// 起動時に一度だけ読み込む（静的データ。失敗時は空を返し、フロントは機体名テキストにフォールバック）。
	msList, mserr := mslist.LoadMSList(pipeline.DefaultMSListPath)
	if mserr != nil {
		log.Printf("[WARN] Failed to load MS list for /ms-list: %v", mserr)
		msList = []model.MSInfo{}
	}
	http.HandleFunc("/ms-list", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=3600")
		sendJSON(w, http.StatusOK, msList)
	})

	// GET /session → セッションの有効性チェック（キャッシュレポート付き）
	http.HandleFunc("/session", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			handleSessionCheck(w, r)
		case http.MethodDelete:
			handleSessionDelete(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// POST /reanalyze → 保存済みセッションで再分析
	http.HandleFunc("/reanalyze", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		handleReanalyze(w, r, rl)
	})

	// 静的ファイル（フロントエンド）
	// .webmanifest はGo組み込みのMIMEテーブルに無く、実行環境(alpine)に
	// /etc/mime.types も無いため、PWA仕様が要求するContent-Typeを明示登録する
	if err := mime.AddExtensionType(".webmanifest", "application/manifest+json"); err != nil {
		log.Printf("[WARN] Failed to register webmanifest MIME type: %v", err)
	}
	fs := http.FileServer(http.Dir("static"))
	http.Handle("/", staticCacheControl(fs))

	log.Printf("[INFO] Server starting on port %s", port)
	handler := basicAuth(securityHeaders(http.DefaultServeMux), "/health")
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatalf("[ERROR] Server failed: %v", err)
	}
}

func handleResult(w http.ResponseWriter, r *http.Request, id string) {
	j, ok := pipeline.GetJob(id)
	if !ok {
		sendJSON(w, http.StatusNotFound, map[string]string{"error": "Job not found"})
		return
	}

	snap := j.Snapshot()

	// キャンセル済み（ログアウト等で中断）は結果がない終端状態。ポーラーが確定応答を得られるようにする
	if snap.Status == model.StatusCancelled {
		sendJSON(w, http.StatusOK, map[string]string{"status": string(model.StatusCancelled)})
		return
	}

	if snap.Status != model.StatusDone && snap.Status != model.StatusError {
		if snap.PreliminaryReport != "" {
			sendMatchesResponse(w, http.StatusOK, snap.PreliminaryReport, string(snap.Status), snap.UserKey, true)
			return
		}
		sendJSON(w, http.StatusAccepted, map[string]string{"status": string(snap.Status)})
		return
	}

	if snap.Status == model.StatusError {
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": snap.Error})
		return
	}

	sessionSaved := j.Remember && j.SessionToken != ""
	if sessionSaved {
		setSessionCookie(w, j.SessionToken)
	}

	resp := matchesResponse{
		Matches:      json.RawMessage(snap.Report),
		UserKey:      snap.UserKey,
		Partial:      snap.PartialData,
		SessionSaved: sessionSaved,
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

func handleTagPartners(w http.ResponseWriter, r *http.Request) {
	userKey := r.URL.Query().Get("user_key")
	if userKey == "" {
		sendJSON(w, http.StatusBadRequest, map[string]string{"error": "user_key parameter is required"})
		return
	}

	partners, err := firestore.LoadTagPartners(userKey)
	if err != nil {
		log.Printf("[ERROR] Failed to load tag partners: %v", err)
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": "タッグ相方情報の取得に失敗しました"})
		return
	}

	type partnerJSON struct {
		TeamName   string `json:"team_name"`
		PlayerName string `json:"player_name"`
	}
	result := make([]partnerJSON, len(partners))
	for i, p := range partners {
		result[i] = partnerJSON{TeamName: p.TeamName, PlayerName: p.PlayerName}
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"tag_partners": result,
	})
}

func handleMatches(w http.ResponseWriter, r *http.Request) {
	userKey := r.URL.Query().Get("user_key")
	if userKey == "" {
		sendJSON(w, http.StatusBadRequest, map[string]string{"error": "user_key parameter is required"})
		return
	}

	var after time.Time
	if afterStr := r.URL.Query().Get("after"); afterStr != "" {
		const layout = "2006-01-02 15:04"
		var err error
		after, err = time.Parse(layout, afterStr)
		if err != nil {
			sendJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid after datetime format (expected: YYYY-MM-DD HH:MM)"})
			return
		}
	}

	matches, err := pipeline.GetMatchData(userKey, after)
	if err != nil {
		log.Printf("[ERROR] Failed to get match data: %v", err)
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": "試合データの取得に失敗しました"})
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"matches": matches,
		"total":   len(matches),
	})
}

// securityHeaders は全レスポンスにセキュリティヘッダーを付与する
// staticCacheControl は HTML/JS を常に再検証（no-cache）させる。
// アセットにバージョニングが無いため、デプロイ直後にブラウザが古いHTMLと新しいJS
// （またはその逆）を混在してキャッシュし、レイアウトが崩れるのを防ぐ。FileServer の
// Last-Modified / If-Modified-Since により実体が変わらなければ 304 で返るため負荷は小さい。
// 画像や webmanifest 等は変更頻度が低くヒューリスティックキャッシュで問題ないため対象外。
func staticCacheControl(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if p == "/" || strings.HasSuffix(p, ".html") || strings.HasSuffix(p, ".js") {
			w.Header().Set("Cache-Control", "no-cache")
		}
		next.ServeHTTP(w, r)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		// img-src に公式リソースCDNを許可（試合検索一覧で機体サムネイル画像を表示するため。画像のみ）
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://resource.exvs2ib.vsmobile.jp")
		w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		next.ServeHTTP(w, r)
	})
}

func sendJSON(w http.ResponseWriter, code int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(data)
}

type matchesResponse struct {
	Matches      json.RawMessage `json:"matches"`
	Status       string          `json:"status,omitempty"`
	Preliminary  bool            `json:"preliminary,omitempty"`
	Partial      bool            `json:"partial,omitempty"`
	UserKey      string          `json:"user_key,omitempty"`
	SessionSaved bool            `json:"session_saved,omitempty"`
}

func sendMatchesResponse(w http.ResponseWriter, code int, matchesJSON, status, userKey string, preliminary bool) {
	resp := matchesResponse{
		Matches:     json.RawMessage(matchesJSON),
		Status:      status,
		Preliminary: preliminary,
		UserKey:     userKey,
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(resp)
}

func setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   sessionMaxAge,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
}

func getSessionToken(r *http.Request) string {
	c, err := r.Cookie(sessionCookieName)
	if err != nil {
		return ""
	}
	return c.Value
}

// handleSessionCheck はセッションの有効性を確認し、キャッシュ済みレポートを返す
func handleSessionCheck(w http.ResponseWriter, r *http.Request) {
	token := getSessionToken(r)
	if token == "" {
		sendJSON(w, http.StatusOK, map[string]interface{}{"valid": false})
		return
	}

	userKey, encJar, err := firestore.LoadSession(token)
	if err != nil {
		log.Printf("[WARN] Failed to load session: %v", err)
		sendJSON(w, http.StatusOK, map[string]interface{}{"valid": false})
		return
	}
	if userKey == "" || encJar == nil {
		sendJSON(w, http.StatusOK, map[string]interface{}{"valid": false})
		return
	}

	// jarが復号可能か検証（鍵ローテーション後に無効なセッションを検出）
	if _, decErr := session.Decrypt(encJar); decErr != nil {
		log.Printf("[WARN] Session jar undecryptable, invalidating: %v", decErr)
		_ = firestore.DeleteSession(token)
		sendJSON(w, http.StatusOK, map[string]interface{}{"valid": false})
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"valid":    true,
		"user_key": userKey,
	})
}

// handleSessionDelete はセッションを削除する（ログアウト）
func handleSessionDelete(w http.ResponseWriter, r *http.Request) {
	token := getSessionToken(r)
	if token == "" {
		sendJSON(w, http.StatusOK, map[string]string{"ok": "true"})
		return
	}

	if err := firestore.DeleteSession(token); err != nil {
		log.Printf("[WARN] Failed to delete session: %v", err)
	}

	clearSessionCookie(w)
	sendJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

// handleReanalyze は保存済みセッションを使って再分析を実行する
func handleReanalyze(w http.ResponseWriter, r *http.Request, rl *rateLimiter) {
	token := getSessionToken(r)
	if token == "" {
		sendJSON(w, http.StatusUnauthorized, map[string]string{"error": "セッションが見つかりません。再度ログインしてください。"})
		return
	}

	// レート制限チェック
	if rl != nil {
		ip := clientIP(r)
		if !rl.getLimiter(ip).Allow() {
			sendJSON(w, http.StatusTooManyRequests, map[string]string{"error": "リクエスト回数の上限に達しました。しばらく時間をおいてから再度お試しください"})
			return
		}
	}

	// Firestoreからセッションを読み込み
	userKey, encJar, err := firestore.LoadSession(token)
	if err != nil {
		log.Printf("[WARN] Failed to load session for reanalyze: %v", err)
		clearSessionCookie(w)
		sendJSON(w, http.StatusUnauthorized, map[string]string{"error": "セッションの読み込みに失敗しました。再度ログインしてください。"})
		return
	}
	if userKey == "" || encJar == nil {
		clearSessionCookie(w)
		sendJSON(w, http.StatusUnauthorized, map[string]string{"error": "セッションの有効期限が切れました。再度ログインしてください。"})
		return
	}

	// CookieJarを復号
	jarData, err := session.Decrypt(encJar)
	if err != nil {
		log.Printf("[WARN] Failed to decrypt session jar: %v", err)
		_ = firestore.DeleteSession(token)
		clearSessionCookie(w)
		sendJSON(w, http.StatusUnauthorized, map[string]string{"error": "セッションの復号に失敗しました。再度ログインしてください。"})
		return
	}

	jar, err := session.DeserializeJar(jarData)
	if err != nil {
		log.Printf("[WARN] Failed to deserialize session jar: %v", err)
		_ = firestore.DeleteSession(token)
		clearSessionCookie(w)
		sendJSON(w, http.StatusUnauthorized, map[string]string{"error": "セッションの復元に失敗しました。再度ログインしてください。"})
		return
	}

	// 403ブロックチェック
	if forbidden403.IsBlocked(userKey) {
		sendJSON(w, http.StatusTooManyRequests, map[string]string{"error": "対戦履歴ページへのアクセスが拒否されました。しばらく時間をおいてから再度お試しください。"})
		return
	}

	// 同時実行数制限
	select {
	case requestLimiter <- struct{}{}:
	default:
		sendJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Server is busy, please try again later"})
		return
	}

	j := pipeline.NewJob()
	j.UserKey = userKey
	j.SavedJar = jar
	j.SessionToken = token
	j.Remember = true

	go func() {
		defer func() { <-requestLimiter }()
		pipeline.Run(j, "", "", forbidden403.Block)
	}()

	sendJSON(w, http.StatusAccepted, map[string]string{"id": j.ID})
}
