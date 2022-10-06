package main

import (
	"fmt"

	"github.com/sclevine/agouti"
)

type User struct {
	Id       string
	Password string
}

type WebInfo struct {
	User User
	Page *agouti.Page
}

func Start(user User) {
	web, err := new(user)
	if err != nil {
		return
	}

	fmt.Println(user.Id)
	fmt.Println(user.Password)

	web.test()

	// if err := web.accessLoginPage(); err != nil {
	// 	return fmt.Errorf("Error: Faild to access Login Page: %v", err)
	// }

	// if err := web.login(); err != nil {
	// 	return fmt.Errorf("Error: Faild to login %v", err)
	// }
}

func new(user User) (web *WebInfo, err error) {
	// start driver
	driver := agouti.PhantomJS()
	if err = driver.Start(); err != nil {
		return nil, fmt.Errorf("Error: Failed to start driver:%v", err.Error())
	}
	defer driver.Stop()

	page, err := driver.NewPage(agouti.Browser("phantomjs"))
	if err != nil {
		return nil, fmt.Errorf("Error: Failed to open page:%v", err.Error())
	}

	return &WebInfo{
		User: User{
			Id:       user.Id,
			Password: user.Password,
		},
		Page: page,
	}, nil
}

func (web *WebInfo) test() {
	fmt.Println("TEST")
}

func (web *WebInfo) login() (err error) {

	err = web.Page.AllByID("mail").Fill(web.User.Id)
	if err != nil {
		return
	}

	err = web.Page.AllByID("pass").Fill(web.User.Password)
	if err != nil {
		return
	}

	err = web.Page.AllByID("btn-idpw-login").Click()
	if err != nil {
		return
	}

	return nil
}

func (web *WebInfo) accessLoginPage() (err error) {
	if err := web.Page.Navigate("https://www.bandainamcoid.com/v2/oauth2/auth"); err != nil {
		return fmt.Errorf("Error: Failed to navigate:%v", err.Error())
	}

	err = web.Page.ClearCookies()
	if err != nil {
		return
	}

	return nil
}