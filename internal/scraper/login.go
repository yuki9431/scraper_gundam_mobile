package scraper

import (
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// ErrLoginFailed はログイン認証に失敗した場合のエラー
var ErrLoginFailed = errors.New("ログイン認証に失敗しました")

const (
	loginURL       = "https://account-api.bandainamcoid.com/v3/login/idpw"
	agreeURL       = "https://account-api.bandainamcoid.com/v3/login/agree"
	passkeyInfoURL = "https://account-api.bandainamcoid.com/v3/passkey/info"
	vsLoginPage    = "https://web.vsmobile.jp/exvs2ib/login"

	// サイトのログイン画面からリンクを取得できなかったときの既定の入口。
	// 余分なパラメータを付けるとエラーページに飛ばされるため、これ以上足さない
	defaultEntryURL = "https://www.bandainamcoid.com/v2/oauth2/auth?client_id=gundamexvs&redirect_uri=https%3A%2F%2Fweb.vsmobile.jp%2Fexvs2ib%2Fregist&scope=JpGroupAll"

	// 認証チェーンの最大遷移回数。規約同意・パスキー案内が挟まっても数回で終わる
	maxAuthSteps = 6
)

// Client はHTTPクライアント
type Client struct {
	Username   string
	Password   string
	HTTPClient *http.Client
}

type loginResponse struct {
	Status string `json:"result"`
	// サイト側はリダイレクト先を redirect / redirect_no-cache のどちらかで返す。
	// 片方しか見ないとログイン成功を認証失敗と誤判定するため両方受ける。
	RedirectURL        string `json:"redirect"`
	RedirectURLNoCache string `json:"redirect_no-cache"`
	InputError         struct {
		ErrorMsg struct {
			Other string `json:"other"`
		} `json:"error_msg"`
	} `json:"input_error"`
	Data struct {
		Btn struct {
			Next struct {
				URL string `json:"url"`
			} `json:"btn-next"`
		} `json:"btn"`
	} `json:"data"`
}

// redirect はサイトが返した次の遷移先を返す。空なら遷移先なし。
func (l loginResponse) redirect() string {
	if l.RedirectURL != "" {
		return l.RedirectURL
	}
	if l.RedirectURLNoCache != "" {
		return l.RedirectURLNoCache
	}
	// passkey/info はトップレベルではなくボタンのURLとして次の遷移先を返す
	return l.Data.Btn.Next.URL
}

// cookieEntry はレスポンス本文が渡すCookie1件分の定義
type cookieEntry struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Path   string `json:"path"`
	Domain string `json:"domain"`
}

// loginCookies は本文の cookie オブジェクトをキー名を問わず受ける。
// device_id のようにサイトが後から増やすCookieにも追従するため map で取る。
type loginCookies struct {
	Cookie map[string]cookieEntry `json:"cookie"`
}

// applyLoginCookies は本文で渡されたCookieをjarに入れる。
// このAPIはSet-Cookieヘッダを返さずCookieを本文だけで渡すため、これを行わないと
// 後続のリダイレクトが未認証になりログイン画面に着地する。
func (c *Client) applyLoginCookies(body []byte) {
	var lc loginCookies
	if err := json.Unmarshal(body, &lc); err != nil {
		return
	}

	base, err := url.Parse("https://account.bandainamcoid.com/")
	if err != nil {
		return
	}

	var cookies []*http.Cookie
	for key, e := range lc.Cookie {
		// delete_* は削除指示、値なしの項目は投入対象ではない
		if strings.HasPrefix(key, "delete_") || e.Name == "" || e.Value == "" {
			continue
		}
		domain := e.Domain
		if domain == "" {
			domain = ".bandainamcoid.com"
		}
		path := e.Path
		if path == "" {
			path = "/"
		}
		cookies = append(cookies, &http.Cookie{Name: e.Name, Value: e.Value, Domain: domain, Path: path})
	}
	if len(cookies) > 0 {
		c.HTTPClient.Jar.SetCookies(base, cookies)
	}
}

// isVsmobileAuthed は認証済みのvsmobileページに着地したかを返す。
// 未認証でもログイン画面が200で返るため、ステータスコードでは判定できない。
func isVsmobileAuthed(u *url.URL) bool {
	return u != nil && u.Host == vsmobile && !strings.HasSuffix(u.Path, "/login")
}

// verifyAuthLanding は認証チェーンの着地点が認証済みページかを確かめる。
func verifyAuthLanding(resp *http.Response) error {
	if resp.Request == nil || resp.Request.URL == nil {
		return nil
	}
	if !isVsmobileAuthed(resp.Request.URL) {
		u := resp.Request.URL
		return fmt.Errorf("%w: 認証後の遷移先が %s%s", ErrLoginFailed, u.Host, u.Path)
	}
	return nil
}

var entryLinkRe = regexp.MustCompile(`https://[^"']*oauth2/auth[^"']*`)

// extractEntryURL はサイトのログイン画面からOAuth入口へのリンクを抜き出す。
// 入口URLを定数で持つとサイト側の変更で腐るため、サイトが出すリンクを使う。
func extractEntryURL(page []byte) string {
	return html.UnescapeString(entryLinkRe.FindString(string(page)))
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

// Login はバンダイナムコIDでログインする。
// OAuth入口を踏む → ID/PW送信 → 規約同意・パスキー案内を必要に応じて通過、の順で進む。
func (c *Client) Login() error {
	params, err := c.startAuthSession()
	if err != nil {
		return err
	}

	l, err := c.postCredentials(params)
	if err != nil {
		return err
	}

	return c.followAuthChain(l.redirect())
}

// startAuthSession はOAuth入口を踏み、ログイン画面のURLに載ったパラメータを返す。
// ここを踏まないと backto 等のOAuthセッションが確立せず、認証してもログイン画面に差し戻される。
func (c *Client) startAuthSession() (url.Values, error) {
	entry := defaultEntryURL
	if page, err := c.get(vsLoginPage); err == nil {
		if found := extractEntryURL(page); found != "" {
			entry = found
		}
	}

	resp, err := c.HTTPClient.Get(entry)
	if err != nil {
		return nil, fmt.Errorf("OAuth入口の取得に失敗: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, resp.Body)

	if resp.Request == nil || resp.Request.URL == nil {
		return nil, fmt.Errorf("%w: OAuth入口の遷移先を取得できません", ErrLoginFailed)
	}
	return resp.Request.URL.Query(), nil
}

// postCredentials はログイン画面のパラメータをそのまま使ってID/PWを送る。
func (c *Client) postCredentials(params url.Values) (loginResponse, error) {
	v := url.Values{}
	v.Set("client_id", params.Get("client_id"))
	v.Set("redirect_uri", params.Get("redirect_uri"))
	v.Set("customize_id", params.Get("customize_id"))
	v.Set("backto", params.Get("backto"))
	v.Set("prompt", params.Get("prompt"))
	v.Set("login_id", c.Username)
	v.Set("password", c.Password)
	v.Set("retention", "0")
	v.Set("language", "ja")
	v.Set("cookie", c.jarCookieJSON())

	return c.postAPI(loginURL, v)
}

// followAuthChain は着地したページに応じて必要な段を挟みながら認証を完了させる。
// 規約同意は同意済みだと現れず順序も一定でないため、遷移先を見て分岐する。
func (c *Client) followAuthChain(next string) error {
	for i := 0; i < maxAuthSteps; i++ {
		if next == "" {
			return ErrLoginFailed
		}

		resp, err := c.HTTPClient.Get(next)
		if err != nil {
			return fmt.Errorf("認証リダイレクトに失敗: %w", err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()

		if resp.Request == nil || resp.Request.URL == nil {
			return ErrLoginFailed
		}
		landing := resp.Request.URL
		if isVsmobileAuthed(landing) {
			return nil
		}

		var l loginResponse
		switch {
		case strings.Contains(landing.Path, "passkey"):
			l, err = c.getAPI(passkeyInfoURL, authParams(landing.Query(), "code"))
		case strings.Contains(landing.Path, "login.html"):
			l, err = c.getAPI(agreeURL, authParams(landing.Query()))
		default:
			return fmt.Errorf("%w: 未知の遷移先 %s%s", ErrLoginFailed, landing.Host, landing.Path)
		}
		if err != nil {
			return err
		}
		next = l.redirect()
	}
	return fmt.Errorf("%w: 認証が%d回の遷移で完了しません", ErrLoginFailed, maxAuthSteps)
}

// authParams は着地URLのクエリから認証APIに渡す共通パラメータを組む。
// extra には段ごとに必要な追加キー（パスキーの code など）を指定する。
func authParams(q url.Values, extra ...string) url.Values {
	v := url.Values{}
	for _, k := range append([]string{"client_id", "redirect_uri", "backto", "customize_id"}, extra...) {
		v.Set(k, q.Get(k))
	}
	v.Set("language", "ja")
	return v
}

func (c *Client) getAPI(endpoint string, v url.Values) (loginResponse, error) {
	v.Set("cookie", c.jarCookieJSON())
	resp, err := c.HTTPClient.Get(endpoint + "?" + v.Encode())
	if err != nil {
		return loginResponse{}, fmt.Errorf("認証APIの呼び出しに失敗: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	return c.parseAPIResponse(resp.Body)
}

func (c *Client) postAPI(endpoint string, v url.Values) (loginResponse, error) {
	resp, err := c.HTTPClient.PostForm(endpoint, v)
	if err != nil {
		return loginResponse{}, fmt.Errorf("認証APIの呼び出しに失敗: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	return c.parseAPIResponse(resp.Body)
}

// parseAPIResponse は応答を読み、本文Cookieをjarへ反映してから結果を返す。
func (c *Client) parseAPIResponse(r io.Reader) (loginResponse, error) {
	body, err := io.ReadAll(r)
	if err != nil {
		return loginResponse{}, fmt.Errorf("認証APIの応答読み取りに失敗: %w", err)
	}

	var l loginResponse
	if err := json.Unmarshal(body, &l); err != nil {
		return loginResponse{}, fmt.Errorf("認証APIの応答解析に失敗: %w", err)
	}
	c.applyLoginCookies(body)

	if l.Status != "" && l.Status != "OK" {
		// サイトが理由を返している場合はそのまま添える（原因切り分けのため）
		if msg := l.InputError.ErrorMsg.Other; msg != "" {
			return l, fmt.Errorf("%w: %s", ErrLoginFailed, sanitizeSiteMessage(msg))
		}
		return l, ErrLoginFailed
	}
	return l, nil
}

// jarCookieJSON はブラウザの JSON.stringify($.cookie()) 相当を作る。
// 認証APIはこの値で現在のセッション状態を判断する。
func (c *Client) jarCookieJSON() string {
	const fallback = `{"language":"ja"}`

	u, err := url.Parse("https://account.bandainamcoid.com/")
	if err != nil {
		return fallback
	}
	m := map[string]string{"language": "ja"}
	for _, ck := range c.HTTPClient.Jar.Cookies(u) {
		m[ck.Name] = ck.Value
	}
	b, err := json.Marshal(m)
	if err != nil {
		return fallback
	}
	return string(b)
}

func (c *Client) get(rawURL string) ([]byte, error) {
	resp, err := c.HTTPClient.Get(rawURL)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	return io.ReadAll(resp.Body)
}

// NewCookieJar はログイン済みのCookieJarを返す
func NewCookieJar(username, password string) (http.CookieJar, error) {
	c := NewClient(username, password)
	if err := c.Login(); err != nil {
		return nil, fmt.Errorf("ログインに失敗: %w", err)
	}
	return c.HTTPClient.Jar, nil
}
