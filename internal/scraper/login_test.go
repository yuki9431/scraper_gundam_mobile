package scraper

import (
	"encoding/json"
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
	long := ""
	for i := 0; i < 300; i++ {
		long += "あ"
	}
	got := []rune(sanitizeSiteMessage(long))
	if len(got) != 203 {
		t.Errorf("切り詰め後の長さ = %d, want 203", len(got))
	}
}
