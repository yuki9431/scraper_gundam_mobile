package main

import (
	"errors"
	"log"
	"math"
	"regexp"
	"strconv"
	"time"

	"github.com/gocolly/colly/v2"
)

const vsmobile = "web.vsmobile.jp"

type Score struct {
	Win            bool
	Ko             int
	Down           int
	Give_damage    int
	Receive_damage int
	Ex_damage      int
}

type DatedScore struct {
	Datatime time.Time
	Score    Score
}

type AverageScore struct {
	Count     int
	Victories int
	Score     Score
}

type Scores []Score
type DatedScores []DatedScore

// Note: 自分のスコアはかならず一番上にあるため、繰り返しカウントが0の時に自分のスコアを取得できる
func isMyscore(count int) bool {

	myscore := false

	if count == 0 {
		myscore = true
	}

	return myscore
}

func dateFormatDaily(t time.Time) time.Time {
	var jst = time.FixedZone("Asia/Tokyo", 9*60*60)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, jst)
}

func dateFormatMonthly(t time.Time) time.Time {
	var jst = time.FixedZone("Asia/Tokyo", 9*60*60)
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, jst)
}

func Scraiping(username, password string) DatedScores {

	var (
		scores     DatedScores
		date, hour string
		win        bool
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
		log.Println("[INFO] Found:", link)

		dailypage.Visit(link)
	})

	// Note: 相方と相手のスコアも一緒にスクレイピングするため、判別するためにmyscore_flagを使用する
	myscore_flag := 0

	// 日別のページにアクセス
	dailypage.OnHTML("li.item", func(e *colly.HTMLElement) {

		myscore_flag = 0
		hour = e.ChildText("p.datetime.fz-ss")

		if e.ChildAttr("a", "class") == "right-arrow vs-detail win" {
			win = true
		} else {
			win = false
		}

		link := e.ChildAttr("a", "href")
		log.Println("[INFO] Found:", link)

		detailpage.Visit(link)
	})

	dailypage.OnHTML("div.block.control", func(e *colly.HTMLElement) {

		// 2ページ目以降の処理
		links := e.ChildAttrs("ul.clearfix > li > a", "href")
		link := links[len(links)-1]

		log.Println("[INFO] Found:", link)

		dailypage.Visit(link)

	})

	// スコア取得
	detailpage.OnHTML("div.pa-m.ds-fx.fx-va-c > div.w80.ds-fx.mx-ss", func(e *colly.HTMLElement) {

		selector_left_value := "div.w45.pr-ss > dl > dd"
		selector_right_value := "div.w55 > dl > dd"

		left_value := e.ChildTexts(selector_left_value)
		right_value := e.ChildTexts(selector_right_value)

		// Note: プレイヤー4人のスコアが画面から取得できるが、自分のスコアの時のみ処理する
		if isMyscore(myscore_flag) {
			var layout = "2006/01/02 15:04"
			t := date + " " + hour

			datatime, _ := time.Parse(layout, t)
			ko, _ := strconv.Atoi(left_value[1])
			down, _ := strconv.Atoi(left_value[2])
			give_damage, _ := strconv.Atoi(right_value[0])
			receive_damage, _ := strconv.Atoi(right_value[1])
			ex_damage, _ := strconv.Atoi(right_value[2])

			result := DatedScore{
				datatime,
				Score{
					win,
					ko,
					down,
					give_damage,
					receive_damage,
					ex_damage,
				},
			}

			scores = append(scores, result)
			myscore_flag += 1
		}
	})

	rankpage.Visit(mobile_rankpage)
	return scores
}

func (ds DatedScores) getscores(t time.Time, format func(time.Time) time.Time) Scores {

	var scores Scores

	// 指定した日付のスコアのみ取得する
	date := format(t)
	for _, v := range ds {
		vd := format(v.Datatime)

		if vd.Equal(date) {
			score := Score{
				v.Score.Win,
				v.Score.Ko,
				v.Score.Down,
				v.Score.Give_damage,
				v.Score.Receive_damage,
				v.Score.Ex_damage,
			}

			scores = append(scores, score)
		}
	}

	return scores
}

// 指定した日にちのスコアのみ取得する
func (ds DatedScores) GetDailyScores(t time.Time) Scores {
	return ds.getscores(t, dateFormatDaily)
}

// 指定した月のスコアのみ取得する
func (ds DatedScores) GetDailyMonthly(t time.Time) Scores {
	return ds.getscores(t, dateFormatMonthly)
}

func (s Scores) GetAverage() AverageScore {

	var (
		cnt                = 0
		sum_Victories      = 0
		sum_Ko             = 0
		sum_Down           = 0
		sum_Give_damage    = 0
		sum_Receive_damage = 0
		sum_Ex_damage      = 0
	)

	for _, v := range s {
		sum_Ko += v.Ko
		sum_Down += v.Down
		sum_Give_damage += v.Give_damage
		sum_Receive_damage += v.Receive_damage
		sum_Ex_damage += v.Ex_damage

		cnt += 1

		if v.Win {
			sum_Victories += 1
		}

	}

	average_Ko := float64(sum_Ko) / float64(len(s))
	average_Down := float64(sum_Down) / float64(len(s))
	average_Give_damage := float64(sum_Give_damage) / float64(len(s))
	average_Receive_damage := float64(sum_Receive_damage) / float64(len(s))
	average_Ex_damage := float64(sum_Ex_damage) / float64(len(s))

	return AverageScore{
		cnt,
		sum_Victories,
		Score{
			Ko:             int(math.Round(average_Ko)),
			Down:           int(math.Round(average_Down)),
			Give_damage:    int(math.Round(average_Give_damage)),
			Receive_damage: int(math.Round(average_Receive_damage)),
			Ex_damage:      int(math.Round(average_Ex_damage)),
		},
	}
}

// 対戦した日付のリストを取得
func (ds DatedScores) GetDateList(frequency string) ([]time.Time, error) {
	var dates []time.Time
	var jst = time.FixedZone("Asia/Tokyo", 9*60*60)

	// 時間を切り捨て
	for _, v := range ds {

		var day int
		if frequency == "daily" {
			day = v.Datatime.Day()
		} else if frequency == "monthly" {
			rounding_down := 1
			day = rounding_down
		} else {
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
