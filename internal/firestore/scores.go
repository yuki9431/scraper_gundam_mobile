package firestore

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/yuki9431/catalyzer/internal/model"
)

// matchDoc はFirestoreに保存するmatchesドキュメントの構造体
type matchDoc struct {
	Datetime   time.Time   `firestore:"datetime"`
	GameEndSec float64     `firestore:"game_end_sec"`
	MatchID    string      `firestore:"match_id"`
	Players    []playerDoc `firestore:"players"`
}

// playerDoc はmatchesドキュメント内のプレイヤー情報
type playerDoc struct {
	PlayerNo        int         `firestore:"player_no"`
	City            string      `firestore:"city"`
	Name            string      `firestore:"name"`
	Win             bool        `firestore:"win"`
	MsName          string      `firestore:"ms_name"`
	MsImageURL      string      `firestore:"ms_image_url"`
	Score           int         `firestore:"score"`
	Kills           int         `firestore:"kills"`
	Deaths          int         `firestore:"deaths"`
	GiveDamage      int         `firestore:"give_damage"`
	ReceiveDamage   int         `firestore:"receive_damage"`
	ExDamage        int         `firestore:"ex_damage"`
	MsProficiency   string      `firestore:"ms_proficiency"`
	TeamName        string      `firestore:"team_name"`
	PlayerLevelURL  string      `firestore:"player_level_url"`
	RankBadgeURL    string      `firestore:"rank_badge_url"`
	ProfileURL      string      `firestore:"profile_url"`
	ShuffleGradeURL string      `firestore:"shuffle_grade_url"`
	TeamGradeURL    string      `firestore:"team_grade_url"`
	ScoreRanking    int         `firestore:"score_ranking"`
	ArcadeName      string      `firestore:"arcade_name"`
	Actions         []actionDoc `firestore:"actions"`
}

// actionDoc はタイムライン内の各アクション
type actionDoc struct {
	Action         string  `firestore:"action"`
	ActionStartSec float64 `firestore:"action_start_sec"`
	ActionEndSec   float64 `firestore:"action_end_sec"`
}

// actionMapping はHTMLクラス名からFirestoreのaction値へのマッピング
var actionMapping = map[string]string{
	"ex":       "ex_standby",
	"exbst-f":  "ex_f_using",
	"exbst-s":  "ex_s_using",
	"exbst-e":  "ex_e_using",
	"ov":       "ol_standby",
	"exbst-ov": "ol_using",
}

// SaveScores はDatedScoresをFirestoreのmatchesサブコレクションに書き込む。
// タイムラインデータがある場合は各プレイヤーのactionsとして埋め込む。
func SaveScores(userKey string, scores model.DatedScores) {
	c := getClient()
	if c == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	userRef := c.Collection("users").Doc(userKey)

	_, err := userRef.Set(ctx, map[string]interface{}{
		"created_at": firestore.ServerTimestamp,
	}, firestore.MergeAll)
	if err != nil {
		log.Printf("[WARN] Firestore: failed to create user doc: %v", err)
		return
	}

	groups := groupByMatch(scores)
	matchesCol := userRef.Collection("matches")

	var count int
	bw := c.BulkWriter(ctx)

	for _, entries := range groups {
		if len(entries) != 4 {
			log.Printf("[WARN] Firestore: match %s has %d players (expected 4), skipping",
				entries[0].Datetime.Format(model.MatchKeyFormat), len(entries))
			continue
		}
		doc := buildMatchDoc(entries)
		docID := matchDocID(entries)
		if _, err := bw.Set(matchesCol.Doc(docID), doc); err != nil {
			log.Printf("[WARN] Firestore: failed to enqueue match %s: %v", docID, err)
			continue
		}
		count++
	}

	bw.End()

	log.Printf("[INFO] Firestore: saved %d matches for user %s", count, userKey)
}

// loadScoresTimeout はLoadScores用のタイムアウト（全量読み取りのため長めに設定）
const loadScoresTimeout = 120 * time.Second

// LoadScores はFirestoreからユーザーの全matchesを読み取り、datetime昇順のDatedScoresで返す。
// 各試合のMatchTimelineはPlayerNo==1のDatedScoreにセットされる。
func LoadScores(userKey string) (model.DatedScores, error) {
	c := getClient()
	if c == nil {
		return nil, fmt.Errorf("firestore client not initialized")
	}

	ctx, cancel := context.WithTimeout(context.Background(), loadScoresTimeout)
	defer cancel()

	userRef := c.Collection("users").Doc(userKey)
	docs, err := userRef.Collection("matches").OrderBy("datetime", firestore.Asc).Documents(ctx).GetAll()
	if err != nil {
		return nil, fmt.Errorf("query matches: %w", err)
	}

	return docsToScores(docs), nil
}

// LoadScoresAfter はFirestoreからユーザーのafterより後（>）のmatchesのみ読み取り、
// datetime昇順のDatedScoresで返す。差分取得用に全量読み取りを避けるためのクエリレベルフィルタ。
// 境界はBuildMatchDataのメモリフィルタ（Datetime.After(after)）と揃えて厳密な `>` とする。
func LoadScoresAfter(userKey string, after time.Time) (model.DatedScores, error) {
	c := getClient()
	if c == nil {
		return nil, fmt.Errorf("firestore client not initialized")
	}

	ctx, cancel := context.WithTimeout(context.Background(), loadScoresTimeout)
	defer cancel()

	userRef := c.Collection("users").Doc(userKey)
	docs, err := userRef.Collection("matches").
		Where("datetime", ">", after).
		OrderBy("datetime", firestore.Asc).
		Documents(ctx).GetAll()
	if err != nil {
		return nil, fmt.Errorf("query matches after %s: %w", after.Format(time.RFC3339), err)
	}

	return docsToScores(docs), nil
}

// docsToScores はmatchesドキュメント群をDatedScoresに変換する。
// 各試合のMatchTimelineはPlayerNo==1のDatedScoreにセットされる。
func docsToScores(docs []*firestore.DocumentSnapshot) model.DatedScores {
	scores := make(model.DatedScores, 0, len(docs)*4)
	for _, doc := range docs {
		var md matchDoc
		if err := doc.DataTo(&md); err != nil {
			log.Printf("[WARN] Firestore: failed to parse match doc %s: %v", doc.Ref.ID, err)
			continue
		}

		timeline := reconstructTimeline(md)

		for _, p := range md.Players {
			ds := model.DatedScore{
				PlayerNo: p.PlayerNo,
				Datetime: md.Datetime,
				MatchID:  md.MatchID,
				PlayerScore: model.PlayerScore{
					City:            p.City,
					Name:            p.Name,
					Win:             p.Win,
					MsName:          p.MsName,
					MsImageURL:      p.MsImageURL,
					Score:           p.Score,
					Kills:           p.Kills,
					Deaths:          p.Deaths,
					GiveDamage:      p.GiveDamage,
					ReceiveDamage:   p.ReceiveDamage,
					ExDamage:        p.ExDamage,
					MsProficiency:   p.MsProficiency,
					TeamName:        p.TeamName,
					PlayerLevelURL:  p.PlayerLevelURL,
					RankBadgeURL:    p.RankBadgeURL,
					ProfileURL:      p.ProfileURL,
					ShuffleGradeURL: p.ShuffleGradeURL,
					TeamGradeURL:    p.TeamGradeURL,
					ScoreRanking:    p.ScoreRanking,
					ArcadeName:      p.ArcadeName,
				},
			}
			if p.PlayerNo == 1 && timeline != nil {
				ds.MatchTimeline = timeline
			}
			scores = append(scores, ds)
		}
	}

	return scores
}

// GetLatestDatetime はFirestoreからユーザーの最新試合日時を取得する。
func GetLatestDatetime(userKey string) (time.Time, error) {
	c := getClient()
	if c == nil {
		return time.Time{}, fmt.Errorf("firestore client not initialized")
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	userRef := c.Collection("users").Doc(userKey)
	docs, err := userRef.Collection("matches").OrderBy("datetime", firestore.Desc).Limit(1).Documents(ctx).GetAll()
	if err != nil {
		return time.Time{}, fmt.Errorf("query latest datetime: %w", err)
	}
	if len(docs) == 0 {
		return time.Time{}, nil
	}

	var md matchDoc
	if err := docs[0].DataTo(&md); err != nil {
		return time.Time{}, fmt.Errorf("parse latest match: %w", err)
	}
	return md.Datetime, nil
}

// groupByMatch はDatedScoresをGroupKey()（MatchIDがあればそれ、無ければ分精度）でグルーピングする。
// #358: 分精度単独でグルーピングすると同一分の複数試合が1グループ8件に混ざり、
// len(entries)!=4判定で両試合とも欠落してしまう。
func groupByMatch(scores model.DatedScores) map[string][]model.DatedScore {
	groups := make(map[string][]model.DatedScore)
	for _, s := range scores {
		key := s.GroupKey()
		groups[key] = append(groups[key], s)
	}
	return groups
}

// matchDocID は試合のFirestore doc IDを構築する。
// 分精度の日時をベースに、MatchIDがあれば"_"+MatchIDを付与して同一分の複数試合を区別する。
// legacy（MatchID未設定）は従来通りsuffixなし（既存doc IDとの後方互換）。
func matchDocID(entries []model.DatedScore) string {
	base := entries[0].Datetime.Format(model.MatchKeyFormat)
	if entries[0].MatchID != "" {
		return base + "_" + entries[0].MatchID
	}
	return base
}

// buildMatchDoc はグルーピングされたDatedScoresからmatchDocを構築する。
func buildMatchDoc(entries []model.DatedScore) matchDoc {
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].PlayerNo < entries[j].PlayerNo
	})

	var timeline *model.MatchTimeline
	for _, e := range entries {
		if e.MatchTimeline != nil {
			timeline = e.MatchTimeline
			break
		}
	}

	playerActions := timelineToPlayerActions(timeline)

	players := make([]playerDoc, len(entries))
	for i, e := range entries {
		actions := playerActions[e.PlayerNo]
		if actions == nil {
			actions = []actionDoc{}
		}
		players[i] = playerDoc{
			PlayerNo:        e.PlayerNo,
			City:            e.PlayerScore.City,
			Name:            e.PlayerScore.Name,
			Win:             e.PlayerScore.Win,
			MsName:          e.PlayerScore.MsName,
			MsImageURL:      e.PlayerScore.MsImageURL,
			Score:           e.PlayerScore.Score,
			Kills:           e.PlayerScore.Kills,
			Deaths:          e.PlayerScore.Deaths,
			GiveDamage:      e.PlayerScore.GiveDamage,
			ReceiveDamage:   e.PlayerScore.ReceiveDamage,
			ExDamage:        e.PlayerScore.ExDamage,
			MsProficiency:   e.PlayerScore.MsProficiency,
			TeamName:        e.PlayerScore.TeamName,
			PlayerLevelURL:  e.PlayerScore.PlayerLevelURL,
			RankBadgeURL:    e.PlayerScore.RankBadgeURL,
			ProfileURL:      e.PlayerScore.ProfileURL,
			ShuffleGradeURL: e.PlayerScore.ShuffleGradeURL,
			TeamGradeURL:    e.PlayerScore.TeamGradeURL,
			ScoreRanking:    e.PlayerScore.ScoreRanking,
			ArcadeName:      e.PlayerScore.ArcadeName,
			Actions:         actions,
		}
	}

	var gameEndSec float64
	if timeline != nil {
		gameEndSec = timeline.GameEndSec
	}

	return matchDoc{
		Datetime:   entries[0].Datetime,
		GameEndSec: gameEndSec,
		MatchID:    entries[0].MatchID,
		Players:    players,
	}
}

// timelineToPlayerActions はMatchTimelineをプレイヤー番号ごとのactionDocに変換する。
func timelineToPlayerActions(mt *model.MatchTimeline) map[int][]actionDoc {
	result := make(map[int][]actionDoc)
	if mt == nil {
		return result
	}

	for _, e := range mt.Events {
		playerNo := groupToPlayerNo(e.Group)
		if playerNo == 0 {
			continue
		}

		action := mapActionName(e.ClassName, e.IsPoint)
		result[playerNo] = append(result[playerNo], actionDoc{
			Action:         action,
			ActionStartSec: e.StartSec,
			ActionEndSec:   e.EndSec,
		})
	}
	return result
}

// reconstructTimeline はmatchDocからMatchTimelineを再構築する。
func reconstructTimeline(md matchDoc) *model.MatchTimeline {
	var hasActions bool
	for _, p := range md.Players {
		if len(p.Actions) > 0 {
			hasActions = true
			break
		}
	}
	if !hasActions && md.GameEndSec == 0 {
		return nil
	}

	var events []model.MatchEvent
	for _, p := range md.Players {
		group := playerNoToGroup(p.PlayerNo)
		if group == "" {
			continue
		}
		for _, a := range p.Actions {
			className, isPoint := reverseActionName(a.Action)
			events = append(events, model.MatchEvent{
				Group:     group,
				StartSec:  a.ActionStartSec,
				EndSec:    a.ActionEndSec,
				ClassName: className,
				IsPoint:   isPoint,
			})
		}
	}

	sort.Slice(events, func(i, j int) bool {
		return events[i].StartSec < events[j].StartSec
	})

	return &model.MatchTimeline{
		Events:     events,
		GameEndSec: md.GameEndSec,
	}
}

// groupToPlayerNo はvis.jsのgroup名をプレイヤー番号に変換する。
func groupToPlayerNo(group string) int {
	if !strings.HasPrefix(group, "team") {
		return 0
	}
	switch group {
	case "team1-1":
		return 1
	case "team1-2":
		return 2
	case "team2-1":
		return 3
	case "team2-2":
		return 4
	default:
		return 0
	}
}

// playerNoToGroup はプレイヤー番号をvis.jsのgroup名に変換する。
func playerNoToGroup(playerNo int) string {
	switch playerNo {
	case 1:
		return "team1-1"
	case 2:
		return "team1-2"
	case 3:
		return "team2-1"
	case 4:
		return "team2-2"
	default:
		return ""
	}
}

// mapActionName はHTMLクラス名とisPointフラグからaction名を決定する。
func mapActionName(className string, isPoint bool) string {
	if isPoint {
		return "death"
	}
	if mapped, ok := actionMapping[className]; ok {
		return mapped
	}
	return className
}

// reverseActionName はFirestoreのaction名をHTMLクラス名とisPointフラグに変換する。
func reverseActionName(action string) (className string, isPoint bool) {
	if action == "death" {
		return "", true
	}
	for k, v := range actionMapping {
		if v == action {
			return k, false
		}
	}
	return action, false
}
