package scraper

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestLoginResponseRedirect(t *testing.T) {
	tests := []struct {
		name string
		body string
		want string
	}{
		{
			name: "redirectフィールド",
			body: `{"result":"OK","redirect":"https://example.com/a"}`,
			want: "https://example.com/a",
		},
		{
			// サイト側が2025年時点で返すフィールド名。これを見落とすと
			// ログイン成功を認証失敗と誤判定する
			name: "redirect_no-cacheフィールド",
			body: `{"result":"OK","redirect_no-cache":"https://example.com/b"}`,
			want: "https://example.com/b",
		},
		{
			name: "両方あればredirect優先",
			body: `{"redirect":"https://example.com/a","redirect_no-cache":"https://example.com/b"}`,
			want: "https://example.com/a",
		},
		{
			name: "どちらも無ければ空",
			body: `{"result":"OK","input_error":{"error_msg":{"other":"NG"}}}`,
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var l loginResponse
			if err := json.Unmarshal([]byte(tt.body), &l); err != nil {
				t.Fatalf("Unmarshal失敗: %v", err)
			}
			if got := l.redirect(); got != tt.want {
				t.Errorf("redirect() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestSanitizeSiteMessage(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "brタグを空白に",
			in:   "パスワードが違います<br>再入力してください",
			want: "パスワードが違います 再入力してください",
		},
		{
			name: "任意のタグを除去",
			in:   `<a href="x">リンク</a>あり`,
			want: "リンクあり",
		},
		{
			name: "閉じない山括弧は以降を落とす",
			in:   "本文<script",
			want: "本文",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := sanitizeSiteMessage(tt.in); got != tt.want {
				t.Errorf("sanitizeSiteMessage() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestSanitizeSiteMessageTruncates(t *testing.T) {
	got := []rune(sanitizeSiteMessage(strings.Repeat("あ", 300)))
	if len(got) != 203 {
		t.Errorf("切り詰め後の長さ = %d, want 203", len(got))
	}
}

// TestApplyLoginCookies は、Set-Cookieヘッダを返さないログインAPIの本文Cookieを
// jarへ投入できることを確認する。投入漏れがあると後続のリダイレクトが未認証になり
// ログイン画面に着地して「ログイン成功なのに戦績0件」になる。
func TestApplyLoginCookies(t *testing.T) {
	// 実際のレスポンスに合わせた形。device_id は後から増えたキー、delete_* は削除指示
	body := []byte(`{
		"result": "OK",
		"cookie": {
			"login":         {"name": "login", "value": "L1", "expires": 0},
			"login_check":   {"name": "login_check", "value": "LC1", "expires": 0},
			"common":        {"name": "common", "value": "C1", "path": "/", "domain": ".bandainamcoid.com"},
			"mnw":           {"name": "mnw", "value": "M1", "path": "/", "domain": ".bandainamcoid.com"},
			"device_id":     {"name": "device_id", "value": "D1"},
			"delete_login":  {"name": "login"},
			"delete_common": {"name": "common", "path": "/", "domain": ".bandainamcoid.com"},
			"shortcut":      {"name": "shortcut"}
		}
	}`)

	c := NewClient("user@example.com", "pw")
	c.applyLoginCookies(body)

	got := cookieNames(t, c, "https://account.bandainamcoid.com/")
	for _, want := range []string{"login", "login_check", "common", "mnw", "device_id"} {
		if !got[want] {
			t.Errorf("account.bandainamcoid.com に %s が入っていない (got %v)", want, got)
		}
	}
	// 値が無い項目(削除指示・shortcut)を投入してはいけない
	if got["shortcut"] {
		t.Errorf("値の無い shortcut を投入している (got %v)", got)
	}

	// domain指定のあるCookieは親ドメイン配下の別ホストにも送られる必要がある
	if !cookieNames(t, c, "https://www.bandainamcoid.com/")["common"] {
		t.Error("www.bandainamcoid.com に common が送られない")
	}
	// 無関係なドメインに漏らさない
	if len(cookieNames(t, c, "https://web.vsmobile.jp/")) != 0 {
		t.Error("web.vsmobile.jp にバンナムIDのCookieが漏れている")
	}
}

func cookieNames(t *testing.T, c *Client, rawURL string) map[string]bool {
	t.Helper()
	u, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("URL解析失敗: %v", err)
	}
	names := map[string]bool{}
	for _, ck := range c.HTTPClient.Jar.Cookies(u) {
		names[ck.Name] = true
	}
	return names
}

// TestVerifyAuthLanding は、未認証でもログイン画面が200で返るサイト仕様に対し、
// 着地点で成功/失敗を判定できることを確認する。
func TestVerifyAuthLanding(t *testing.T) {
	tests := []struct {
		name    string
		final   string
		wantErr bool
	}{
		{name: "vsmobileの認証済みページ", final: "https://web.vsmobile.jp/exvs2ib/regist", wantErr: false},
		{name: "vsmobileのログイン画面", final: "https://web.vsmobile.jp/exvs2ib/login", wantErr: true},
		{name: "バンナムIDのログイン画面", final: "https://account.bandainamcoid.com/login.html", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			u, err := url.Parse(tt.final)
			if err != nil {
				t.Fatalf("URL解析失敗: %v", err)
			}
			err = verifyAuthLanding(&http.Response{Request: &http.Request{URL: u}})
			if tt.wantErr && !errors.Is(err, ErrLoginFailed) {
				t.Fatalf("ErrLoginFailed を期待したが got: %v", err)
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("エラー無しを期待したが got: %v", err)
			}
		})
	}
}

// TestExtractEntryURL は、サイトのログイン画面からOAuth入口URLを抜けることを確認する。
// 実際のHTMLは href の閉じ引用符と class の間に空白が無い壊れた書き方をしており、
// HTMLパーサに頼ると崩れるため生バイトから正規表現で拾っている。
func TestExtractEntryURL(t *testing.T) {
	page := []byte(`<div class="content top text-center">` +
		`<a href="https://www.bandainamcoid.com/v2/oauth2/auth?client_id=gundamexvs` +
		`&amp;redirect_uri=https%3A%2F%2Fweb.vsmobile.jp%2Fexvs2ib%2Fregist` +
		`&amp;scope=JpGroupAll"class="entry"><img src="x.png"></a></div>`)

	got := extractEntryURL(page)
	want := "https://www.bandainamcoid.com/v2/oauth2/auth?client_id=gundamexvs" +
		"&redirect_uri=https%3A%2F%2Fweb.vsmobile.jp%2Fexvs2ib%2Fregist&scope=JpGroupAll"
	if got != want {
		t.Errorf("got  %q\nwant %q", got, want)
	}

	// 入口リンクが無いページでは空を返し、既定URLへのフォールバックに任せる
	if got := extractEntryURL([]byte(`<html><body>no link</body></html>`)); got != "" {
		t.Errorf("リンクが無いページでは空を期待したが got: %q", got)
	}
}

// TestLoginResponseRedirectBtnNext は、passkey/info がトップレベルではなく
// data.btn.btn-next.url で次の遷移先を返すケースを拾えることを確認する。
func TestLoginResponseRedirectBtnNext(t *testing.T) {
	body := `{"result":"OK","data":{"btn":{"btn-next":{"url":"https://example.com/next"}}}}`

	var l loginResponse
	if err := json.Unmarshal([]byte(body), &l); err != nil {
		t.Fatalf("解析失敗: %v", err)
	}
	if got := l.redirect(); got != "https://example.com/next" {
		t.Errorf("btn-next のURLを期待したが got: %q", got)
	}
}

// TestAuthParams は、着地URLのクエリから認証APIに渡すパラメータを組めることを確認する。
func TestAuthParams(t *testing.T) {
	q, err := url.ParseQuery("client_id=gundamexvs&redirect_uri=https%3A%2F%2Fx&backto=B1&customize_id=&code=C1&other=zzz")
	if err != nil {
		t.Fatalf("クエリ解析失敗: %v", err)
	}

	// code を要求しない段では載せない（passkey以外に余計なキーを送らない）
	got := authParams(q)
	if got.Has("code") {
		t.Errorf("codeを要求していないのに載っている: %v", got)
	}
	if got.Get("backto") != "B1" || got.Get("client_id") != "gundamexvs" {
		t.Errorf("必要なパラメータが揃っていない: %v", got)
	}
	if got.Has("other") {
		t.Errorf("関係ないパラメータを転送している: %v", got)
	}
	if got.Get("language") != "ja" {
		t.Errorf("languageが設定されていない: %v", got)
	}

	// passkey段では code を載せる
	if got := authParams(q, "code"); got.Get("code") != "C1" {
		t.Errorf("codeが載っていない: %v", got)
	}
}
