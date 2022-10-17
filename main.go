package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"

	"github.com/gocolly/colly/v2"
)

const (
	login_url       = "https://account-api.bandainamcoid.com/v3/login/idpw"
	redirect_uri    = "https://www.bandainamcoid.com/v2/oauth2/auth?back=v3&client_id=gundamexvs&scope=JpGroupAll&redirect_uri=https://web.vsmobile.jp/exvs2xb/regist&text="
	mobile_rankpage = "https://web.vsmobile.jp/exvs2xb/results/fight/rank"
)

type MobileClient struct {
	Username   string
	Password   string
	httpClient *http.Client
}

type LoginResponce struct {
	Status string `json:"result"`
	Cookie struct {
		RetentionTmp struct {
			Name    string `json:"name"`
			Value   string `json:"value"`
			Expires int    `json:"expires"`
		} `json:"retention_tmp"`
		DeleteLogin struct {
			Name string `json:"name"`
		} `json:"delete_login"`
		DeleteLoginCheck struct {
			Name string `json:"name"`
		} `json:"delete_login_check"`
		DeleteCommon struct {
			Name   string `json:"name"`
			Path   string `json:"path"`
			Domain string `json:"domain"`
		} `json:"delete_common"`
		Login struct {
			Name    string `json:"name"`
			Value   string `json:"value"`
			Expires int    `json:"expires"`
		} `json:"login"`
		LoginCheck struct {
			Name    string `json:"name"`
			Value   string `json:"value"`
			Expires int    `json:"expires"`
		} `json:"login_check"`
		Common struct {
			Name    string `json:"name"`
			Value   string `json:"value"`
			Expires int    `json:"expires"`
			Path    string `json:"path"`
			Domain  string `json:"domain"`
		} `json:"common"`
		Mnw struct {
			Name    string `json:"name"`
			Value   string `json:"value"`
			Expires int    `json:"expires"`
			Path    string `json:"path"`
			Domain  string `json:"domain"`
		} `json:"mnw"`
		Shortcut struct {
			Name string `json:"name"`
		} `json:"shortcut"`
		Retention struct {
			Name    string `json:"name"`
			Value   string `json:"value"`
			Expires int    `json:"expires"`
		} `json:"retention"`
	} `json:"cookie"`
	Data struct {
		View struct {
			PrivacyPolicy struct {
				URL string `json:"url"`
			} `json:"privacy_policy"`
			GlobalConcent struct {
				Text string `json:"text"`
				Flag string `json:"flag"`
			} `json:"global_concent"`
			Terms struct {
				Text string `json:"text"`
			} `json:"terms"`
		} `json:"view"`
	} `json:"data"`
	RedirectUrl string `json:"redirect"`
}

type score struct {
}

func newMobileClient(username, password string) *MobileClient {
	// Allocate a new cookie jar to mimic the browser behavior:
	cookieJar, _ := cookiejar.New(nil)

	c := &MobileClient{
		Username: username,
		Password: password,
	}

	// When initializing the http.Client, copy default values from http.DefaultClient
	// Pass a pointer to the cookie jar that was created earlier:
	c.httpClient = &http.Client{
		Transport:     http.DefaultTransport,
		CheckRedirect: http.DefaultClient.CheckRedirect,
		Jar:           cookieJar,
		Timeout:       http.DefaultClient.Timeout,
	}

	return c
}

func (c *MobileClient) login() error {

	// Set auth info
	v := url.Values{}
	v.Set("client_id", "gundamexvs")
	v.Set("redirect_uri", redirect_uri)
	v.Set("customize_id", "")
	v.Set("login_id", c.Username)
	v.Set("password", c.Password)
	v.Set("shortcut", "0")
	v.Set("retention", "0")
	v.Set("language", "ja")
	v.Set("cookie", `{"language":"ja"}`)
	v.Set("prompt", "")

	// Post auth Info to login page
	login_page, err := c.httpClient.PostForm(login_url, v)
	if err != nil {
		log.Fatal(err)
	}
	defer login_page.Body.Close()

	// Get URL for auth page
	var l LoginResponce
	err = json.NewDecoder(login_page.Body).Decode(&l)
	if err != nil {
		log.Fatal(err)
	}

	// Request to auth page
	auth_page, err := c.httpClient.Get(l.RedirectUrl)
	if err != nil {
		log.Fatal(err)
	}
	defer auth_page.Body.Close()

	return err
}

func isMyscore(count int) bool {

	myscore := false

	if count == 0 {
		myscore = true
	}

	return myscore
}

func main() {
	m := newMobileClient(os.Args[1], os.Args[2])
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
