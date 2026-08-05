package pipeline

import (
	"testing"
	"time"

	"github.com/yuki9431/catalyzer/internal/model"
)

// match は4人分のDatedScoreを同一datetimeで生成するテストヘルパー。
// PlayerNo 1..4 に p1Win を自分(PlayerNo 1)の勝敗として割り当てる。
func match(dt time.Time, p1Win bool) model.DatedScores {
	ds := make(model.DatedScores, 4)
	for i := 0; i < 4; i++ {
		teamName := "myteam" // PlayerNo 1,2 は自陣
		if i >= 2 {
			teamName = "enemyteam" // PlayerNo 3,4 は敵陣
		}
		ds[i] = model.DatedScore{
			PlayerNo: i + 1,
			Datetime: dt,
			PlayerScore: model.PlayerScore{
				Name:     string(rune('a' + i)),
				TeamName: teamName,
				Win:      (i < 2) == p1Win, // team1(PlayerNo 1,2)はp1Winと同じ勝敗
			},
		}
	}
	return ds
}

// matchWithID はmatch()の結果にMatchIDを付与するテストヘルパー
// （同一分の複数試合を区別するケースの検証用。#358）。
func matchWithID(dt time.Time, p1Win bool, matchID string) model.DatedScores {
	ds := match(dt, p1Win)
	for i := range ds {
		ds[i].MatchID = matchID
	}
	return ds
}

func TestBuildMatchData_AfterBoundaryIsStrict(t *testing.T) {
	base := time.Date(2026, 7, 4, 21, 30, 0, 0, time.UTC)

	var scores model.DatedScores
	// after と完全一致（境界そのもの）— 厳密な > なので除外されるべき
	scores = append(scores, match(base, true)...)
	// after より1分後 — 含まれるべき
	scores = append(scores, match(base.Add(time.Minute), false)...)
	// after より前 — 除外されるべき
	scores = append(scores, match(base.Add(-time.Minute), true)...)

	got := BuildMatchData(scores, nil, base)

	if len(got) != 1 {
		t.Fatalf("境界(=after)と過去は除外し、after超のみ返すはず: want 1 match, got %d", len(got))
	}
	wantDate := base.Add(time.Minute).Format("2006-01-02 15:04")
	if got[0].Date != wantDate {
		t.Errorf("返された試合の日時が不正: want %q, got %q", wantDate, got[0].Date)
	}
}

func TestBuildMatchData_PopulatesTeamNames(t *testing.T) {
	base := time.Date(2026, 7, 4, 21, 30, 0, 0, time.UTC)

	got := BuildMatchData(match(base, true), nil, time.Time{})
	if len(got) != 1 {
		t.Fatalf("want 1 match, got %d", len(got))
	}
	// 自陣=PlayerNo1のTeamName、敵陣=PlayerNo3のTeamName。
	if got[0].TeamName != "myteam" {
		t.Errorf("TeamName: want %q, got %q", "myteam", got[0].TeamName)
	}
	if got[0].OpponentTeamName != "enemyteam" {
		t.Errorf("OpponentTeamName: want %q, got %q", "enemyteam", got[0].OpponentTeamName)
	}
}

func TestBuildMatchData_PopulatesPlayerNames(t *testing.T) {
	base := time.Date(2026, 7, 4, 21, 30, 0, 0, time.UTC)

	got := BuildMatchData(match(base, true), nil, time.Time{})
	if len(got) != 1 {
		t.Fatalf("want 1 match, got %d", len(got))
	}
	// match ヘルパーは PlayerNo 1..4 に 'a'..'d' を割り当てる。
	// 自分=PlayerNo1='a'、相方=PlayerNo2='b'、敵1=PlayerNo3='c'、敵2=PlayerNo4='d'。
	if got[0].Name != "a" {
		t.Errorf("Name: want %q, got %q", "a", got[0].Name)
	}
	if got[0].PartnerName != "b" {
		t.Errorf("PartnerName: want %q, got %q", "b", got[0].PartnerName)
	}
	if got[0].Opponent1Name != "c" {
		t.Errorf("Opponent1Name: want %q, got %q", "c", got[0].Opponent1Name)
	}
	if got[0].Opponent2Name != "d" {
		t.Errorf("Opponent2Name: want %q, got %q", "d", got[0].Opponent2Name)
	}
}

func TestBuildMatchData_PopulatesOpponentScores(t *testing.T) {
	dt := time.Date(2026, 7, 4, 21, 30, 0, 0, time.UTC)
	// PlayerNo 3,4 が敵。区別できるようスコアを変えて設定する。
	ds := model.DatedScores{
		{PlayerNo: 1, Datetime: dt, PlayerScore: model.PlayerScore{Win: true}},
		{PlayerNo: 2, Datetime: dt, PlayerScore: model.PlayerScore{Win: true}},
		{PlayerNo: 3, Datetime: dt, PlayerScore: model.PlayerScore{
			Score: 22372, Kills: 2, Deaths: 2, GiveDamage: 849, ReceiveDamage: 1360, ExDamage: 283,
		}},
		{PlayerNo: 4, Datetime: dt, PlayerScore: model.PlayerScore{
			Score: 10328, Kills: 0, Deaths: 1, GiveDamage: 471, ReceiveDamage: 720, ExDamage: 0,
		}},
	}

	got := BuildMatchData(ds, nil, time.Time{})
	if len(got) != 1 {
		t.Fatalf("want 1 match, got %d", len(got))
	}
	m := got[0]
	if m.Opponent1Score != 22372 || m.Opponent1Kills != 2 || m.Opponent1Deaths != 2 ||
		m.Opponent1DmgGiven != 849 || m.Opponent1DmgTaken != 1360 || m.Opponent1ExDmg != 283 {
		t.Errorf("Opponent1 scores mismatch: %+v", m)
	}
	if m.Opponent2Score != 10328 || m.Opponent2Kills != 0 || m.Opponent2Deaths != 1 ||
		m.Opponent2DmgGiven != 471 || m.Opponent2DmgTaken != 720 || m.Opponent2ExDmg != 0 {
		t.Errorf("Opponent2 scores mismatch: %+v", m)
	}
}

func TestBuildMatchData_ZeroAfterReturnsAll(t *testing.T) {
	base := time.Date(2026, 7, 4, 21, 30, 0, 0, time.UTC)

	var scores model.DatedScores
	scores = append(scores, match(base, true)...)
	scores = append(scores, match(base.Add(time.Hour), false)...)

	got := BuildMatchData(scores, nil, time.Time{})

	if len(got) != 2 {
		t.Fatalf("afterゼロ値なら全試合を返すはず: want 2 matches, got %d", len(got))
	}
	// datetime昇順で返ること
	if got[0].Date >= got[1].Date {
		t.Errorf("試合はdatetime昇順で返るはず: got[0]=%q got[1]=%q", got[0].Date, got[1].Date)
	}
}

func TestBuildMatchData_IncompleteMatchDropped(t *testing.T) {
	base := time.Date(2026, 7, 4, 21, 30, 0, 0, time.UTC)

	// 3人しかいない試合はスキップされる（4人揃わないと集計できない）
	scores := match(base, true)[:3]

	got := BuildMatchData(scores, nil, time.Time{})

	if len(got) != 0 {
		t.Fatalf("4人揃わない試合はスキップされるはず: want 0, got %d", len(got))
	}
}

// TestBuildMatchData_SameMinuteTwoMatches は#358の核リグレッション。
// 同一分に2試合あっても、MatchIDが異なれば両方とも集計に含まれるべき（欠落ゼロ）。
func TestBuildMatchData_SameMinuteTwoMatches(t *testing.T) {
	base := time.Date(2026, 7, 4, 21, 30, 0, 0, time.UTC)

	var scores model.DatedScores
	scores = append(scores, matchWithID(base, true, "match-a")...)
	scores = append(scores, matchWithID(base, false, "match-b")...)

	got := BuildMatchData(scores, nil, time.Time{})

	if len(got) != 2 {
		t.Fatalf("同一分でもMatchIDが異なれば両試合とも集計に含まれるはず(#358): want 2 matches, got %d", len(got))
	}
	if got[0].MatchID == got[1].MatchID {
		t.Errorf("2試合のMatchIDは異なるはず: got[0]=%q got[1]=%q", got[0].MatchID, got[1].MatchID)
	}
}
