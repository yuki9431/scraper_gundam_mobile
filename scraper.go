package main

import (
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gocolly/colly/v2"
)

const (
	vsmobile        = "web.vsmobile.jp"
	mobile_rankpage = "https://web.vsmobile.jp/exvs2ib/results/classmatch/fight"
)

// スコア
type PlayerScore struct {
	City           string
	Name           string
	Win            string
	Point          int
	Kills          int
	Deaths         int
	Give_damage    int
	Receive_damage int
	Ex_damage      int
}

// 日付付きスコア
type DatedScore struct {
	PlayerNo    int
	Datatime    time.Time
	PlayerScore PlayerScore
}

// スコア平均
type AverageScore struct {
	Game_count  int
	Victories   int
	PlayerScore PlayerScore
}

// スコアのリスト
type PlayerScores []PlayerScore

// 日付付きスコアのリスト
type DatedScores []DatedScore

// Note: "29,001pt" や "29001pt" などから数値部分を取り出して int を返す
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

// Note: 日別のスコアを集計する際に使用する
// 日別の日付フォーマットを返す関数
func dateFormatDaily(t time.Time) time.Time {
	var jst = time.FixedZone("Asia/Tokyo", 9*60*60)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, jst)
}

// Note: 月別のスコアを集計する際に使用する
// 月別の日付フォーマットを返す関数
func dateFormatMonthly(t time.Time) time.Time {
	var jst = time.FixedZone("Asia/Tokyo", 9*60*60)
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, jst)
}

// スクレイピング処理を実行し、DatedScoresを返す
func Scraiping(username, password string) DatedScores {

	var (
		scores     DatedScores
		date, hour string
		wins       []string
	)

	m := newClient(username, password)
	m.login()

	// Instantiate default collector
	rankpage := colly.NewCollector(
		colly.AllowedDomains(vsmobile),
	)

	// Save authentication information
	rankpage.SetCookieJar(m.httpClient.Jar)
	dailypage := rankpage.Clone()
	detailpage := rankpage.Clone()

	// On every a element which has href attribute call callback
	rankpage.OnHTML("li.item", func(e *colly.HTMLElement) {

		r := regexp.MustCompile(`\(.*`)
		date = r.ReplaceAllString(e.ChildText("p.datetime.fz-ss"), "") // 2022/10/15(土) -> 2022/10/15

		link := e.ChildAttr("a", "href")

		dailypage.Visit(link)
	})

	// 日別の戦績ページにアクセス
	dailypage.OnHTML("li.item", func(e *colly.HTMLElement) {

		hour = e.ChildText("p.datetime.fz-ss")

		// 判定: リンクの class に "win" が含まれるかで、1-2 人目が勝ち / 3-4 人目が負けとする
		if e.ChildAttr("a", "class") == "right-arrow vs-detail win" {
			wins = []string{"win", "win", "lose", "lose"}
		} else {
			wins = []string{"lose", "lose", "win", "win"}
		}

		link := e.ChildAttr("a", "href")

		detailpage.Visit(link)
	})

	// 日別の戦績ページの2ページ目以降にアクセス
	dailypage.OnHTML("div.block.control", func(e *colly.HTMLElement) {

		// 2ページ目以降の処理
		links := e.ChildAttrs("ul.clearfix > li > a", "href")
		link := links[len(links)-1]

		dailypage.Visit(link)
	})

	// プレイヤー情報およびスコア情報を取得
	detailpage.OnHTML("div.panel_area", func(e *colly.HTMLElement) {
		//detailpage.OnHTML("div.pa-m.ds-fx.fx-va-c > div.w80.ds-fx.mx-ss", func(e *colly.HTMLElement) {

		// 画面上の数値をまとめて取得するための変数
		selector_left_value := "div.w45.pr-ss > dl > dd"
		selector_right_value := "div.w55 > dl > dd"
		selector_city := "div.w80.ta-r > p.col-stand"
		selector_name := "p.mb-ss.fz-m > span.name"

		cities := e.ChildTexts(selector_city)
		names := e.ChildTexts(selector_name)
		left_value := e.ChildTexts(selector_left_value)   //スコア・撃墜・被撃墜
		right_value := e.ChildTexts(selector_right_value) //与ダメ・被ダメ・EXダメ

		// Note:
		// 画面からプレイヤー4人のスコアがまとめて取得されるため、
		// ループで回して1人ずつDatedScore構造体に格納する。
		var layout = "2006/01/02 15:04"
		t := date + " " + hour
		datatime, _ := time.Parse(layout, t)

		playerCount := 4 // プレイヤー数は4人

		for i := 0; i < playerCount; i++ {
			offL := i * 3
			offR := i * 3

			city := cities[i]                                  //地域
			name := names[i]                                   //プレイヤー名
			win := wins[i]                                     //勝ち負け
			point := parseNumber(left_value[0+offL])           // スコアポイント
			kills := parseNumber(left_value[1+offL])              // 撃墜
			deaths := parseNumber(left_value[2+offL])            // 被撃墜
			give_damage := parseNumber(right_value[0+offR])    // 与ダメージ
			receive_damage := parseNumber(right_value[1+offR]) // 被ダメージ
			ex_damage := parseNumber(right_value[2+offR])      // EXダメージ

			result := DatedScore{
				i + 1, //playerNo
				datatime,
				PlayerScore{
					city,
					name,
					win,
					point,
					kills,
					deaths,
					give_damage,
					receive_damage,
					ex_damage,
				},
			}

			scores = append(scores, result)
		}
	})

	rankpage.Visit(mobile_rankpage)
	return scores
}

// Note: GetDailyScoresとGetMonthlyScoresで使用するためのprivateメソッド
func (ds DatedScores) getscores(t time.Time, format func(time.Time) time.Time) PlayerScores {

	var scores PlayerScores

	// 指定した日付のスコアのみ取得する
	date := format(t)
	for _, v := range ds {
		vd := format(v.Datatime)

		if vd.Equal(date) {
			score := PlayerScore{
				v.PlayerScore.City,
				v.PlayerScore.Name,
				v.PlayerScore.Win,
				v.PlayerScore.Point,
				v.PlayerScore.Kills,
				v.PlayerScore.Deaths,
				v.PlayerScore.Give_damage,
				v.PlayerScore.Receive_damage,
				v.PlayerScore.Ex_damage,
			}

			scores = append(scores, score)
		}
	}

	return scores
}

// Note: main.goで各日のスコアを取得するために使用する
// 指定した日のスコアを取得する
func (ds DatedScores) GetDailyScores(t time.Time) PlayerScores {
	return ds.getscores(t, dateFormatDaily)
}

// Note:main.goで各月のスコアを取得するために使用する
// 指定した月のスコアを取得する
func (ds DatedScores) GetMonthlyScores(t time.Time) PlayerScores {
	return ds.getscores(t, dateFormatMonthly)
}

// スコアリストの値を合計しAverageScoreを取得する
func (s PlayerScores) GetAverage() AverageScore {

	var (
		game_count         = 0
		sum_Victories      = 0
		sum_Point          = 0
		sum_Kills          = 0
		sum_Deaths         = 0
		sum_Give_damage    = 0
		sum_Receive_damage = 0
		sum_Ex_damage      = 0
	)

	for _, v := range s {
		sum_Point += v.Point
		sum_Kills += v.Kills
		sum_Deaths += v.Deaths
		sum_Give_damage += v.Give_damage
		sum_Receive_damage += v.Receive_damage
		sum_Ex_damage += v.Ex_damage

		game_count += 1

		if v.Win == "win" {
			sum_Victories += 1
		}

	}

	average_Point := float64(sum_Point) / float64(len(s))
	average_Kills := float64(sum_Kills) / float64(len(s))
	average_Deaths := float64(sum_Deaths) / float64(len(s))
	average_Give_damage := float64(sum_Give_damage) / float64(len(s))
	average_Receive_damage := float64(sum_Receive_damage) / float64(len(s))
	average_Ex_damage := float64(sum_Ex_damage) / float64(len(s))

	return AverageScore{
		game_count,
		sum_Victories,
		PlayerScore{
			Point:          int(math.Round(average_Point)),
			Kills:          int(math.Round(average_Kills)),
			Deaths:         int(math.Round(average_Deaths)),
			Give_damage:    int(math.Round(average_Give_damage)),
			Receive_damage: int(math.Round(average_Receive_damage)),
			Ex_damage:      int(math.Round(average_Ex_damage)),
		},
	}
}

// Note:
// dailyを引数にした場合は対戦を行った"日"の一覧を返す。(日別平均を集計する際に使用する)
// monthlyを引数にした場合は対戦を行った"月"の一覧を返す。(月別平均を集計する際に使用する)
// 対戦を行った日付一覧を取得する
func (ds DatedScores) GetDateList(frequency string) ([]time.Time, error) {
	var dates []time.Time
	var jst = time.FixedZone("Asia/Tokyo", 9*60*60)

	// 時間を切り捨て
	for _, v := range ds {

		var day int
		switch frequency {
		case "daily":
			day = v.Datatime.Day()
		case "monthly":
			rounding_down := 1
			day = rounding_down
		default:
			return nil, errors.New(`ERROR: "daily" or "monthly" is required for the argument`)
		}

		d := time.Date(v.Datatime.Year(), v.Datatime.Month(), day, 0, 0, 0, 0, jst)
		dates = append(dates, d)
	}

	// 重複した日付をSliceから削除
	var datelist []time.Time
	m := make(map[time.Time]bool)

	for _, v := range dates {
		if !m[v] {
			m[v] = true
			datelist = append(datelist, v)
		}
	}

	return datelist, nil
}
