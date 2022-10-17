package main

import (
	"encoding/json"
	"log"
	"net/http"
	"net/http/cookiejar"
	"net/url"
)

const (
	login_url       = "https://account-api.bandainamcoid.com/v3/login/idpw"
	redirect_uri    = "https://www.bandainamcoid.com/v2/oauth2/auth?back=v3&client_id=gundamexvs&scope=JpGroupAll&redirect_uri=https://web.vsmobile.jp/exvs2xb/regist&text="
	mobile_rankpage = "https://web.vsmobile.jp/exvs2xb/results/fight/rank"
)

type client struct {
	Username   string
	Password   string
	httpClient *http.Client
}

type loginResponce struct {
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

func newClient(username, password string) *client {
	// Allocate a new cookie jar to mimic the browser behavior:
	cookieJar, _ := cookiejar.New(nil)

	c := &client{
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

func (c *client) login() error {

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
	var l loginResponce
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

func NewCookieJar(username, password string) (http.CookieJar, error) {
	c := newClient(username, password)
	err := c.login()
	if err != nil {
		log.Fatal(err)
	}

	return c.httpClient.Jar, err
}
