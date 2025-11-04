# scraping_gundam_mobile

[ガンダムモバイル](https://vsmobile.jp/)からスコアを取得 & 集計するツール

## Requirement

- Go 1.24.5 or later

## How to Use

1. Build "scraping_gundam_mobile"
```
git clone https://github.com/yuki9431/scraper_gundam_mobile.git

cd scraper_gundam_mobile/

go build -o main
```

2. Just run it

```sh
ID=YOUR_EMAIL; PASS=YOUR_PASSWORD

./main $ID $PASS "./path.csv"
```

## Output sample

```
2025/11/04 10:58:52 [INFO] Scores successfully saved to ./path.csv
```

## Author

[Dillen H. Tomida](https://twitter.com/cafe_yuki)

## License

This software is licensed under the MIT license, see [LICENSE](./LICENSE) for more information.
