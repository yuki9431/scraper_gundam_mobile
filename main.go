package main

import (
	"log"
	"os"
)

func main() {

	datedScores := Scraiping(os.Args[1], os.Args[2])
	dailylist, _ := datedScores.GetDateList("daily")
	monthlylist, _ := datedScores.GetDateList("monthly")

	log.Println("--------- 日別の平均 ---------")

	for _, d := range dailylist {
		log.Println(d.Format("--------- 2006年01月02日 ---------"))
		count := datedScores.GetDailyScores(d).GetAverage().Count
		victories := datedScores.GetDailyScores(d).GetAverage().Victories

		log.Printf("%d戦 ", count)
		log.Printf("%d勝 ", victories)

		log.Printf("%.1f%%\n", (float64(victories) / float64(count) * 100))
		log.Println("対戦数", datedScores.GetDailyScores(d).GetAverage().Count)
		log.Println("勝利数", datedScores.GetDailyScores(d).GetAverage().Victories)
		log.Println("撃墜", datedScores.GetDailyScores(d).GetAverage().Score.Ko)
		log.Println("被撃墜", datedScores.GetDailyScores(d).GetAverage().Score.Down)
		log.Println("与ダメ", datedScores.GetDailyScores(d).GetAverage().Score.Give_damage)
		log.Println("被ダメ", datedScores.GetDailyScores(d).GetAverage().Score.Receive_damage)
		log.Println("EXダメ", datedScores.GetDailyScores(d).GetAverage().Score.Ex_damage)

	}

	log.Println("--------- 月別の平均 ---------")

	for _, m := range monthlylist {
		log.Println(m.Format("---------2006年01月 ---------"))

		count := datedScores.GetDailyMonthly(m).GetAverage().Count
		victories := datedScores.GetDailyMonthly(m).GetAverage().Victories

		log.Printf("%d戦 ", count)
		log.Printf("%d勝 ", victories)

		log.Printf("%.1f%%\n", (float64(victories) / float64(count) * 100))

		log.Println("撃墜", datedScores.GetDailyMonthly(m).GetAverage().Score.Ko)
		log.Println("被撃墜", datedScores.GetDailyMonthly(m).GetAverage().Score.Down)
		log.Println("与ダメ", datedScores.GetDailyMonthly(m).GetAverage().Score.Give_damage)
		log.Println("被ダメ", datedScores.GetDailyMonthly(m).GetAverage().Score.Receive_damage)
		log.Println("EXダメ", datedScores.GetDailyMonthly(m).GetAverage().Score.Ex_damage)

	}
}
