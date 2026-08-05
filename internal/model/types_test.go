package model

import (
	"testing"
	"time"
)

func TestUserKey(t *testing.T) {
	key := UserKey("test@example.com")

	if len(key) != 16 {
		t.Errorf("UserKey length = %d, want 16 (8 bytes hex)", len(key))
	}

	key2 := UserKey("test@example.com")
	if key != key2 {
		t.Error("same input should produce same key")
	}

	key3 := UserKey("other@example.com")
	if key == key3 {
		t.Error("different input should produce different key")
	}
}

func TestUserKey_Empty(t *testing.T) {
	key := UserKey("")
	if len(key) != 16 {
		t.Errorf("UserKey(\"\") length = %d, want 16", len(key))
	}
}

func TestUserKey_KnownValue(t *testing.T) {
	// SHA256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
	// 先頭8バイト = 2cf24dba5fb0a30e
	key := UserKey("hello")
	if key != "2cf24dba5fb0a30e" {
		t.Errorf("UserKey(\"hello\") = %q, want %q", key, "2cf24dba5fb0a30e")
	}
}

func TestMatchIDFromURL(t *testing.T) {
	url := "https://web.vsmobile.jp/exvs2ib/results/classmatch/fight/detail?id=1"
	id := MatchIDFromURL(url)

	if len(id) != 16 {
		t.Errorf("MatchIDFromURL length = %d, want 16 (8 bytes hex)", len(id))
	}

	id2 := MatchIDFromURL(url)
	if id != id2 {
		t.Error("same detailURL should produce same MatchID (idempotent, required for re-scrape safety)")
	}

	other := MatchIDFromURL("https://web.vsmobile.jp/exvs2ib/results/classmatch/fight/detail?id=2")
	if id == other {
		t.Error("different detailURL should produce different MatchID")
	}
}

// TestMatchIDFromURL_QueryDistinguishes は#358のクエリ扱いの判断点を固定する回帰テスト。
// 実URLサンプルを認証なしに確認できなかったため安全側に倒し、クエリを含めたURL全体を
// ハッシュする（クエリのみ異なる2試合を誤って同一MatchIDに衝突させると#358が再発するため）。
func TestMatchIDFromURL_QueryDistinguishes(t *testing.T) {
	base := "https://web.vsmobile.jp/exvs2ib/results/classmatch/fight/detail"
	id1 := MatchIDFromURL(base + "?id=1")
	id2 := MatchIDFromURL(base + "?id=2")
	if id1 == id2 {
		t.Error("クエリのみが異なるURLは別のMatchIDになるべき（クエリをstripするとID衝突で#358が再発する恐れ）")
	}
}

func TestDatedScore_GroupKey(t *testing.T) {
	dt := time.Date(2026, 7, 4, 21, 30, 0, 0, time.UTC)

	withID := DatedScore{Datetime: dt, MatchID: "abc123"}
	if got := withID.GroupKey(); got != "abc123" {
		t.Errorf("MatchIDがあればそれを使うはず: got %q", got)
	}

	legacy := DatedScore{Datetime: dt}
	want := dt.Format(MatchKeyFormat)
	if got := legacy.GroupKey(); got != want {
		t.Errorf("MatchID未設定ならlegacyの分精度キーにフォールバックするはず: got %q, want %q", got, want)
	}
}

func TestJobStatus_Constants(t *testing.T) {
	statuses := []JobStatus{StatusPending, StatusScraping, StatusDone, StatusError, StatusCancelled}
	expected := []string{"pending", "scraping", "done", "error", "cancelled"}

	for i, s := range statuses {
		if string(s) != expected[i] {
			t.Errorf("status %d: got %q, want %q", i, s, expected[i])
		}
	}
}
