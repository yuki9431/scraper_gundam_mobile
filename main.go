package main

import (
	"fmt"
	"flag"
	"log"
	"os"
)


var usage = `Usage:
  netDeCommon [options] -usr [<userId>] -pwd [<password>]
  netDeCommon -come -usr UserId -pwd Password
Options:
  -h                ヘルプを表示
  -u <userId>       ユーザID
  -p <password>     パスワード`

func main() {
	// help
	help := flag.Bool("h", false, "ヘルプを表示")

	// get userId and password from option
	userId := flag.String("u", "", "enter your userId")
	password := flag.String("p", "", "enter your password")

	flag.Parse()

	if *help == true {
		fmt.Println(usage)
		os.Exit(0)
	}

	if *userId == "" || *password == "" {
		log.Fatalf("Error: enter userId and password")
	}

	userInfo := User{
		Id:       *userId,
		Password: *password,
	}

	Start(userInfo)
}