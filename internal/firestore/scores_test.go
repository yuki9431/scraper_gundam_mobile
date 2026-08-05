package firestore

import (
	"testing"
	"time"

	"github.com/yuki9431/catalyzer/internal/model"
)

// scoresFor は4人分のDatedScoreを同一datetime・同一MatchIDで生成するテストヘルパー。
func scoresFor(dt time.Time, matchID string) model.DatedScores {
	ds := make(model.DatedScores, 4)
	for i := 0; i < 4; i++ {
		ds[i] = model.DatedScore{
			PlayerNo: i + 1,
			Datetime: dt,
			MatchID:  matchID,
		}
	}
	return ds
}

// TestGroupByMatch_SameMinuteDistinctMatchID は#358の核リグレッション。
// 同一datetime・異なるMatchIDの8エントリは、分精度キーではなくGroupKey()(=MatchID)で
// グルーピングされ、2グループ×4件になるべき（分精度のままだと1グループ8件で
// len!=4判定によりどちらの試合もFirestoreに保存されず欠落する）。
func TestGroupByMatch_SameMinuteDistinctMatchID(t *testing.T) {
	dt := time.Date(2026, 7, 4, 21, 30, 0, 0, time.UTC)

	var scores model.DatedScores
	scores = append(scores, scoresFor(dt, "match-a")...)
	scores = append(scores, scoresFor(dt, "match-b")...)

	groups := groupByMatch(scores)

	if len(groups) != 2 {
		t.Fatalf("同一分でもMatchIDが異なる2試合は別グループになるはず: want 2 groups, got %d", len(groups))
	}
	for key, entries := range groups {
		if len(entries) != 4 {
			t.Errorf("group %q: want 4 entries, got %d", key, len(entries))
		}
	}
}

// TestGroupByMatch_LegacyFallback はMatchID未設定(legacyデータ)が分精度キーで
// グルーピングされる後方互換のフォールバック挙動を確認する。
func TestGroupByMatch_LegacyFallback(t *testing.T) {
	dt := time.Date(2026, 7, 4, 21, 30, 0, 0, time.UTC)

	scores := scoresFor(dt, "")

	groups := groupByMatch(scores)
	if len(groups) != 1 {
		t.Fatalf("legacyデータ(MatchID未設定)は分精度キー1グループにまとまるはず: got %d groups", len(groups))
	}
	key := dt.Format(model.MatchKeyFormat)
	if len(groups[key]) != 4 {
		t.Errorf("legacyグループのキーは分精度フォーマットのはず: groups=%v", groups)
	}
}

func TestMatchDocID(t *testing.T) {
	dt := time.Date(2026, 7, 4, 21, 30, 0, 0, time.UTC)

	withID := scoresFor(dt, "abc123")
	id := matchDocID(withID)
	want := dt.Format(model.MatchKeyFormat) + "_abc123"
	if id != want {
		t.Errorf("MatchIDありのdoc IDは分精度+\"_\"+MatchIDのはず: got %q, want %q", id, want)
	}

	legacy := scoresFor(dt, "")
	legacyID := matchDocID(legacy)
	wantLegacy := dt.Format(model.MatchKeyFormat)
	if legacyID != wantLegacy {
		t.Errorf("legacy(MatchID空)のdoc IDはsuffixなしのはず: got %q, want %q", legacyID, wantLegacy)
	}
}
