package main

import (
	"os"
	"fmt"
)

func main() {

	datedScores := Scraiping(os.Args[1], os.Args[2])
	dailylist, _ := datedScores.GetDateList("daily")
	monthlylist, _ := datedScores.GetDateList("monthly")

	fmt.Println("--------- 日別の平均 ---------")

	for _, d := range dailylist {
		fmt.Println(d.Format("--------- 2006年01月02日 ---------"))
		count := datedScores.GetDailyScores(d).GetAverage().Count
		victories := datedScores.GetDailyScores(d).GetAverage().Victories

		fmt.Printf("%d戦 ", count)
		fmt.Printf("%d勝 ", victories)

		fmt.Printf("%.1f%%\n", (float64(victories) / float64(count) * 100))
		fmt.Println("対戦数", datedScores.GetDailyScores(d).GetAverage().Count)
		fmt.Println("勝利数", datedScores.GetDailyScores(d).GetAverage().Victories)
		fmt.Println("撃墜", datedScores.GetDailyScores(d).GetAverage().Score.Ko)
		fmt.Println("被撃墜", datedScores.GetDailyScores(d).GetAverage().Score.Down)
		fmt.Println("与ダメ", datedScores.GetDailyScores(d).GetAverage().Score.Give_damage)
		fmt.Println("被ダメ", datedScores.GetDailyScores(d).GetAverage().Score.Receive_damage)
		fmt.Println("EXダメ", datedScores.GetDailyScores(d).GetAverage().Score.Ex_damage)

	}

	fmt.Println("--------- 月別の平均 ---------")

	for _, m := range monthlylist {
		fmt.Println(m.Format("---------2006年01月 ---------"))

		count := datedScores.GetDailyMonthly(m).GetAverage().Count
		victories := datedScores.GetDailyMonthly(m).GetAverage().Victories

		fmt.Printf("%d戦 ", count)
		fmt.Printf("%d勝 ", victories)

		fmt.Printf("%.1f%%\n", (float64(victories) / float64(count) * 100))

		fmt.Println("撃墜", datedScores.GetDailyMonthly(m).GetAverage().Score.Ko)
		fmt.Println("被撃墜", datedScores.GetDailyMonthly(m).GetAverage().Score.Down)
		fmt.Println("与ダメ", datedScores.GetDailyMonthly(m).GetAverage().Score.Give_damage)
		fmt.Println("被ダメ", datedScores.GetDailyMonthly(m).GetAverage().Score.Receive_damage)
		fmt.Println("EXダメ", datedScores.GetDailyMonthly(m).GetAverage().Score.Ex_damage)

	}
}
