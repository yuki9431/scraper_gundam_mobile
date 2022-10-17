package main

import (
	"fmt"
	"os"

	"github.com/gocolly/colly/v2"
)

func isMyscore(count int) bool {

	myscore := false

	if count == 0 {
		myscore = true
	}

	return myscore
}

func main() {
	m := newClient(os.Args[1], os.Args[2])
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

		date := e.ChildText("p.datetime.fz-ss")
		fmt.Printf("date :%s\n", date)

		// Print link
		link := e.ChildAttr("a", "href")

		//fmt.Printf("Link found: %s\n", link)
		c_daily.Visit(link)
	})

	// Note: 相方と相手のスコアも一緒にスクレイピングするため、判別するためにmyscore_flagを使用する
	myscore_flag := 0

	// 日別のページにアクセス
	c_daily.OnHTML(".item a[href]", func(e *colly.HTMLElement) {

		// Print link
		link := e.Attr("href")
		fmt.Printf("c_daily Link found: %s\n", link)

		myscore_flag = 0
		c_detail.Visit(link)
	})

	// スコア取得
	c_detail.OnHTML("div.pa-m.ds-fx.fx-va-c > div.w80.ds-fx.mx-ss", func(e *colly.HTMLElement) {

		selector_left_value := "div.w45.pr-ss > dl > dd"
		selector_right_value := "div.w55 > dl > dd"

		left_value := e.ChildTexts(selector_left_value)
		right_value := e.ChildTexts(selector_right_value)

		var score = map[string]string{
			"value":          left_value[0],
			"ko":             left_value[1],
			"down":           left_value[2],
			"give_damage":    right_value[0],
			"receive_damage": right_value[1],
			"ex_damage":      right_value[2],
		}

		// Note: プレイヤー4人のスコアを取得するため、自分のスコアの時のみ処理する
		if isMyscore(myscore_flag) {
			fmt.Println("スコア: ", score["value"])
			fmt.Println("撃墜: ", score["ko"])
			fmt.Println("被撃墜: ", score["down"])
			fmt.Println("与ダメ: ", score["give_damage"])
			fmt.Println("被ダメ: ", score["receive_damage"])
			fmt.Println("EXダメ: ", score["ex_damage"])

			myscore_flag += 1
		}
	})

	c.Visit(mobile_rankpage)
}
