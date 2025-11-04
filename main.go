package main

import (
	"log"
	"os"
)

func main() {
	// 引数チェック: username, password, csvPath の3つが必要
	if len(os.Args) < 4 {
		log.Fatalf("Usage: %s <username> <password> <csv_path>", os.Args[0])
	}

	username := os.Args[1]
	password := os.Args[2]
	csvPath := os.Args[3]

	datedScores := Scraiping(username, password)

	if err := SaveAllScoresCSV(datedScores, csvPath); err != nil {
		log.Fatalf("[ERROR] Failed to save CSV: %v", err)
	}

	log.Println("[INFO] Scores successfully saved to", csvPath)
}
