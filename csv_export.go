package main

import (
	"encoding/csv"
	"io"
	"os"
	"strconv"
)

// exportAllScoresCSV writes all DatedScore entries to the provided writer as CSV.
func exportAllScoresCSV(ds DatedScores, w io.Writer) error {
	csvw := csv.NewWriter(w)
	defer csvw.Flush()

	header := []string{"試合日時", "プレイヤーNo.", "地域", "プレイヤー名", "勝利判定", "スコア", "撃墜数", "被撃墜数", "与ダメージ", "被ダメージ", "EXダメージ"}
	if err := csvw.Write(header); err != nil {
		return err
	}

	for _, d := range ds {
		row := []string{
			d.Datatime.Format("2006-01-02 15:04"),
			strconv.Itoa(d.PlayerNo),
			d.PlayerScore.City,
			d.PlayerScore.Name,
			d.PlayerScore.Win,
			strconv.Itoa(d.PlayerScore.Point),
			strconv.Itoa(d.PlayerScore.Ko),
			strconv.Itoa(d.PlayerScore.Down),
			strconv.Itoa(d.PlayerScore.Give_damage),
			strconv.Itoa(d.PlayerScore.Receive_damage),
			strconv.Itoa(d.PlayerScore.Ex_damage),
		}
		if err := csvw.Write(row); err != nil {
			return err
		}
	}

	return nil
}

// SaveAllScoresCSV creates (or truncates) the file at path and writes CSV into it.
func SaveAllScoresCSV(ds DatedScores, path string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return exportAllScoresCSV(ds, f)
}
