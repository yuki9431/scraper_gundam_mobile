package main

import (
	"fmt"
	"os"
)

func main() {

	datedScores := Scraiping(os.Args[1], os.Args[2])
	dailylist, _ := datedScores.GetDateList("daily")
	monthlylist, _ := datedScores.GetDateList("monthly")

	fmt.Println("--------- 日別の平均 ---------")

	for _, d := range dailylist {
		fmt.Println(d.Format("--------- 2006年01月02日 ---------"))
		fmt.Println("撃墜", datedScores.GetDailyScores(d).GetAverage().Ko)
		fmt.Println("被撃墜", datedScores.GetDailyScores(d).GetAverage().Down)
		fmt.Println("与ダメ", datedScores.GetDailyScores(d).GetAverage().Give_damage)
		fmt.Println("被ダメ", datedScores.GetDailyScores(d).GetAverage().Receive_damage)
		fmt.Println("EXダメ", datedScores.GetDailyScores(d).GetAverage().Ex_damage)

	}

	fmt.Println("--------- 月別の平均 ---------")

	for _, m := range monthlylist {
		fmt.Println(m.Format("---------2006年01月 ---------"))
		fmt.Println("撃墜", datedScores.GetDailyMonthly(m).GetAverage().Ko)
		fmt.Println("被撃墜", datedScores.GetDailyMonthly(m).GetAverage().Down)
		fmt.Println("与ダメ", datedScores.GetDailyMonthly(m).GetAverage().Give_damage)
		fmt.Println("被ダメ", datedScores.GetDailyMonthly(m).GetAverage().Receive_damage)
		fmt.Println("EXダメ", datedScores.GetDailyMonthly(m).GetAverage().Ex_damage)

	}
}
