// Package model defines data types and key generation for the application.
package model

import (
	"crypto/sha256"
	"fmt"
	"time"
)

// MatchKeyFormat は試合を一意に識別するためのdatetimeフォーマット。
// MatchID未設定のlegacyデータ用フォールバックキー（分精度のため同一分に複数試合があると区別できない。#358）。
const MatchKeyFormat = "2006-01-02T1504"

// MSInfo は機体情報（画像URL → 機体名のマッピング）
type MSInfo struct {
	Name     string
	ImageURL string
	Cost     int `json:",omitempty"`
}

// PlayerScore はスコア
type PlayerScore struct {
	City            string
	Name            string
	Win             bool
	MsImageURL      string // 機体画像URL
	MsName          string
	Score           int
	Kills           int
	Deaths          int
	GiveDamage      int
	ReceiveDamage   int
	ExDamage        int
	MsProficiency   string // ランク(master, gold2, silver5等)
	TeamName        string // チーム名
	PlayerLevelURL  string // 称号画像URL
	RankBadgeURL    string // 称号バッジURL
	ProfileURL      string // プロフィールページURL
	ShuffleGradeURL string // シャッフル階級画像URL
	TeamGradeURL    string // チーム(固定)階級画像URL
	ScoreRanking    int    // 試合内スコア順位(1-4)
	ArcadeName      string // プレイ店舗名
}

// MatchEvent は試合経過の1イベント
type MatchEvent struct {
	Group     string  `json:"group"`      // team1-1, team1-2, team2-1, team2-2
	StartSec  float64 `json:"start_sec"`  // 開始時間(秒)
	EndSec    float64 `json:"end_sec"`    // 終了時間(秒、pointの場合は0)
	ClassName string  `json:"class_name"` // ex, exbst-f, exbst-s, exbst-e, ov, exbst-ov
	IsPoint   bool    `json:"is_point"`   // 被撃墜イベントか
}

// MatchTimeline は試合全体の経過データ
type MatchTimeline struct {
	Events     []MatchEvent `json:"events"`
	GameEndSec float64      `json:"game_end_sec"`
}

// DatedScore は日付付きスコア
type DatedScore struct {
	PlayerNo      int
	Datetime      time.Time
	MatchID       string // 試合の一意ID(detailURL由来。同一試合の4人で共有。legacyデータでは空。#358)
	PlayerScore   PlayerScore
	MatchTimeline *MatchTimeline // 試合経過(PlayerNo==1のときのみセット、4人で共有)
}

// GroupKey は試合をグルーピング/重複排除するためのキーを返す。
// MatchIDがあればそれを使い、同一分に複数試合があっても正しく区別する。
// legacyデータ(MatchID未設定)ではMatchKeyFormatの分精度キーにフォールバックする。
// grouping/dedupを行う全箇所(firestore/pipeline)はこのメソッドに一元化して重複を避ける。
func (d DatedScore) GroupKey() string {
	if d.MatchID != "" {
		return d.MatchID
	}
	return d.Datetime.Format(MatchKeyFormat)
}

// TagPartner はタッグ戦歴の固定相方情報
type TagPartner struct {
	TeamName   string
	PlayerName string
}

// JobStatus はジョブの状態
type JobStatus string

const (
	StatusPending   JobStatus = "pending"
	StatusScraping  JobStatus = "scraping"
	StatusDone      JobStatus = "done"
	StatusError     JobStatus = "error"
	StatusCancelled JobStatus = "cancelled" // ログアウト等でユーザーが処理を中断した状態
)

// JobSnapshot はジョブ状態のスナップショット
type JobSnapshot struct {
	ID                 string
	Status             JobStatus
	Message            string
	Progress           int
	ProgressTotal      int
	Report             string
	PreliminaryReport  string
	PreliminaryVersion int
	Error              string
	PartialData        bool
	LoggedIn           bool
	UserKey            string
}

// DatedScores は日付付きスコアのリスト
type DatedScores []DatedScore

// UserKey はユーザー名（メールアドレス）からユーザー固有のキーを生成する。
// SHA256ハッシュの先頭8バイト（16進数16文字）を返す。
func UserKey(username string) string {
	hash := sha256.Sum256([]byte(username))
	return fmt.Sprintf("%x", hash[:8])
}

// MatchIDFromURL は試合詳細ページのdetailURLから安定した一意キー（16進数16文字）を導出する。
// 1 detailURL = 1試合 = 4プレイヤーで共有、が前提（#358調査済み）。
//
// クエリ文字列の扱い: クエリを機械的にstripすると、もし試合IDがクエリ側にしか無い場合に
// 複数試合が同一MatchIDへ衝突し、GroupKey()のグルーピングで本issue(#358)の
// 「同一分の複数試合が丸ごと欠落する」症状を再発させてしまう。これを避けるため
// URL全体（クエリ含む）をハッシュ対象とする。
// なお本サイトのURLは `?param=<エンティティ固有トークン>` 形式で、同一エンティティなら
// 別ページ・別時刻でも同一paramを返す（揮発性セッショントークンではない）ことを実データで
// 確認済み。したがって同一試合のdetailURLは安定し、MatchIDも試合ごとに安定する。
func MatchIDFromURL(detailURL string) string {
	hash := sha256.Sum256([]byte(detailURL))
	return fmt.Sprintf("%x", hash[:8])
}
