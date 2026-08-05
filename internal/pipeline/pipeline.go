// Package pipeline implements the analysis pipeline with job management.
package pipeline

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	fs "github.com/yuki9431/catalyzer/internal/firestore"
	"github.com/yuki9431/catalyzer/internal/gradelist"
	"github.com/yuki9431/catalyzer/internal/model"
	"github.com/yuki9431/catalyzer/internal/mslist"
	"github.com/yuki9431/catalyzer/internal/scraper"
	"github.com/yuki9431/catalyzer/internal/session"
)

// DefaultMSListPath はデフォルトのMSリストパス
const DefaultMSListPath = "data/ms_list.json"

// DefaultGradeListPath はデフォルトのグレードリストパス
const DefaultGradeListPath = "data/grade_list.json"

// prelimBatchSize はスクレイピング中に速報レポートを更新する間隔（試合数）
const prelimBatchSize = 20

// prelimFirstBatchSize は初回速報レポートを発火する試合数。
// 初回だけ早く画面を表示し、以降はprelimBatchSize間隔で更新する（分析の頻発を避ける）
const prelimFirstBatchSize = 5

// Job はバックグラウンドジョブの情報
type Job struct {
	ID                 string          `json:"id"`
	Status             model.JobStatus `json:"status"`
	Message            string          `json:"message,omitempty"`
	Progress           int             `json:"progress,omitempty"`
	ProgressTotal      int             `json:"progress_total,omitempty"`
	Report             string          `json:"report,omitempty"`
	PreliminaryReport  string          `json:"preliminary_report,omitempty"`
	PreliminaryVersion int             `json:"preliminary_version,omitempty"`
	Error              string          `json:"error,omitempty"`
	PartialData        bool            `json:"partial_data,omitempty"`
	LoggedIn           bool            `json:"logged_in,omitempty"`
	UserKey            string          `json:"-"`
	Remember           bool            `json:"-"`
	SessionToken       string          `json:"-"`
	SavedJar           http.CookieJar  `json:"-"`
	completedAt        time.Time
	ctx                context.Context    // スクレイピングのキャンセル用Context（NewJobで生成）
	cancel             context.CancelFunc // ctxのキャンセル関数。CancelJobから呼ばれる
}

// ジョブストア（インメモリ）
var (
	jobs   = make(map[string]*Job)
	jobsMu sync.RWMutex
)

// NewJob はジョブを作成してストアに登録する
func NewJob() *Job {
	ctx, cancel := context.WithCancel(context.Background())
	j := &Job{
		ID:     uuid.New().String(),
		Status: model.StatusPending,
		ctx:    ctx,
		cancel: cancel,
	}
	jobsMu.Lock()
	jobs[j.ID] = j
	jobsMu.Unlock()
	return j
}

// CancelJob は実行中のジョブのスクレイピング処理を中断する。
// 存在しない、または既に完了したジョブに対しては安全な no-op。
func CancelJob(id string) {
	jobsMu.RLock()
	j, ok := jobs[id]
	jobsMu.RUnlock()
	if ok && j.cancel != nil {
		j.cancel()
	}
}

// GetJob はIDからジョブを取得する
func GetJob(id string) (*Job, bool) {
	jobsMu.RLock()
	j, ok := jobs[id]
	jobsMu.RUnlock()
	return j, ok
}

// Snapshot はジョブ状態のスナップショットを返す
func (j *Job) Snapshot() model.JobSnapshot {
	jobsMu.RLock()
	defer jobsMu.RUnlock()
	return model.JobSnapshot{
		ID:                 j.ID,
		Status:             j.Status,
		Message:            j.Message,
		Progress:           j.Progress,
		ProgressTotal:      j.ProgressTotal,
		Report:             j.Report,
		PreliminaryReport:  j.PreliminaryReport,
		PreliminaryVersion: j.PreliminaryVersion,
		Error:              j.Error,
		PartialData:        j.PartialData,
		LoggedIn:           j.LoggedIn,
		UserKey:            j.UserKey,
	}
}

// On403Func は403検出時に呼び出されるコールバック型
type On403Func func(userHash string)

// Run はスクレイピング→分析を実行し、レポートをジョブに保存する
func Run(j *Job, username, password string, on403 ...On403Func) {
	// ジョブ完了時にContextを解放する（CancelJobがこの後呼ばれても no-op）
	if j.cancel != nil {
		defer j.cancel()
	}
	// 開始前に既にキャンセル済み（ログアウト直後など）なら何もせず中断状態にする
	if j.ctx != nil && j.ctx.Err() != nil {
		markCancelled(j)
		return
	}

	jobsMu.Lock()
	if j.UserKey == "" {
		j.UserKey = model.UserKey(username)
	}
	jobsMu.Unlock()
	updateStatus(j, model.StatusScraping)

	// MSリストから機体名・コストマッピングを読み込み
	msList, err := mslist.LoadMSList(DefaultMSListPath)
	if err != nil {
		log.Printf("[WARN] MS list not found, MS names will be empty")
	}
	msMap := mslist.BuildMSNameMap(msList)
	costsMap := mslist.BuildMSCostMap(msList)

	// Firestoreから既存scoresを読み取り
	var since time.Time
	existingScores, err := fs.LoadScores(j.UserKey)
	if err != nil {
		log.Printf("[WARN] Failed to load scores from Firestore: %v", err)
	}
	exists := len(existingScores) > 0

	if exists {
		since, err = fs.GetLatestDatetime(j.UserKey)
		if err != nil {
			log.Printf("[WARN] Failed to read latest datetime from Firestore: %v", err)
		}
		if !since.IsZero() {
			log.Printf("[INFO] Fetching scores after %s", since.Format("2006-01-02 15:04"))
		}

		// 既存データから速報マッチデータを生成
		prelimMatches := buildMatchesJSON(existingScores, costsMap)
		if prelimMatches != "" {
			jobsMu.Lock()
			j.PreliminaryReport = prelimMatches
			j.PreliminaryVersion++
			jobsMu.Unlock()
			log.Printf("[INFO] Job %s: preliminary matches ready", j.ID)
		}
	}

	// スクレイピング
	log.Printf("[INFO] Scraping for user (hash: %s)", j.UserKey)
	onProgress := func(current, total int) {
		jobsMu.Lock()
		j.Message = "戦歴データを取得中"
		j.Progress = current
		if total > j.ProgressTotal {
			j.ProgressTotal = total
		}
		jobsMu.Unlock()
	}

	// 20試合ごとに速報マッチデータを段階的に更新するコールバック
	var batchAnalysisMu sync.Mutex
	var batchWg sync.WaitGroup
	defer batchWg.Wait()
	onBatchReady := func(batchScores model.DatedScores) {
		if !batchAnalysisMu.TryLock() {
			return
		}
		batchWg.Add(1)
		go func() {
			defer batchAnalysisMu.Unlock()
			defer batchWg.Done()

			mslist.FillMsNames(batchScores, msMap)
			merged := mergeScores(existingScores, batchScores)

			matches := buildMatchesJSON(merged, costsMap)
			if matches != "" {
				jobsMu.Lock()
				j.PreliminaryReport = matches
				j.PreliminaryVersion++
				jobsMu.Unlock()
				log.Printf("[INFO] Job %s: incremental preliminary matches ready (%d scores)", j.ID, len(merged))
			}
		}()
	}

	scrapingOpt := scraper.ScrapingOption{
		OnProgress:     onProgress,
		OnBatchReady:   onBatchReady,
		BatchSize:      prelimBatchSize,
		FirstBatchSize: prelimFirstBatchSize,
		OnLoginSuccess: func() {
			jobsMu.Lock()
			j.LoggedIn = true
			jobsMu.Unlock()
			log.Printf("[INFO] Job %s: login succeeded", j.ID)
		},
		SavedJar: j.SavedJar,
		Context:  j.ctx,
	}

	var datedScores model.DatedScores
	var jar http.CookieJar
	usingSession := j.SavedJar != nil

	datedScores, jar, err = scraper.ScrapingWithOption(username, password, since, scrapingOpt)
	// ログアウト等でキャンセルされた場合は、途中データやセッションを一切保存せず中断する。
	// スクレイピングが成功して返った直後や、ログイン/日別ページ収集の早期エラーが
	// ログアウトと競合した場合でも、ctxがキャンセル済みなら error/403 と誤判定せず中断する
	// （セッション再保存や403ブロックの誤発動を防ぐ）
	if errors.Is(err, scraper.ErrCanceled) || (j.ctx != nil && j.ctx.Err() != nil) {
		markCancelled(j)
		return
	}
	// 403の場合でも途中データがあれば保存・分析を続行する
	is403WithPartialData := errors.Is(err, scraper.ErrAccessDenied) && len(datedScores) > 0
	if err != nil && !is403WithPartialData {
		// 保存済みセッション使用時にスクレイピング失敗 → セッション削除
		if usingSession && j.SessionToken != "" {
			if delErr := fs.DeleteSession(j.SessionToken); delErr != nil {
				log.Printf("[WARN] Failed to delete expired session: %v", delErr)
			}
		}
		switch {
		case errors.Is(err, scraper.ErrLoginFailed):
			if usingSession {
				setError(j, "セッションの有効期限が切れました。再度ログインしてください。", err.Error())
			} else {
				setError(j, "ログインに失敗しました。メールアドレスとパスワードを確認してください。", err.Error())
			}
		case errors.Is(err, scraper.ErrAccessDenied):
			if usingSession {
				setError(j, "セッションの有効期限が切れました。再度ログインしてください。", err.Error())
			} else {
				setError(j, "対戦履歴ページへのアクセスが拒否されました。ブラウザからガンダムモバイル(https://web.vsmobile.jp)にログインし、対戦履歴が閲覧できるか確認してください。", err.Error())
				if len(on403) > 0 && on403[0] != nil {
					on403[0](j.UserKey)
				}
			}
		case errors.Is(err, scraper.ErrUnauthorized):
			setError(j, "認証の有効期限が切れました。再度ログインしてお試しください。", err.Error())
		case errors.Is(err, scraper.ErrNotFound):
			setError(j, "対戦履歴ページが見つかりませんでした。サイトの仕様が変更された可能性があります。", err.Error())
		case errors.Is(err, scraper.ErrServerError):
			setError(j, "ガンダムモバイルのサーバーでエラーが発生しています。しばらく時間をおいてから再度お試しください。", err.Error())
		default:
			setError(j, "データの取得に失敗しました。時間をおいて再度お試しいただき、解決しない場合は開発者までお問い合わせください。", err.Error())
		}
		return
	}
	if is403WithPartialData {
		log.Printf("[WARN] Job %s: 403 occurred but %d partial scores available, saving partial data", j.ID, len(datedScores))
		if len(on403) > 0 && on403[0] != nil {
			on403[0](j.UserKey)
		}
	}

	// remember=true でログイン成功時、CookieJarを暗号化してFirestoreに保存
	if j.Remember && jar != nil && session.Enabled() && j.SessionToken != "" {
		go func() {
			jarData, sessErr := session.SerializeJar(jar)
			if sessErr != nil {
				log.Printf("[WARN] Failed to serialize CookieJar: %v", sessErr)
				return
			}
			encData, sessErr := session.Encrypt(jarData)
			if sessErr != nil {
				log.Printf("[WARN] Failed to encrypt CookieJar: %v", sessErr)
				return
			}
			if sessErr = fs.SaveSession(j.SessionToken, j.UserKey, encData); sessErr != nil {
				log.Printf("[WARN] Failed to save session: %v", sessErr)
			}
		}()
	}
	if len(datedScores) == 0 && !exists {
		setError(j, "戦績データが見つかりませんでした", "no scores found")
		return
	}

	// 新規データがない場合はタッグ情報を保存して完了
	if len(datedScores) == 0 && j.PreliminaryReport != "" {
		tagPartners := scraper.ScrapeTagPartners(jar)
		if len(tagPartners) > 0 {
			log.Printf("[INFO] Found %d tag partners (no new data path)", len(tagPartners))
			fs.SaveTagPartners(j.UserKey, tagPartners)
		}

		matchesJSON := buildMatchesJSON(existingScores, costsMap)
		if matchesJSON == "" {
			matchesJSON = j.PreliminaryReport
		}

		jobsMu.Lock()
		j.Status = model.StatusDone
		j.Report = matchesJSON
		j.completedAt = time.Now()
		jobsMu.Unlock()
		log.Printf("[INFO] Job %s completed (no new data)", j.ID)
		return
	}

	mslist.FillMsNames(datedScores, msMap)
	mslist.CheckUnknownMS(datedScores)

	// グレードリストから未知のグレード画像URLを検出
	gradeList, err := gradelist.LoadGradeList(DefaultGradeListPath)
	if err != nil {
		log.Printf("[WARN] Grade list not found: %v", err)
	} else {
		gradeMap := gradelist.BuildGradeMap(gradeList)
		gradelist.CheckUnknownGrades(datedScores, gradeMap)
	}

	// Firestoreにscoresを書き込み
	fs.SaveScores(j.UserKey, datedScores)

	// 既存 + 新規をメモリ上でマージ（Firestoreの再読み取りを省略）
	allScores := mergeScores(existingScores, datedScores)

	// タッグ相方名を取得（403途中保存時はスキップ）
	if !is403WithPartialData {
		tagPartners := scraper.ScrapeTagPartners(jar)
		if len(tagPartners) > 0 {
			log.Printf("[INFO] Found %d tag partners", len(tagPartners))
			fs.SaveTagPartners(j.UserKey, tagPartners)
		}
	}

	// マッチデータJSON生成
	matchesJSON := buildMatchesJSON(allScores, costsMap)
	if matchesJSON == "" {
		setError(j, "分析処理に失敗しました", "failed to build matches JSON")
		return
	}

	jobsMu.Lock()
	j.Status = model.StatusDone
	j.Report = matchesJSON
	j.PartialData = is403WithPartialData
	j.completedAt = time.Now()
	jobsMu.Unlock()
	if is403WithPartialData {
		log.Printf("[INFO] Job %s completed with partial data (403 during scraping)", j.ID)
	} else {
		log.Printf("[INFO] Job %s completed", j.ID)
	}
}

// buildMatchesJSON はDatedScoresをフロントエンド向けのMatchData JSONに変換する。
// 失敗時は空文字を返す。
func buildMatchesJSON(scores model.DatedScores, costsMap map[string]int) string {
	matches := BuildMatchData(scores, costsMap, time.Time{})
	data, err := json.Marshal(matches)
	if err != nil {
		log.Printf("[WARN] Failed to marshal matches: %v", err)
		return ""
	}
	return string(data)
}

func updateStatus(j *Job, s model.JobStatus) {
	jobsMu.Lock()
	j.Status = s
	jobsMu.Unlock()
}

// markCancelled はジョブをキャンセル状態にする（ログアウト等でスクレイピングを中断したとき）
func markCancelled(j *Job) {
	jobsMu.Lock()
	j.Status = model.StatusCancelled
	j.completedAt = time.Now()
	jobsMu.Unlock()
	log.Printf("[INFO] Job %s cancelled by user", j.ID)
}

func setError(j *Job, clientMsg, detail string) {
	jobsMu.Lock()
	j.Status = model.StatusError
	j.Error = clientMsg
	j.completedAt = time.Now()
	jobsMu.Unlock()
	log.Printf("[ERROR] Job %s failed: %s", j.ID, detail)
}

// CleanupJobs は完了済みジョブを定期的に削除する
func CleanupJobs(ttl time.Duration) {
	ticker := time.NewTicker(ttl)
	defer ticker.Stop()
	for range ticker.C {
		jobsMu.Lock()
		before := len(jobs)
		for id, j := range jobs {
			if !j.completedAt.IsZero() && time.Since(j.completedAt) > ttl {
				delete(jobs, id)
			}
		}
		after := len(jobs)
		jobsMu.Unlock()
		if before != after {
			log.Printf("[INFO] Job cleanup: %d -> %d jobs", before, after)
		}
	}
}

// mergeScores は既存のscoresに新規scoresをマージする。
// バックフィル時に同じ試合のレコードがある場合は新規側で上書きする。
// #358: 分精度dedupは同一分の別試合まで巻き添えで破棄してしまうため、MatchID対応にしている。
// 既存にMatchIDがあれば精密一致（GroupKey）でのみ破棄し、同一分の兄弟試合は保持する。
// 既存がlegacy（MatchID未設定）なら、その分が新規側で再スクレイプされた場合にのみ置換する。
func mergeScores(existing, newScores model.DatedScores) model.DatedScores {
	newGroupKeys := make(map[string]bool)
	newMinutes := make(map[string]bool)
	for _, s := range newScores {
		newGroupKeys[s.GroupKey()] = true
		newMinutes[s.Datetime.Format(model.MatchKeyFormat)] = true
	}

	merged := make(model.DatedScores, 0, len(existing)+len(newScores))
	for _, s := range existing {
		if s.MatchID != "" {
			if newGroupKeys[s.GroupKey()] {
				continue
			}
		} else if newMinutes[s.Datetime.Format(model.MatchKeyFormat)] {
			continue
		}
		merged = append(merged, s)
	}
	merged = append(merged, newScores...)

	sort.Slice(merged, func(i, j int) bool {
		return merged[i].Datetime.Before(merged[j].Datetime)
	})
	return merged
}
