# scraping_gundam_mobile

[ガンダムモバイル](https://vsmobile.jp/)からスコアを取得 & 集計するツール

## Requirement

- Go 1.19.0 or later

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

./main $ID $PASS
```

## Output sample

```
--------- 日別の平均 ---------
--------- 2022年10月19日 ---------
33戦 19勝 57.6%
対戦数 33
勝利数 19
撃墜 1
被撃墜 1
与ダメ 835
被ダメ 807
EXダメ 113
--------- 2022年10月18日 ---------
4戦 3勝 75.0%
対戦数 4
勝利数 3
撃墜 2
被撃墜 1
与ダメ 884
被ダメ 910
EXダメ 182
---------2022年10月 ---------
504戦 267勝 53.0%
撃墜 1
被撃墜 1
与ダメ 884
被ダメ 859
EXダメ 134
```

## Author

[Dillen H. Tomida](https://twitter.com/cafe_yuki)

## License

This software is licensed under the MIT license, see [LICENSE](./LICENSE) for more information.