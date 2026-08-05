package pipeline

import (
	"fmt"
	"sort"
	"time"

	fs "github.com/yuki9431/catalyzer/internal/firestore"
	"github.com/yuki9431/catalyzer/internal/model"
	"github.com/yuki9431/catalyzer/internal/mslist"
)

// ActionJSON はタイムラインの個別アクション（MatchData用）
type ActionJSON struct {
	Action         string  `json:"action"`
	ActionStartSec float64 `json:"action_start_sec"`
	ActionEndSec   float64 `json:"action_end_sec"`
}

// MatchDataSchemaVersion はMatchDataの構造バージョン。
// MatchDataにフィールドを追加/変更しクライアントの全件キャッシュ再構築が
// 必要になったら +1 する（フロントは /schema-version 経由で自動追従する）。
const MatchDataSchemaVersion = 1

// MatchData はフロントエンド向けの試合データ（プレイヤー視点）
type MatchData struct {
	Date             string `json:"date"`
	Name             string `json:"name"`
	TeamName         string `json:"team_name"`          // 自陣のタッグ名（固定タッグ時。シャッフルは空）
	OpponentTeamName string `json:"opponent_team_name"` // 敵陣のタッグ名
	MS               string `json:"ms"`
	MSCost           int    `json:"ms_cost,omitempty"`
	PartnerMS        string `json:"partner_ms"`
	PartnerCost      int    `json:"partner_cost,omitempty"`
	Opponent1MS      string `json:"opponent1_ms"`
	Opponent1Cost    int    `json:"opponent1_cost,omitempty"`
	Opponent1Name    string `json:"opponent1_name"`
	Opponent2MS      string `json:"opponent2_ms"`
	Opponent2Cost    int    `json:"opponent2_cost,omitempty"`
	Opponent2Name    string `json:"opponent2_name"`
	Win              bool   `json:"win"`
	Score            int    `json:"score"`
	Kills            int    `json:"kills"`
	Deaths           int    `json:"deaths"`
	DmgGiven         int    `json:"dmg_given"`
	DmgTaken         int    `json:"dmg_taken"`
	ExDmg            int    `json:"ex_dmg"`
	PartnerName      string `json:"partner_name"`
	PartnerScore     int    `json:"partner_score"`
	PartnerKills     int    `json:"partner_kills"`
	PartnerDeaths    int    `json:"partner_deaths"`
	PartnerDmgGiven  int    `json:"partner_dmg_given"`
	PartnerDmgTaken  int    `json:"partner_dmg_taken"`
	PartnerExDmg     int    `json:"partner_ex_dmg"`
	Bursts           int    `json:"bursts"`
	PartnerBursts    int    `json:"partner_bursts"`
	Opponent1Bursts  int    `json:"opponent1_bursts"`
	Opponent2Bursts  int    `json:"opponent2_bursts"`
	// 敵2機のスコア（公式「スコア」画面と同じ項目。覚醒回数はタイムライン側で扱う）
	Opponent1Score    int `json:"opponent1_score"`
	Opponent1Kills    int `json:"opponent1_kills"`
	Opponent1Deaths   int `json:"opponent1_deaths"`
	Opponent1DmgGiven int `json:"opponent1_dmg_given"`
	Opponent1DmgTaken int `json:"opponent1_dmg_taken"`
	Opponent1ExDmg    int `json:"opponent1_ex_dmg"`
	Opponent2Score    int `json:"opponent2_score"`
	Opponent2Kills    int `json:"opponent2_kills"`
	Opponent2Deaths   int `json:"opponent2_deaths"`
	Opponent2DmgGiven int `json:"opponent2_dmg_given"`
	Opponent2DmgTaken int `json:"opponent2_dmg_taken"`
	Opponent2ExDmg    int `json:"opponent2_ex_dmg"`
	// 各プレイヤーの追加情報（機体熟練度・試合内スコア順位）。店舗は自分の分のみ取得可能。
	Proficiency          string       `json:"proficiency"`
	PartnerProficiency   string       `json:"partner_proficiency"`
	Opponent1Proficiency string       `json:"opponent1_proficiency"`
	Opponent2Proficiency string       `json:"opponent2_proficiency"`
	ScoreRanking         int          `json:"score_ranking"`
	PartnerScoreRanking  int          `json:"partner_score_ranking"`
	Opp1ScoreRanking     int          `json:"opponent1_score_ranking"`
	Opp2ScoreRanking     int          `json:"opponent2_score_ranking"`
	Arcade               string       `json:"arcade"` // 自分のプレイ店舗のみ
	Actions              []ActionJSON `json:"actions"`
	PartnerActions       []ActionJSON `json:"partner_actions"`
	Opponent1Actions     []ActionJSON `json:"opponent1_actions"`
	Opponent2Actions     []ActionJSON `json:"opponent2_actions"`
	GameEndSec           float64      `json:"game_end_sec,omitempty"`
	MatchID              string       `json:"match_id,omitempty"`
}

// countBursts はタイムラインから指定グループの覚醒回数を数える。
func countBursts(timeline *model.MatchTimeline, group string) int {
	if timeline == nil {
		return 0
	}
	count := 0
	for _, e := range timeline.Events {
		if e.Group == group && (e.ClassName == "exbst-f" || e.ClassName == "exbst-s" || e.ClassName == "exbst-e") {
			count++
		}
	}
	return count
}

// buildActions はMatchTimelineから指定グループのアクションを抽出する。
func buildActions(timeline *model.MatchTimeline, group string) []ActionJSON {
	if timeline == nil {
		return []ActionJSON{}
	}
	var actions []ActionJSON
	for _, e := range timeline.Events {
		if e.Group != group {
			continue
		}
		action := e.ClassName
		if e.IsPoint {
			action = "death"
		}
		actions = append(actions, ActionJSON{
			Action:         action,
			ActionStartSec: e.StartSec,
			ActionEndSec:   e.EndSec,
		})
	}
	if actions == nil {
		return []ActionJSON{}
	}
	return actions
}

// BuildMatchData はDatedScoresをフロントエンド向けの試合データに変換する。
// costsMap は画像URL→コストのマッピング。afterが非ゼロの場合、その日時より後の試合のみ返す。
func BuildMatchData(ds model.DatedScores, costsMap map[string]int, after time.Time) []MatchData {
	groups := make(map[string][]model.DatedScore)
	for _, d := range ds {
		// afterフィルタ。GetMatchData経由ではLoadScoresAfterがFirestore側で
		// datetime > after に絞るためここは冗長だが、全量LoadScores経路や
		// 他呼び出し元からの安全網として残す。境界はLoadScoresAfterの `>` と
		// 揃えて厳密なAfter（>）とする——ここを >= に緩めると両者が食い違う。
		if !after.IsZero() && !d.Datetime.After(after) {
			continue
		}
		key := d.GroupKey()
		groups[key] = append(groups[key], d)
	}

	keys := make([]string, 0, len(groups))
	for k := range groups {
		keys = append(keys, k)
	}
	// #358: GroupKey()はMatchIDありだとdetailURL由来のhexになり文字列としては時系列順でない
	// ため、sort.Stringsではなく各グループのdatetimeで明示的に昇順ソートする。
	// 同一分の複数試合（datetime同値）はkey文字列で決定的にタイブレークする。
	sort.Slice(keys, func(i, j int) bool {
		di, dj := groups[keys[i]][0].Datetime, groups[keys[j]][0].Datetime
		if !di.Equal(dj) {
			return di.Before(dj)
		}
		return keys[i] < keys[j]
	})

	matches := make([]MatchData, 0, len(keys))
	for _, key := range keys {
		entries := groups[key]
		if len(entries) != 4 {
			continue
		}
		sort.Slice(entries, func(i, j int) bool {
			return entries[i].PlayerNo < entries[j].PlayerNo
		})

		me := entries[0].PlayerScore      // PlayerNo 1
		partner := entries[1].PlayerScore // PlayerNo 2
		opp1 := entries[2].PlayerScore    // PlayerNo 3
		opp2 := entries[3].PlayerScore    // PlayerNo 4

		var gameEndSec float64
		var timeline *model.MatchTimeline
		for _, e := range entries {
			if e.MatchTimeline != nil {
				gameEndSec = e.MatchTimeline.GameEndSec
				timeline = e.MatchTimeline
				break
			}
		}

		matches = append(matches, MatchData{
			Date:              entries[0].Datetime.Format("2006-01-02 15:04"),
			Name:              me.Name,
			TeamName:          me.TeamName,
			OpponentTeamName:  opp1.TeamName,
			MS:                me.MsName,
			MSCost:            costsMap[mslist.StripQuery(me.MsImageURL)],
			PartnerMS:         partner.MsName,
			PartnerCost:       costsMap[mslist.StripQuery(partner.MsImageURL)],
			Opponent1MS:       opp1.MsName,
			Opponent1Cost:     costsMap[mslist.StripQuery(opp1.MsImageURL)],
			Opponent1Name:     opp1.Name,
			Opponent2MS:       opp2.MsName,
			Opponent2Cost:     costsMap[mslist.StripQuery(opp2.MsImageURL)],
			Opponent2Name:     opp2.Name,
			Opponent1Score:    opp1.Score,
			Opponent1Kills:    opp1.Kills,
			Opponent1Deaths:   opp1.Deaths,
			Opponent1DmgGiven: opp1.GiveDamage,
			Opponent1DmgTaken: opp1.ReceiveDamage,
			Opponent1ExDmg:    opp1.ExDamage,
			Opponent2Score:    opp2.Score,
			Opponent2Kills:    opp2.Kills,
			Opponent2Deaths:   opp2.Deaths,
			Opponent2DmgGiven: opp2.GiveDamage,
			Opponent2DmgTaken: opp2.ReceiveDamage,
			Opponent2ExDmg:    opp2.ExDamage,
			Win:               me.Win,
			Score:             me.Score,
			Kills:             me.Kills,
			Deaths:            me.Deaths,
			DmgGiven:          me.GiveDamage,
			DmgTaken:          me.ReceiveDamage,
			ExDmg:             me.ExDamage,
			PartnerName:       partner.Name,
			PartnerScore:      partner.Score,
			PartnerKills:      partner.Kills,
			PartnerDeaths:     partner.Deaths,
			PartnerDmgGiven:   partner.GiveDamage,
			PartnerDmgTaken:   partner.ReceiveDamage,
			PartnerExDmg:      partner.ExDamage,
			Bursts:            countBursts(timeline, "team1-1"),
			PartnerBursts:     countBursts(timeline, "team1-2"),
			Opponent1Bursts:   countBursts(timeline, "team2-1"),
			Opponent2Bursts:   countBursts(timeline, "team2-2"),
			Actions:           buildActions(timeline, "team1-1"),
			PartnerActions:    buildActions(timeline, "team1-2"),
			Opponent1Actions:  buildActions(timeline, "team2-1"),
			Opponent2Actions:  buildActions(timeline, "team2-2"),
			// 追加情報（機体熟練度・試合内順位・階級・プレイ店舗）
			Proficiency:          me.MsProficiency,
			PartnerProficiency:   partner.MsProficiency,
			Opponent1Proficiency: opp1.MsProficiency,
			Opponent2Proficiency: opp2.MsProficiency,
			ScoreRanking:         me.ScoreRanking,
			PartnerScoreRanking:  partner.ScoreRanking,
			Opp1ScoreRanking:     opp1.ScoreRanking,
			Opp2ScoreRanking:     opp2.ScoreRanking,
			Arcade:               me.ArcadeName,
			GameEndSec:           gameEndSec,
			MatchID:              entries[0].MatchID,
		})
	}

	return matches
}

// GetMatchData はFirestoreからscoresを読み取り、フロントエンド向けの試合データを返す。
// afterが非ゼロの場合はFirestoreクエリレベルで差分（datetime > after）のみ読み取り、
// 全量読み取りによるレイテンシと読み取りコストを避ける。
func GetMatchData(userKey string, after time.Time) ([]MatchData, error) {
	var scores model.DatedScores
	var err error
	if after.IsZero() {
		scores, err = fs.LoadScores(userKey)
	} else {
		scores, err = fs.LoadScoresAfter(userKey, after)
	}
	if err != nil {
		return nil, fmt.Errorf("load scores: %w", err)
	}

	msList, err := mslist.LoadMSList(DefaultMSListPath)
	if err != nil {
		msList = nil
	}
	msMap := mslist.BuildMSNameMap(msList)
	mslist.FillMsNames(scores, msMap)

	costsMap := mslist.BuildMSCostMap(msList)
	return BuildMatchData(scores, costsMap, after), nil
}
