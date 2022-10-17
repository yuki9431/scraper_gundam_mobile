package main

import (
	"regexp"
	"strconv"
	"time"

	"github.com/gocolly/colly/v2"
)

type Score struct {
	//Value          string
	datatime       time.Time
	Ko             int
	Down           int
	Give_damage    int
	Receive_damage int
	Ex_damage      int
}

func isMyscore(count int) bool {

	myscore := false

	if count == 0 {
		myscore = true
	}

	return myscore
}

func GetScores(username, password string) []Score {
	var scores []Score
	var date, hour string

	m := newClient(username, password)
	m.login()

	// Instantiate default collector
	c := colly.NewCollector(
		colly.AllowedDomains("web.vsmobile.jp"),
	)

	// Save authentication information
	c.SetCookieJar(m.httpClient.Jar)
	c_daily := c.Clone()
	c_detail := c.Clone()

	// On every a element which has href attribute call callback
	c.OnHTML("li.item", func(e *colly.HTMLElement) {

		r := regexp.MustCompile(`\(.*`)
		date = r.ReplaceAllString(e.ChildText("p.datetime.fz-ss"), "") // 2022/10/15(土) -> 2022/10/15

		link := e.ChildAttr("a", "href")
		c_daily.Visit(link)
	})

	// Note: 相方と相手のスコアも一緒にスクレイピングするため、判別するためにmyscore_flagを使用する
	myscore_flag := 0

	// 日別のページにアクセス
	c_daily.OnHTML("li.item", func(e *colly.HTMLElement) {

		myscore_flag = 0
		hour = e.ChildText("p.datetime.fz-ss")

		link := e.ChildAttr("a", "href")
		c_detail.Visit(link)
	})

	// スコア取得
	c_detail.OnHTML("div.pa-m.ds-fx.fx-va-c > div.w80.ds-fx.mx-ss", func(e *colly.HTMLElement) {

		selector_left_value := "div.w45.pr-ss > dl > dd"
		selector_right_value := "div.w55 > dl > dd"

		left_value := e.ChildTexts(selector_left_value)
		right_value := e.ChildTexts(selector_right_value)

		// Note: プレイヤー4人のスコアを取得するため、自分のスコアの時のみ処理する
		if isMyscore(myscore_flag) {
			var layout = "2006/01/02 15:04"
			t := date + " " + hour

			datatime, _ := time.Parse(layout, t)
			ko, _ := strconv.Atoi(left_value[1])
			down, _ := strconv.Atoi(left_value[2])
			give_damage, _ := strconv.Atoi(right_value[0])
			receive_damage, _ := strconv.Atoi(right_value[1])
			ex_damage, _ := strconv.Atoi(right_value[2])

			result := Score{
				//Value :         score["value"],
				datatime:       datatime,
				Ko:             ko,
				Down:           down,
				Give_damage:    give_damage,
				Receive_damage: receive_damage,
				Ex_damage:      ex_damage,
			}

			scores = append(scores, result)
			myscore_flag += 1
		}
	})

	c.Visit(mobile_rankpage)
	return scores
}

func GetScoresTest() []Score {

	score01 := Score{
		//Value :         score["value"],
		//datatime:
		Ko:             1,
		Down:           1,
		Give_damage:    1000,
		Receive_damage: 500,
		Ex_damage:      100,
	}

	score02 := Score{
		//Value :         score["value"],
		//datatime:
		Ko:             1,
		Down:           1,
		Give_damage:    1000,
		Receive_damage: 500,
		Ex_damage:      100,
	}

	scores := []Score{score01, score02}

	return scores
}
