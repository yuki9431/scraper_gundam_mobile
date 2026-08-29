package scraper

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"
)

// ErrLoginFailed はログイン認証に失敗した場合のエラー
var ErrLoginFailed = errors.New("ログイン認証に失敗しました")

const (
	loginURL    = "https://account-api.bandainamcoid.com/v3/login/idpw"
	redirectURI = "https://www.bandainamcoid.com/v2/oauth2/auth?back=v3&client_id=gundamexvs&scope=JpGroupAll&redirect_uri=https%3A%2F%2Fweb.vsmobile.jp%2Fexvs2ib%2Fregist&text="
)

// Client はHTTPクライアント
type Client struct {
	Username   string
	Password   string
	HTTPClient *http.Client
}

type loginResponse struct {
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
	// サイト側はリダイレクト先を redirect / redirect_no-cache のどちらかで返す。
	// 片方しか見ないとログイン成功を認証失敗と誤判定するため両方受ける。
	RedirectURL        string `json:"redirect"`
	RedirectURLNoCache string `json:"redirect_no-cache"`
	InputError         struct {
		ErrorMsg struct {
			Other string `json:"other"`
		} `json:"error_msg"`
	} `json:"input_error"`
}

// redirect はサイトが返したリダイレクト先を返す。空ならログイン未完了。
func (l loginResponse) redirect() string {
	if l.RedirectURL != "" {
		return l.RedirectURL
	}
	return l.RedirectURLNoCache
}

// sanitizeSiteMessage はサイトが返したエラーメッセージをログ/画面表示用に整える。
// <br> 等のHTMLをそのまま流さず、長すぎる本文は切り詰める。
func sanitizeSiteMessage(msg string) string {
	msg = strings.ReplaceAll(msg, "<br>", " ")
	for {
		start := strings.Index(msg, "<")
		if start < 0 {
			break
		}
		end := strings.Index(msg[start:], ">")
		if end < 0 {
			msg = msg[:start]
			break
		}
		msg = msg[:start] + msg[start+end+1:]
	}
	msg = strings.Join(strings.Fields(msg), " ")
	if len([]rune(msg)) > 200 {
		msg = string([]rune(msg)[:200]) + "..."
	}
	return msg
}

// NewClient は新しいクライアントを作成する
func NewClient(username, password string) *Client {
	cookieJar, _ := cookiejar.New(nil)

	c := &Client{
		Username: username,
		Password: password,
	}

	c.HTTPClient = &http.Client{
		Transport:     http.DefaultTransport,
		CheckRedirect: http.DefaultClient.CheckRedirect,
		Jar:           cookieJar,
		Timeout:       30 * time.Second,
	}

	return c
}

// Login はバンダイナムコIDでログインする
func (c *Client) Login() error {
	v := url.Values{}
	v.Set("client_id", "gundamexvs")
	v.Set("redirect_uri", redirectURI)
	v.Set("customize_id", "")
	v.Set("login_id", c.Username)
	v.Set("password", c.Password)
	v.Set("shortcut", "0")
	v.Set("retention", "0")
	v.Set("language", "ja")
	v.Set("cookie", `{"language":"ja"}`)
	v.Set("prompt", "")

	loginPage, err := c.HTTPClient.PostForm(loginURL, v)
	if err != nil {
		return fmt.Errorf("ログインリクエストに失敗: %w", err)
	}
	defer func() { _ = loginPage.Body.Close() }()

	var l loginResponse
	if decErr := json.NewDecoder(loginPage.Body).Decode(&l); decErr != nil {
		return fmt.Errorf("ログインレスポンスの解析に失敗: %w", decErr)
	}

	redirect := l.redirect()
	if redirect == "" {
		// サイトが理由を返している場合はそのまま添える（原因切り分けのため）
		if msg := l.InputError.ErrorMsg.Other; msg != "" {
			return fmt.Errorf("%w: %s", ErrLoginFailed, sanitizeSiteMessage(msg))
		}
		return ErrLoginFailed
	}

	if strings.Contains(redirect, "passkey") {
		return c.skipPasskey(l)
	}

	authPage, err := c.HTTPClient.Get(redirect)
	if err != nil {
		return fmt.Errorf("認証リダイレクトに失敗: %w", err)
	}
	defer func() { _ = authPage.Body.Close() }()

	return nil
}

func (c *Client) skipPasskey(l loginResponse) error {
	parsedURL, err := url.Parse(l.redirect())
	if err != nil {
		return err
	}
	q := parsedURL.Query()

	cookieJSON := map[string]string{"language": "ja"}
	if l.Cookie.Login.Name != "" {
		cookieJSON[l.Cookie.Login.Name] = l.Cookie.Login.Value
	}
	if l.Cookie.LoginCheck.Name != "" {
		cookieJSON[l.Cookie.LoginCheck.Name] = l.Cookie.LoginCheck.Value
	}
	if l.Cookie.Common.Name != "" {
		cookieJSON[l.Cookie.Common.Name] = l.Cookie.Common.Value
	}
	if l.Cookie.Mnw.Name != "" {
		cookieJSON[l.Cookie.Mnw.Name] = l.Cookie.Mnw.Value
	}
	if l.Cookie.Retention.Name != "" {
		cookieJSON[l.Cookie.Retention.Name] = l.Cookie.Retention.Value
	}
	if l.Cookie.RetentionTmp.Name != "" {
		cookieJSON[l.Cookie.RetentionTmp.Name] = l.Cookie.RetentionTmp.Value
	}
	cookieBytes, _ := json.Marshal(cookieJSON)

	params := url.Values{}
	params.Set("client_id", q.Get("client_id"))
	params.Set("backto", q.Get("backto"))
	params.Set("redirect_uri", q.Get("redirect_uri"))
	params.Set("customize_id", q.Get("customize_id"))
	params.Set("code", q.Get("code"))
	params.Set("language", "ja")
	params.Set("cookie", string(cookieBytes))

	passkeyInfoURL := "https://account-api.bandainamcoid.com/v3/passkey/info?" + params.Encode()
	skipResp, err := c.HTTPClient.Get(passkeyInfoURL)
	if err != nil {
		return err
	}
	defer func() { _ = skipResp.Body.Close() }()

	var passkeyResp map[string]interface{}
	if decErr := json.NewDecoder(skipResp.Body).Decode(&passkeyResp); decErr != nil {
		return decErr
	}

	redirectURL := ""
	if data, ok := passkeyResp["data"].(map[string]interface{}); ok {
		if btn, ok := data["btn"].(map[string]interface{}); ok {
			if btnNext, ok := btn["btn-next"].(map[string]interface{}); ok {
				if u, ok := btnNext["url"].(string); ok {
					redirectURL = u
				}
			}
		}
	}

	if redirectURL == "" {
		return fmt.Errorf("passkey/info APIからリダイレクトURLを取得できませんでした")
	}

	if cookie, ok := passkeyResp["cookie"].(map[string]interface{}); ok {
		if pi, ok := cookie["passkey_info"].(map[string]interface{}); ok {
			if name, ok := pi["name"].(string); ok {
				if value, ok := pi["value"].(string); ok {
					accountURL, _ := url.Parse("https://account.bandainamcoid.com/")
					c.HTTPClient.Jar.SetCookies(accountURL, []*http.Cookie{{Name: name, Value: value}})
				}
			}
		}
	}

	bnidURL, _ := url.Parse("https://www.bandainamcoid.com/")
	c.HTTPClient.Jar.SetCookies(bnidURL, []*http.Cookie{
		{Name: l.Cookie.Common.Name, Value: l.Cookie.Common.Value, Domain: ".bandainamcoid.com", Path: "/"},
		{Name: l.Cookie.Mnw.Name, Value: l.Cookie.Mnw.Value, Domain: ".bandainamcoid.com", Path: "/"},
	})

	authPage, err := c.HTTPClient.Get(redirectURL)
	if err != nil {
		return err
	}
	defer func() { _ = authPage.Body.Close() }()

	return nil
}

// NewCookieJar はログイン済みのCookieJarを返す
func NewCookieJar(username, password string) (http.CookieJar, error) {
	c := NewClient(username, password)
	if err := c.Login(); err != nil {
		return nil, fmt.Errorf("ログインに失敗: %w", err)
	}
	return c.HTTPClient.Jar, nil
}
