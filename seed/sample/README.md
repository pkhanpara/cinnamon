Fabricated test data (made-up numbers, not a real portfolio). ORCL appears in both
files on purpose to test cross-account merging. Layout is cinnamon's own
"positions snapshot" format, not a broker's native export.

`m1_open_tax_lots.csv` is also fabricated, but uses the layout of M1 Finance's real "Open tax lots"
download (two disclaimer lines, then one row per lot) for the `m1-tax-lots` connector. Its lots
sum to the same per-symbol totals as `m1_positions.csv`.

`m1_holdings.csv` is fabricated too, in the layout of M1's "Holdings" download (one row per symbol,
quoted `"7,000.00"` numbers) for the `m1-holdings` connector. Same totals as `m1_positions.csv`.

`robinhood_app_positions.csv` is the template for the `robinhood-positions` connector: the Shares,
Average cost and Market value each position's screen in the Robinhood app shows (Robinhood has no
holdings export). Same totals as `robinhood_positions.csv`.
