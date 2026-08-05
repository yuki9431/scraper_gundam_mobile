// Package scraper implements web scraping for game stats and authentication.
package scraper

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/gocolly/colly/v2"
	"github.com/yuki9431/catalyzer/internal/model"
)

const (
	vsmobile         = "web.vsmobile.jp"
	mobileRankpage   = "https://web.vsmobile.jp/exvs2ib/results/classmatch/fight"
	mobileTagPage    = "https://web.vsmobile.jp/exvs2ib/results/classmatch/tag"
	mobileMSUsedRate = "https://web.vsmobile.jp/exvs2ib/ranking/ms_used_rate"

	// 詳細取得は二段ペーシング: 先頭のバースト区間を並列・無遅延で高速取得し、
	// 速報レポートを早く表示する。以降はスロットル区間として直列＋待機でレート制限(403)を回避する。

	// defaultBurstCount はバースト区間で高速取得する先頭リクエスト数の既定値
	defaultBurstCount = 100

	// defaultBurstParallelism はバースト区間の最大同時リクエスト数の既定値
	defaultBurstParallelism = 3

	// defaultThrottleDelay はスロットル区間でのリクエスト完了後の待機時間の既定値
	defaultThrottleDelay = 900 * time.Millisecond

	// entryRequestDelay は日別ページ収集フェーズでのリクエスト完了後の待機時間
	entryRequestDelay = 300 * time.Millisecond
)

// burstCount は env SCRAPER_BURST_COUNT で上書き可能なバースト区間の件数（0でバースト無効）
func burstCount() int {
	if v, err := strconv.Atoi(os.Getenv("SCRAPER_BURST_COUNT")); err == nil && v >= 0 {
		return v
	}
	return defaultBurstCount
}

// burstParallelism は env SCRAPER_BURST_PARALLELISM で上書き可能なバースト区間の最大同時リクエスト数
func burstParallelism() int {
	if v, err := strconv.Atoi(os.Getenv("SCRAPER_BURST_PARALLELISM")); err == nil && v > 0 {
		return v
	}
	return defaultBurstParallelism
}

// throttleDelay は env SCRAPER_THROTTLE_DELAY_MS で上書き可能なスロットル区間の完了後待機時間
func throttleDelay() time.Duration {
	if v, err := strconv.Atoi(os.Getenv("SCRAPER_THROTTLE_DELAY_MS")); err == nil && v >= 0 {
		return time.Duration(v) * time.Millisecond
	}
	return defaultThrottleDelay
}

// maxDetail は env SCRAPER_MAX_DETAIL で指定する詳細取得件数の上限（0=無制限）
func maxDetail() int {
	if v, err := strconv.Atoi(os.Getenv("SCRAPER_MAX_DETAIL")); err == nil && v > 0 {
		return v
	}
	return 0
}

// ErrAccessDenied はサーバーからアクセス拒否(403)された場合のエラー
var ErrAccessDenied = errors.New("サーバーからアクセスが拒否されました")

// ErrUnauthorized はサーバーから認証拒否(401)された場合のエラー
var ErrUnauthorized = errors.New("認証が無効です")

// ErrServerError はサーバー内部エラー(5xx)の場合のエラー
var ErrServerError = errors.New("サーバーでエラーが発生しています")

// ErrNotFound はページが見つからない(404)場合のエラー
var ErrNotFound = errors.New("ページが見つかりません")

// ErrHTTPRequestFailed はHTTPリクエストが失敗した場合のエラー
var ErrHTTPRequestFailed = errors.New("データ取得中にHTTPエラーが発生しました")

// ErrCanceled は呼び出し元のContextキャンセル（ログアウト等）で処理を中断した場合のエラー
var ErrCanceled = errors.New("処理がキャンセルされました")

// dailyLink はrankpageから収集した日別ページ情報
type dailyLink struct {
	date     string
	url      string
	shopName string // プレイ店舗名
}

// matchEntry は日別ページから収集した試合情報
type matchEntry struct {
	date      string
	hour      string
	wins      []bool
	detailURL string
	shopName  string // プレイ店舗名（dailyLinkから引き継ぎ）
}

// stripQueryParam はURLからクエリパラメータを除去する
func stripQueryParam(rawURL string) string {
	if idx := strings.Index(rawURL, "?"); idx >= 0 {
		return rawURL[:idx]
	}
	return rawURL
}

func parseNumber(s string) int {
	re := regexp.MustCompile(`[\d,]+`)
	m := re.FindString(s)
	if m == "" {
		return 0
	}
	m = strings.ReplaceAll(m, ",", "")
	v, _ := strconv.Atoi(m)
	return v
}

// ProgressFunc はスクレイピングの進捗を通知するコールバック型
type ProgressFunc func(current, total int)

// ScrapingOption はスクレイピングのオプション
type ScrapingOption struct {
	OnProgress     ProgressFunc
	OnBatchReady   func(scores model.DatedScores) // BatchSize試合ごとに蓄積スコアのスナップショットを通知
	BatchSize      int                            // OnBatchReady発火間隔（試合数）。0の場合は通知しない
	FirstBatchSize int                            // 初回OnBatchReadyを発火する試合数。0でBatchSizeと同じ。初回だけ早めに速報を出す用途
	OnLoginSuccess func()                         // ログイン成功直後に1度だけ呼ばれる
	SavedJar       http.CookieJar                 // 保存済みCookieJar。非nilの場合はログインをスキップ
	Context        context.Context                // 呼び出し元のContext。キャンセルでスクレイピングを中断する。nilならBackground
}

// Scraping はスクレイピング処理を実行し、DatedScoresとログイン済みCookieJarを返す
// 日別ページ収集と詳細ページ取得をパイプラインで並行実行し、高速化を図る
func Scraping(username, password string, since time.Time, onProgress ...ProgressFunc) (model.DatedScores, http.CookieJar, error) {
	return ScrapingWithOption(username, password, since, ScrapingOption{
		OnProgress: firstOrNil(onProgress),
	})
}

func firstOrNil(fns []ProgressFunc) ProgressFunc {
	if len(fns) > 0 {
		return fns[0]
	}
	return nil
}

// ScrapingWithOption はオプション付きでスクレイピング処理を実行する
func ScrapingWithOption(username, password string, since time.Time, opt ScrapingOption) (model.DatedScores, http.CookieJar, error) {
	notify := func(current, total int) {
		if opt.OnProgress != nil {
			opt.OnProgress(current, total)
		}
	}

	// 呼び出し元Context（ログアウト等のキャンセル用）。未指定ならBackground
	parent := opt.Context
	if parent == nil {
		parent = context.Background()
	}
	// 開始前に既にキャンセル済みなら何もしない
	if parent.Err() != nil {
		return nil, nil, ErrCanceled
	}

	var jar http.CookieJar
	if opt.SavedJar != nil {
		jar = opt.SavedJar
	} else {
		m := NewClient(username, password)
		if err := m.Login(); err != nil {
			return nil, nil, fmt.Errorf("ログインに失敗: %w", err)
		}
		jar = m.HTTPClient.Jar
	}
	if opt.OnLoginSuccess != nil {
		opt.OnLoginSuccess()
	}
	// ログイン中にキャンセルされた場合はここで中断
	if parent.Err() != nil {
		return nil, nil, ErrCanceled
	}

	// Phase 1: rankpageから日別ページURLを収集
	dailyLinks, err := collectDailyLinks(jar, since)
	if err != nil {
		return nil, nil, err
	}

	// 403検出時に全処理を即座に打ち切るためのcontext。呼び出し元Contextを親にすることで、
	// ログアウト等の外部キャンセルでもスクレイピングが即座に停止する
	ctx, cancel := context.WithCancel(parent)
	defer cancel()

	// Phase 2+3: 日別ページ収集→詳細ページ取得をパイプラインで並行実行
	// Phase 2で試合エントリが見つかり次第、Phase 3の詳細取得を開始する
	entryCh := make(chan matchEntry, 50)
	var streamErr error

	go func() {
		defer close(entryCh)
		streamErr = streamMatchEntries(ctx, cancel, jar, dailyLinks, since, entryCh)
	}()

	scores, detailErr := fetchDetailPagesStreaming(ctx, cancel, jar, entryCh, notify, opt.OnBatchReady, opt.BatchSize, opt.FirstBatchSize)

	// 呼び出し元Contextのキャンセル（ログアウト等）を最優先で判定する。
	// 内部の403キャンセル（子ctx）とは異なり親ctxが完了しているため区別できる。
	// この場合は途中データを保存せず、403ブロックも発動させない
	if parent.Err() != nil {
		return nil, nil, ErrCanceled
	}

	// 403の場合は途中データがあればエラーと一緒に返す（呼び出し元で途中保存できるようにする）
	if streamErr != nil || detailErr != nil {
		err := streamErr
		if err == nil {
			err = detailErr
		}
		if errors.Is(err, ErrAccessDenied) && len(scores) > 0 {
			log.Printf("[INFO] Returning %d partial scores despite 403 error", len(scores))
			return scores, jar, err
		}
		if streamErr != nil {
			return nil, nil, streamErr
		}
		return nil, nil, detailErr
	}

	// 日時降順・プレイヤーNo昇順でソート
	sort.Slice(scores, func(i, j int) bool {
		if !scores[i].Datetime.Equal(scores[j].Datetime) {
			return scores[i].Datetime.After(scores[j].Datetime)
		}
		return scores[i].PlayerNo < scores[j].PlayerNo
	})

	return scores, jar, nil
}

// collectDailyLinks はrankpageから日別ページのURLを収集する
func collectDailyLinks(jar http.CookieJar, since time.Time) ([]dailyLink, error) {
	var links []dailyLink

	c := colly.NewCollector(colly.AllowedDomains(vsmobile))
	c.SetCookieJar(jar)

	var accessDenied bool
	c.OnResponse(func(r *colly.Response) {
		if r.StatusCode == http.StatusForbidden {
			accessDenied = true
		}
	})

	c.OnHTML("li.item", func(e *colly.HTMLElement) {
		r := regexp.MustCompile(`\(.*`)
		date := r.ReplaceAllString(e.ChildText("p.datetime.fz-ss"), "")

		if !since.IsZero() {
			d, err := time.Parse("2006/01/02", date)
			if err == nil && d.Before(since.Truncate(24*time.Hour)) {
				return
			}
		}

		link := e.Request.AbsoluteURL(e.ChildAttr("a", "href"))
		shopName := strings.TrimSpace(e.ChildText("span.ds-ib.tl-l.col-stand.fz-ss"))
		links = append(links, dailyLink{date: date, url: link, shopName: shopName})
	})

	_ = c.Visit(mobileRankpage)

	if accessDenied {
		return nil, ErrAccessDenied
	}
	return links, nil
}

// streamMatchEntries は複数の日別ページから試合エントリを並列で収集し、チャネルにストリーミングする
// HTTPエラーが1件でもあればエラーを返す。403の場合はErrAccessDeniedを返し即座にキャンセルする
func streamMatchEntries(ctx context.Context, cancel context.CancelFunc, jar http.CookieJar, links []dailyLink, since time.Time, out chan<- matchEntry) error {
	if len(links) == 0 {
		return nil
	}

	sem := make(chan struct{}, burstParallelism())
	var (
		wg         sync.WaitGroup
		mu         sync.Mutex
		totalPages int
		errorCount int
		has403     bool
	)

	for _, dl := range links {
		// キャンセル済みなら新規goroutineを起動しない
		select {
		case <-ctx.Done():
		default:
		}
		if ctx.Err() != nil {
			break
		}

		wg.Add(1)
		go func(dl dailyLink) {
			defer wg.Done()

			select {
			case <-ctx.Done():
				return
			case sem <- struct{}{}:
			}
			defer func() { <-sem }()

			entries, err := collectMatchEntries(jar, dl, since)
			mu.Lock()
			totalPages++
			if err != nil {
				errorCount++
				if errors.Is(err, ErrAccessDenied) {
					has403 = true
				}
				cancel()
			}
			mu.Unlock()

			for _, e := range entries {
				select {
				case <-ctx.Done():
					return
				case out <- e:
				}
			}
			time.Sleep(entryRequestDelay)
		}(dl)
	}

	wg.Wait()

	if has403 {
		return ErrAccessDenied
	}
	if errorCount > 0 {
		return fmt.Errorf("日別ページ取得で%w: %d/%d件がエラー", ErrHTTPRequestFailed, errorCount, totalPages)
	}
	return nil
}

// collectMatchEntries は単一の日別ページから試合エントリを収集する（ページネーション対応）
// since以前の試合が出たらページネーションを早期終了する
// HTTPエラーが発生した場合はエラーを返す（403の場合はErrAccessDenied）
func collectMatchEntries(jar http.CookieJar, dl dailyLink, since time.Time) ([]matchEntry, error) {
	var entries []matchEntry
	var httpErr error
	stopPagination := false

	c := colly.NewCollector(colly.AllowedDomains(vsmobile))
	c.SetCookieJar(jar)

	c.OnError(func(r *colly.Response, err error) {
		// 403は最も重要なエラーなので、一度記録したら上書きしない
		if errors.Is(httpErr, ErrAccessDenied) {
			return
		}
		if r.StatusCode == http.StatusForbidden {
			httpErr = ErrAccessDenied
			log.Printf("[ERROR] collectMatchEntries: 403 Forbidden url=%s err=%v", r.Request.URL, err)
		} else {
			httpErr = fmt.Errorf("リクエストエラー: url=%s: %w", r.Request.URL, err)
			log.Printf("[ERROR] collectMatchEntries: HTTP %d url=%s err=%v", r.StatusCode, r.Request.URL, err)
		}
	})

	c.OnHTML("li.item", func(e *colly.HTMLElement) {
		hour := e.ChildText("p.datetime.fz-ss")

		if !since.IsZero() {
			t, err := time.Parse("2006/01/02 15:04", dl.date+" "+hour)
			if err == nil && !t.After(since) {
				stopPagination = true
				return
			}
		}

		var wins []bool
		if e.ChildAttr("a", "class") == "right-arrow vs-detail win" {
			wins = []bool{true, true, false, false}
		} else {
			wins = []bool{false, false, true, true}
		}

		link := e.Request.AbsoluteURL(e.ChildAttr("a", "href"))
		entries = append(entries, matchEntry{
			date:      dl.date,
			hour:      hour,
			wins:      wins,
			detailURL: link,
			shopName:  dl.shopName,
		})
	})

	c.OnHTML("div.block.control", func(e *colly.HTMLElement) {
		if stopPagination {
			return
		}
		// 「>」(次へ)ボタンは末尾から2番目のリンク
		links := e.ChildAttrs("ul.clearfix > li > a", "href")
		if len(links) >= 2 {
			nextLink := links[len(links)-2]
			if nextLink != "javascript:void(0);" {
				_ = c.Visit(e.Request.AbsoluteURL(nextLink))
			}
		}
	})

	_ = c.Visit(dl.url)
	return entries, httpErr
}

// fetchDetailPagesStreaming はチャネルから試合エントリを受信しつつ詳細ページを並列取得する
// HTTPエラーが1件でもあればエラーを返す。403の場合はErrAccessDeniedを返し即座にキャンセルする
func fetchDetailPagesStreaming(ctx context.Context, cancel context.CancelFunc, jar http.CookieJar, entryCh <-chan matchEntry, notify func(int, int), onBatch func(model.DatedScores), batchSize, firstBatch int) (model.DatedScores, error) {
	var (
		scores     model.DatedScores
		mu         sync.Mutex
		wg         sync.WaitGroup
		processed  int
		errorCount int
		has403     bool
		// エントリ収集(Phase2)完了までは総数不明=0。確定後にディスパッチ総数を入れ進捗バーの分母にする
		knownTotal int
	)

	burst := burstCount()
	td := throttleDelay()
	limit := maxDetail()
	sem := make(chan struct{}, burstParallelism())
	throttleSem := make(chan struct{}, 1) // スロットル区間を直列化してレート制限を回避する

	// 初回速報の発火件数。0ならbatchSizeと同じ。初回だけ早く出し、以降はbatchSize間隔で発火する
	firstFire := firstBatch
	if firstFire <= 0 {
		firstFire = batchSize
	}

	// 計装: 時間窓型レート検知の窓W・閾値N実測用。各リクエスト送信の相対時刻(ms)を記録し403時にダンプする
	detailStart := time.Now()
	var reqTimesMs []int64

	// totalは事前確定せず、エントリが届き次第ディスパッチして初回描画を早める（drain-allバリアを撤去）
	dispatched := 0

collectLoop:
	for entry := range entryCh {
		// キャンセル済み、または上限到達なら新規発行を止めて残りを排出する
		if ctx.Err() != nil {
			break
		}
		if limit > 0 && dispatched >= limit {
			break
		}

		select {
		case <-ctx.Done():
			break collectLoop
		case sem <- struct{}{}:
		}

		// バースト区間(先頭burst件)は並列・無遅延で高速取得。以降はスロットル区間
		throttled := burst > 0 && dispatched >= burst
		dispatched++

		wg.Add(1)
		go func(e matchEntry, throttled bool) {
			defer wg.Done()
			defer func() { <-sem }()

			// スロットル区間は直列化し、完了後に待機を入れてレートを落とす
			if throttled {
				throttleSem <- struct{}{}
				defer func() { <-throttleSem }()
			}

			// キャンセル済みならスキップ
			if ctx.Err() != nil {
				return
			}

			sentMs := time.Since(detailStart).Milliseconds()
			parsed, err := fetchSingleDetail(ctx, jar, e)
			mu.Lock()
			scores = append(scores, parsed...)
			processed++
			reqTimesMs = append(reqTimesMs, sentMs)
			shouldBatch := onBatch != nil && batchSize > 0 && processed >= firstFire && (processed-firstFire)%batchSize == 0
			var snapshot model.DatedScores
			if shouldBatch {
				snapshot = make(model.DatedScores, len(scores))
				copy(snapshot, scores)
			}
			if err != nil {
				errorCount++
				if errors.Is(err, ErrAccessDenied) {
					has403 = true
				}
				cancel()
			}
			current := processed
			total := knownTotal
			mu.Unlock()

			// total=0(Phase2未完=不定表示) → 確定後は処理済み/総数の正確なバー
			notify(current, total)
			if shouldBatch {
				onBatch(snapshot)
			}
			if throttled {
				time.Sleep(td)
			}
		}(entry, throttled)
	}

	// チャネルに残ったエントリを排出し、streamMatchEntries側のブロックを解く
	for range entryCh {
	}

	// Phase2完了=総試合数確定。以降のnotifyで正確な分母を出す
	mu.Lock()
	knownTotal = dispatched
	last := processed
	mu.Unlock()
	notify(last, dispatched)

	wg.Wait()

	if has403 {
		log.Printf("[WARN] 403 detected during detail fetch: %d/%d pages completed, returning partial data", processed, dispatched)
		log.Printf("[METRIC] 403 rate dump: 各リクエスト送信の相対ms (n=%d): %v", len(reqTimesMs), reqTimesMs)
		return scores, ErrAccessDenied
	}
	if errorCount > 0 {
		return nil, fmt.Errorf("詳細ページ取得で%w: %d/%d件がエラー", ErrHTTPRequestFailed, errorCount, dispatched)
	}
	// detail側でエラーは無いがctxがキャンセル済み=エントリ収集フェーズで403が発生したケース
	if ctx.Err() != nil {
		return nil, ErrAccessDenied
	}
	return scores, nil
}

// fetchSingleDetail は単一の試合詳細ページをnet/http+goqueryで取得しスコアを返す
// HTTPエラーが発生した場合はエラーを返す（403の場合はErrAccessDenied）
func fetchSingleDetail(ctx context.Context, jar http.CookieJar, e matchEntry) (model.DatedScores, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, e.detailURL, nil)
	if err != nil {
		return nil, fmt.Errorf("リクエスト作成失敗: url=%s: %w", e.detailURL, err)
	}

	client := &http.Client{Timeout: 30 * time.Second, Jar: jar}
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		log.Printf("[ERROR] fetchSingleDetail: リクエスト失敗 url=%s err=%v", e.detailURL, err)
		return nil, fmt.Errorf("リクエスト失敗: url=%s: %w", e.detailURL, err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		log.Printf("[ERROR] fetchSingleDetail: HTTP %d url=%s", resp.StatusCode, e.detailURL)
		switch {
		case resp.StatusCode == http.StatusUnauthorized:
			return nil, ErrUnauthorized
		case resp.StatusCode == http.StatusForbidden:
			return nil, ErrAccessDenied
		case resp.StatusCode == http.StatusNotFound:
			return nil, ErrNotFound
		case resp.StatusCode >= 500:
			return nil, fmt.Errorf("%w: HTTP %d", ErrServerError, resp.StatusCode)
		default:
			return nil, fmt.Errorf("HTTPエラー %d: url=%s", resp.StatusCode, e.detailURL)
		}
	}

	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		log.Printf("[ERROR] fetchSingleDetail: HTML解析失敗 url=%s err=%v", e.detailURL, err)
		return nil, fmt.Errorf("HTML解析失敗: url=%s: %w", e.detailURL, err)
	}

	// detailURL由来のMatchIDを算出し4プレイヤー全員に伝播する（#358: 同一分の複数試合を区別するキー）
	matchID := model.MatchIDFromURL(e.detailURL)

	var scores model.DatedScores
	doc.Find("div.panel_area").Each(func(_ int, s *goquery.Selection) {
		scores = parseDetailPage(s, e.date, e.hour, e.wins, e.shopName, matchID)
	})
	return scores, nil
}

// parseDetailPage は試合詳細ページからスコアを抽出する
func parseDetailPage(s *goquery.Selection, date, hour string, wins []bool, shopName, matchID string) model.DatedScores {
	var scores model.DatedScores

	// スコアタブ(panel3)からの既存データ
	selectorLeftValue := "div.w45.pr-ss > dl > dd"
	selectorRightValue := "div.w55 > dl > dd"
	selectorCity := "div.w80.ta-r > p.col-stand"
	selectorName := "p.mb-ss.fz-m > span.name"
	selectorMSImage := "#panel3 img.item-icon-img"

	cities := textsFromSelection(s, selectorCity)
	names := textsFromSelection(s, selectorName)
	msImages := attrsFromSelection(s, selectorMSImage, "data-original")
	leftValue := textsFromSelection(s, selectorLeftValue)
	rightValue := textsFromSelection(s, selectorRightValue)

	// メンバータブ(panel1)からの追加データ
	masteries := parseMasteries(s)
	teamNames := parseTeamNames(s)
	titleImages := attrsFromSelection(s, "#panel1 img.title-plv-img", "src")
	titleBadges := attrsFromSelection(s, "#panel1 img.title-plv-badge", "src")
	profileLinks := attrsFromSelection(s, "#panel1 li.item > a.right-arrow", "href")
	gradeImages := attrsFromSelection(s, "#panel1 img.class-img", "data-original")
	scoreRankings := parseScoreRankings(s)

	// 試合経過タブ(panel2)からのタイムラインデータ
	timeline := parseMatchTimeline(s)

	layout := "2006/01/02 15:04"
	t := date + " " + hour
	datetime, _ := time.Parse(layout, t)

	playerCount := 4

	for i := 0; i < playerCount; i++ {
		offL := i * 3
		offR := i * 3

		city := cities[i]
		name := names[i]
		win := wins[i]
		msImage := ""
		if i < len(msImages) {
			msImage = msImages[i]
		}
		point := parseNumber(leftValue[0+offL])
		kills := parseNumber(leftValue[1+offL])
		deaths := parseNumber(leftValue[2+offL])
		giveDamage := parseNumber(rightValue[0+offR])
		receiveDamage := parseNumber(rightValue[1+offR])
		exDamage := parseNumber(rightValue[2+offR])

		mastery := ""
		if i < len(masteries) {
			mastery = masteries[i]
		}

		// チーム名: player 1,2 → team1, player 3,4 → team2
		teamName := ""
		teamIdx := i / 2
		if teamIdx < len(teamNames) {
			teamName = teamNames[teamIdx]
		}

		titleImage := ""
		if i < len(titleImages) {
			titleImage = titleImages[i]
		}
		titleBadge := ""
		if i < len(titleBadges) {
			titleBadge = titleBadges[i]
		}
		profileLink := ""
		if i < len(profileLinks) {
			profileLink = profileLinks[i]
		}
		// クラス画像は各プレイヤーに2枚ずつ (シャッフル階級・固定階級)
		shuffleGrade := ""
		teamGrade := ""
		gradeIdx := i * 2
		if gradeIdx < len(gradeImages) {
			shuffleGrade = stripQueryParam(gradeImages[gradeIdx])
		}
		if gradeIdx+1 < len(gradeImages) {
			teamGrade = stripQueryParam(gradeImages[gradeIdx+1])
		}
		scoreRanking := 0
		if i < len(scoreRankings) {
			scoreRanking = scoreRankings[i]
		}

		arcadeName := ""
		if i == 0 {
			arcadeName = shopName
		}

		result := model.DatedScore{
			PlayerNo: i + 1,
			Datetime: datetime,
			MatchID:  matchID,
			PlayerScore: model.PlayerScore{
				City:            city,
				Name:            name,
				Win:             win,
				MsImageURL:      msImage,
				MsName:          "",
				Score:           point,
				Kills:           kills,
				Deaths:          deaths,
				GiveDamage:      giveDamage,
				ReceiveDamage:   receiveDamage,
				ExDamage:        exDamage,
				MsProficiency:   mastery,
				TeamName:        teamName,
				PlayerLevelURL:  titleImage,
				RankBadgeURL:    titleBadge,
				ProfileURL:      profileLink,
				ShuffleGradeURL: shuffleGrade,
				TeamGradeURL:    teamGrade,
				ScoreRanking:    scoreRanking,
				ArcadeName:      arcadeName,
			},
		}

		// タイムラインはPlayerNo==1のときのみセット（4人で共有データ）
		if i == 0 && timeline != nil {
			result.MatchTimeline = timeline
		}

		scores = append(scores, result)
	}

	return scores
}

// parseMasteries はメンバータブからランク情報を抽出する
// span.masteryのclass属性から"mastery"以外のクラス名を取得する
func parseMasteries(s *goquery.Selection) []string {
	var masteries []string
	s.Find("#panel1 span.mastery").Each(func(_ int, el *goquery.Selection) {
		classes, exists := el.Attr("class")
		if !exists {
			masteries = append(masteries, "")
			return
		}
		rank := ""
		for _, c := range strings.Fields(classes) {
			if c != "mastery" {
				rank = c
				break
			}
		}
		masteries = append(masteries, rank)
	})
	return masteries
}

// parseTeamNames はメンバータブからチーム名を抽出する
// panel1のbox内h3にあるtag-nameを取得（2チーム分）
func parseTeamNames(s *goquery.Selection) []string {
	var names []string
	s.Find("#panel1 > div.box > h3 p.tag-name").Each(func(_ int, el *goquery.Selection) {
		names = append(names, strings.TrimSpace(el.Text()))
	})
	return names
}

// parseScoreRankings はスコアタブからrank-bandクラスを読み取り、各プレイヤーの試合内順位を返す
func parseScoreRankings(s *goquery.Selection) []int {
	var rankings []int
	s.Find("#panel3 li.item").Each(func(_ int, el *goquery.Selection) {
		classes, _ := el.Attr("class")
		rank := 0
		for _, c := range strings.Fields(classes) {
			switch c {
			case "rank-band1":
				rank = 1
			case "rank-band2":
				rank = 2
			case "rank-band3":
				rank = 3
			case "rank-band4":
				rank = 4
			}
		}
		rankings = append(rankings, rank)
	})
	return rankings
}

// vis.js DataSetパーサー用の正規表現
var (
	rePush      = regexp.MustCompile(`dataset\.push\(\{(.+?)\}\)`)
	reGroup     = regexp.MustCompile(`group:\s*"([^"]+)"`)
	reClassName = regexp.MustCompile(`className:\s*'([^']+)'`)
	reType      = regexp.MustCompile(`type:\s*'([^']+)'`)
	reStartTime = regexp.MustCompile(`var\s+start_time\s*=\s*new\s+Date\(0,\s*0,\s*0,\s*(\d+),\s*(\d+),\s*(\d+)\)`)
	reEndTime   = regexp.MustCompile(`var\s+end_time\s*=\s*new\s+Date\(0,\s*0,\s*0,\s*(\d+),\s*(\d+),\s*(\d+)\)`)
	reGameOver  = regexp.MustCompile(`addCustomTime\(new\s+Date\(0,\s*0,\s*0,\s*(\d+),\s*(\d+),\s*(\d+)\),\s*'game-over'\)`)
)

// datePartsToSec はvis.jsのDate(0,0,0,min,sec,centisec)を秒に変換する
func datePartsToSec(minStr, secStr, centiStr string) float64 {
	min, _ := strconv.Atoi(minStr)
	sec, _ := strconv.Atoi(secStr)
	centi, _ := strconv.Atoi(centiStr)
	return float64(min)*60 + float64(sec) + float64(centi)/100.0
}

// parseMatchTimeline は試合経過タブからvis.jsのタイムラインデータを解析する
func parseMatchTimeline(s *goquery.Selection) *model.MatchTimeline {
	// panel2内のscriptタグからJavaScriptコードを取得
	var scriptText string
	s.Find("#panel2 script").Each(func(_ int, el *goquery.Selection) {
		text := el.Text()
		if strings.Contains(text, "dataset.push") {
			scriptText = text
		}
	})

	if scriptText == "" {
		return nil
	}

	var events []model.MatchEvent

	// scriptTextを行ごとに処理し、start_time/end_time変数とdataset.pushを対応付ける
	lines := strings.Split(scriptText, "\n")
	var currentStart float64
	var currentEnd float64
	var hasEnd bool

	for _, line := range lines {
		line = strings.TrimSpace(line)

		if m := reStartTime.FindStringSubmatch(line); m != nil {
			currentStart = datePartsToSec(m[1], m[2], m[3])
			hasEnd = false
			currentEnd = 0
			continue
		}

		if m := reEndTime.FindStringSubmatch(line); m != nil {
			currentEnd = datePartsToSec(m[1], m[2], m[3])
			hasEnd = true
			continue
		}

		if m := rePush.FindStringSubmatch(line); m != nil {
			content := m[1]

			groupMatch := reGroup.FindStringSubmatch(content)
			if groupMatch == nil {
				continue
			}

			event := model.MatchEvent{
				Group:    groupMatch[1],
				StartSec: currentStart,
			}

			if hasEnd {
				event.EndSec = currentEnd
			}

			if classMatch := reClassName.FindStringSubmatch(content); classMatch != nil {
				// xb（クロスバースト）は覚醒重複区間から算出するため保存しない
				if classMatch[1] == "xb" {
					continue
				}
				event.ClassName = classMatch[1]
			}

			if typeMatch := reType.FindStringSubmatch(content); typeMatch != nil && typeMatch[1] == "point" {
				event.IsPoint = true
			}

			events = append(events, event)
		}
	}

	if len(events) == 0 {
		return nil
	}

	timeline := &model.MatchTimeline{
		Events: events,
	}

	// ゲーム終了時間を取得
	if m := reGameOver.FindStringSubmatch(scriptText); m != nil {
		timeline.GameEndSec = datePartsToSec(m[1], m[2], m[3])
	}

	return timeline
}

// textsFromSelection はgoquery.Selectionから指定セレクタの子要素テキストを収集する
func textsFromSelection(s *goquery.Selection, selector string) []string {
	var texts []string
	s.Find(selector).Each(func(_ int, el *goquery.Selection) {
		texts = append(texts, strings.TrimSpace(el.Text()))
	})
	return texts
}

// attrsFromSelection はgoquery.Selectionから指定セレクタの属性値を収集する
func attrsFromSelection(s *goquery.Selection, selector, attr string) []string {
	var attrs []string
	s.Find(selector).Each(func(_ int, el *goquery.Selection) {
		if val, exists := el.Attr(attr); exists {
			attrs = append(attrs, val)
		}
	})
	return attrs
}

// ScrapeTagPartners はタッグ戦歴ページからチーム名と相方のプレイヤー名を取得する
func ScrapeTagPartners(jar http.CookieJar) []model.TagPartner {
	var partners []model.TagPartner

	c := colly.NewCollector(colly.AllowedDomains(vsmobile))
	c.SetCookieJar(jar)

	c.OnHTML("li.item", func(e *colly.HTMLElement) {
		teamName := strings.TrimSpace(e.ChildText("p.tag-name"))
		playerName := strings.TrimSpace(e.ChildText("p.ml-ss"))

		if playerName != "" {
			partners = append(partners, model.TagPartner{
				TeamName:   teamName,
				PlayerName: playerName,
			})
		}
	})

	_ = c.Visit(mobileTagPage)
	return partners
}

// ScrapeMSList は機体使用率ランキングページから画像URLと機体名の一覧を取得する
func ScrapeMSList(username, password string) ([]model.MSInfo, error) {
	var msList []model.MSInfo
	seen := make(map[string]bool)

	m := NewClient(username, password)
	if err := m.Login(); err != nil {
		return nil, fmt.Errorf("ログインに失敗: %w", err)
	}

	// まずCSRFトークンを取得
	var csrfToken string
	var tokenErr error
	var tokenResponseBody []byte
	var tokenStatusCode int
	tokenCollector := colly.NewCollector(colly.AllowedDomains(vsmobile))
	tokenCollector.SetCookieJar(m.HTTPClient.Jar)
	tokenCollector.OnError(func(r *colly.Response, err error) {
		tokenErr = classifyHTTPError(r.StatusCode, mobileMSUsedRate, err)
	})
	tokenCollector.OnResponse(func(r *colly.Response) {
		tokenStatusCode = r.StatusCode
		tokenResponseBody = r.Body
	})
	tokenCollector.OnHTML("input[name=_token]", func(e *colly.HTMLElement) {
		csrfToken = e.Attr("value")
	})
	_ = tokenCollector.Visit(mobileMSUsedRate)

	if tokenErr != nil {
		return nil, fmt.Errorf("CSRFトークン取得に失敗: %w", tokenErr)
	}
	if csrfToken == "" {
		body := string(tokenResponseBody)
		if len(body) > 2000 {
			body = body[:2000]
		}
		return nil, fmt.Errorf("CSRFトークンが見つかりません: url=%s status=%d body=%s", mobileMSUsedRate, tokenStatusCode, body)
	}

	// 各コストでPOSTしてMS一覧を取得
	costs := []int{3000, 2500, 2000, 1500}
	for _, cost := range costs {
		currentCost := cost

		c := colly.NewCollector(
			colly.AllowedDomains(vsmobile),
		)
		c.SetCookieJar(m.HTTPClient.Jar)

		var costErr error
		c.OnError(func(r *colly.Response, err error) {
			if costErr == nil {
				costErr = classifyHTTPError(r.StatusCode, r.Request.URL.String(), err)
			}
		})

		c.OnHTML("li.item div.ds-fx.fx-va-s.fx-hz-s", func(e *colly.HTMLElement) {
			imageURL := e.ChildAttr("img.item-icon-img", "data-original")
			name := strings.TrimSpace(e.ChildText("div.prompt-area > p.fz-s"))

			if imageURL != "" && name != "" && !seen[imageURL] {
				seen[imageURL] = true
				msList = append(msList, model.MSInfo{
					Name:     name,
					ImageURL: imageURL,
					Cost:     currentCost,
				})
			}
		})

		c.OnHTML("div.page-send ul.clearfix", func(e *colly.HTMLElement) {
			nextLinks := e.ChildAttrs("li > a", "href")
			for _, link := range nextLinks {
				if link != "javascript:void(0);" {
					_ = c.Visit(e.Request.AbsoluteURL(link))
				}
			}
		})

		_ = c.Post(mobileMSUsedRate, map[string]string{
			"_token":   csrfToken,
			"cost":     fmt.Sprintf("%d", currentCost),
			"category": "1",
		})

		if costErr != nil {
			return nil, fmt.Errorf("コスト%dのMS一覧取得に失敗: %w", currentCost, costErr)
		}
	}

	return msList, nil
}

// classifyHTTPError はHTTPステータスコードに応じた適切なエラーを返す
func classifyHTTPError(statusCode int, url string, originalErr error) error {
	log.Printf("[ERROR] ScrapeMSList: HTTP %d url=%s err=%v", statusCode, url, originalErr)
	switch {
	case statusCode == http.StatusUnauthorized:
		return ErrUnauthorized
	case statusCode == http.StatusForbidden:
		return ErrAccessDenied
	case statusCode == http.StatusNotFound:
		return ErrNotFound
	case statusCode >= 500:
		return fmt.Errorf("%w: HTTP %d url=%s", ErrServerError, statusCode, url)
	default:
		return fmt.Errorf("%w: HTTP %d url=%s", ErrHTTPRequestFailed, statusCode, url)
	}
}
