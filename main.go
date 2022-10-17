package main

import (
	"fmt"
	"os"
)

func main() {
	score := GetScores(os.Args[1], os.Args[2])

	for _, v := range score {
		fmt.Println(v.datatime)
		fmt.Println(v.Ko)
		fmt.Println(v.Down)
		fmt.Println(v.Give_damage)
		fmt.Println(v.Receive_damage)
		fmt.Println(v.Ex_damage)
	}

	//score := GetScoresTest()
}
