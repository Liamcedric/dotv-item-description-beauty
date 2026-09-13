# Changelog

## 5.2
- Reorganized the entire file into clearly labeled sections (Globals & State, Damage Pattern Registry, CSS, Functions grouped by feature area, Bootstrap) for easier navigation. No behavior changes - verified via an exact non-comment-line multiset diff against 5.1 (identical, zero differences).

## 5.1
- Reworked the item-location modal's rendering: bullet lines, section headers ("Crafted from:"), and long comma-separated ingredient lists now render as separate indented rows instead of one dense wrapped paragraph.

## 4.9
- Fixed HTML corruption with extended proc descriptions.
- Replaced unsafe average-appending with safe span-based rendering (`createAvgSpan`).
