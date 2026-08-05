package pipeline

import (
	"testing"
	"time"
)

// TestMergeScores_SameMinuteMatchIDPreserved は#358の核リグレッション。
// 既存に同一分の1試合(MatchIDあり)があり、新規に別MatchIDの同一分試合が来ても、
// 精密一致(GroupKey)でのみdedupするため両方の試合(計8エントリ)が保持されるべき。
func TestMergeScores_SameMinuteMatchIDPreserved(t *testing.T) {
	base := time.Date(2026, 7, 4, 21, 30, 0, 0, time.UTC)

	existingA := matchWithID(base, true, "match-a")
	newB := matchWithID(base, false, "match-b")

	merged := mergeScores(existingA, newB)

	if len(merged) != 8 {
		t.Fatalf("同一分・別MatchIDの2試合は両方保持されるはず(#358核心): want 8 entries, got %d", len(merged))
	}
}

// TestMergeScores_LegacySupersededByRescrape はlegacy(MatchID未設定)の既存データが、
// 同じ分の再スクレイプ結果(MatchIDあり)で正しく置換されることを確認する
// （後方互換のフォールバックdedupが機能することの検証）。
func TestMergeScores_LegacySupersededByRescrape(t *testing.T) {
	base := time.Date(2026, 7, 4, 21, 30, 0, 0, time.UTC)

	legacyExisting := match(base, true) // MatchID未設定のlegacyデータ
	rescraped := matchWithID(base, false, "match-a")

	merged := mergeScores(legacyExisting, rescraped)

	if len(merged) != 4 {
		t.Fatalf("legacy既存はその分の再スクレイプ結果に置換されるはず: want 4 entries, got %d", len(merged))
	}
	for _, s := range merged {
		if s.MatchID != "match-a" {
			t.Errorf("置換後は新側のMatchIDを持つはず: got %q", s.MatchID)
		}
	}
}
