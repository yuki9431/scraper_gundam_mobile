package main

import (
	"fmt"
	"os"
)

func main() {

	datedScores := Scraiping(os.Args[1], os.Args[2])
	dailylist, _ := datedScores.GetDateList("daily")
	monthlylist, _ := datedScores.GetDateList("monthly")

	fmt.Println("")
	fmt.Println("--------- 日別の平均 ---------")

	for _, d := range dailylist {
		fmt.Println(d.Format("--------- 2006年01月02日 ---------"))
		count := datedScores.GetDailyScores(d).GetAverage().Game_count
		victories := datedScores.GetDailyScores(d).GetAverage().Victories

		fmt.Printf("%d戦 ", count)
		fmt.Printf("%d勝 ", victories)

		fmt.Printf("%.1f%%\n", (float64(victories) / float64(count) * 100))
		fmt.Println("対戦数", datedScores.GetDailyScores(d).GetAverage().Game_count)
		fmt.Println("勝利数", datedScores.GetDailyScores(d).GetAverage().Victories)
		fmt.Println("スコア", datedScores.GetMonthlyScores(d).GetAverage().PlayerScore.Point)
		fmt.Println("撃墜", datedScores.GetDailyScores(d).GetAverage().PlayerScore.Ko)
		fmt.Println("被撃墜", datedScores.GetDailyScores(d).GetAverage().PlayerScore.Down)
		fmt.Println("与ダメ", datedScores.GetDailyScores(d).GetAverage().PlayerScore.Give_damage)
		fmt.Println("被ダメ", datedScores.GetDailyScores(d).GetAverage().PlayerScore.Receive_damage)
		fmt.Println("EXダメ", datedScores.GetDailyScores(d).GetAverage().PlayerScore.Ex_damage)

	}

	fmt.Println("--------- 月別の平均 ---------")

	for _, m := range monthlylist {
		fmt.Println(m.Format("---------2006年01月 ---------"))

		count := datedScores.GetMonthlyScores(m).GetAverage().Game_count
		victories := datedScores.GetMonthlyScores(m).GetAverage().Victories

		fmt.Printf("%d戦 ", count)
		fmt.Printf("%d勝 ", victories)

		fmt.Printf("%.1f%%\n", (float64(victories) / float64(count) * 100))

		fmt.Println("スコア", datedScores.GetMonthlyScores(m).GetAverage().PlayerScore.Point)
		fmt.Println("撃墜", datedScores.GetMonthlyScores(m).GetAverage().PlayerScore.Ko)
		fmt.Println("被撃墜", datedScores.GetMonthlyScores(m).GetAverage().PlayerScore.Down)
		fmt.Println("与ダメ", datedScores.GetMonthlyScores(m).GetAverage().PlayerScore.Give_damage)
		fmt.Println("被ダメ", datedScores.GetMonthlyScores(m).GetAverage().PlayerScore.Receive_damage)
		fmt.Println("EXダメ", datedScores.GetMonthlyScores(m).GetAverage().PlayerScore.Ex_damage)

	}
}
