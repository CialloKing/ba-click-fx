# CialloKing/ba-click-fx Star history data

This orphan branch is maintained by GitHub Actions.

- `stars.csv` stores one Star-count point per Asia/Shanghai calendar day.
- `star-history.svg` is generated deterministically from the CSV data.
- `reconstructed` rows are derived from the `starred_at` timestamps of
  users who still star the repository at bootstrap time. They cannot recover
  removed Stars or historical decreases.
- `observed` rows are repository-count snapshots taken after tracking began.

Generated files should not be edited manually.
