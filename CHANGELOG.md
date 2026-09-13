# Changelog

## 5.4
- Fixed: Set Bonus tiers with multiple stacked effects on one line (e.g. "9+: heal proc; +4 HP healed vs Hard Raids, and +15% Crit Damage; +25% Crit Damage vs Hard Raids") only nested some of those effects under the tier bullet - whichever ones happened to match a "damage...vs" keyword pattern - while identically-structured siblings rendered as flat top-level lines. Now every stacked clause on a tier's line nests under it, regardless of wording.

## 5.3
- Fixed: the (Avg) tag on regular items' indented sub-effect lines ("Item Sub Proc") rendered in the same gold color as the line itself instead of red, making it blend in. Now uses the same red AVG color as the main proc line.

## 5.2
- Reorganized the entire file into clearly labeled sections (Globals & State, Damage Pattern Registry, CSS, Functions grouped by feature area, Bootstrap) for easier navigation. No behavior changes - verified via an exact non-comment-line multiset diff against 5.1 (identical, zero differences).

## 5.1
- Reworked the item-location modal's rendering: bullet lines, section headers ("Crafted from:"), and long comma-separated ingredient lists now render as separate indented rows instead of one dense wrapped paragraph.

## 4.9
- Fixed HTML corruption with extended proc descriptions.
- Replaced unsafe average-appending with safe span-based rendering (`createAvgSpan`).
