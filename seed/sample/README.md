Fabricated test data (made-up numbers, not a real portfolio). ORCL appears in both
files on purpose to test cross-account merging. Layout is cinnamon's own
"positions snapshot" format, not a broker's native export.

`m1_open_tax_lots.csv` is also fabricated, but uses the layout of M1 Finance's real "Open tax lots"
download (two disclaimer lines, then one row per lot) for the `m1-tax-lots` connector. Its lots
sum to the same per-symbol totals as `m1_positions.csv`.
