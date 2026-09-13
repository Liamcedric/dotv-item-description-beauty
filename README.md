# DOTV Item Description (Beauty)

A Tampermonkey userscript for [Dragons of the Void](https://play.dragonsofthevoid.com/) that enhances item and magic tooltips: customizable colors and width, per-unit/conditional/distinct item tracking for damage-average math, and (planned) item drop-location lookup and live magic-scaling display.

## Install

Install from GreasyFork: <!-- add the GreasyFork listing URL here -->

## How updates work

This script is distributed from this repo. GreasyFork checks `item-description-beauty.user.js` on the `main` branch of this repo for version changes via its `@updateURL`. **Only push finished, version-bumped changes to `main`** — every push to `main` is effectively a release. Do in-progress work on a branch or locally and merge to `main` when ready.

To cut a release:
1. Bump `@version` in `item-description-beauty.user.js`.
2. Add an entry to `CHANGELOG.md`.
3. Commit and push to `main`.

## Data tables (`data/`)

The item-location and magic-scaling features fetch these JSON files live from this repo's raw GitHub URL at runtime (via `GM_xmlhttpRequest`, cached in `GM_setValue`) — editing them does **not** require a new script version or GreasyFork update.

- `data/item-locations.json` — maps an item's exact in-game name to the raid(s)/zone(s) it drops in. Shown in the item tooltip on hover.
- `data/magic-scaling.json` — maps a magic/spell's exact in-game name to whether it scales off the caster's or the hitter's Magic stat, so the tooltip can show accurate live numbers using stats scraped from the game's own fetch responses.

Both files currently contain only a `_schema` placeholder entry and an example — the lookup features are not yet wired into the script.

## Editing color/width settings

End users configure colors and tooltip width in-game via the gear icon on item/magic tooltips; these are stored in that browser's `localStorage`, not in this repo.

## Editing worn/owned settings (for damage-average math)

When an item's tooltip contains a bonus that scales with how many copies you have (e.g. `+X damage per [Unit] worn`, `+X damage per [Item] owned`, `+X damage per distinct [Item] owned`, or `+X damage if [Item] is owned`), the script automatically injects extra controls into that tooltip so the shown damage average reflects your actual gear/formation, not just the base tooltip text. There is nothing to edit in this repo for this — it's all configured live, per-browser, in-game:

- **Worn** (+/− stepper, top of the controls box): a single global count used for every `... per [Unit] worn` bonus, since worn slots are inherently shared across your equipped set. Defaults to 8.
- **Per Item/Unit** (+/− stepper, one per detected item/unit name): how many of that specific item/unit you own, used for `... per [Item] owned`, `... per distinct [Item] owned`, and Formation-based bonuses. Defaults to 8 each.
- **Conditional** (checkbox, one per detected item name): whether you own the item referenced by an `if [Item] is owned` bonus. Checked (owned) by default.

Adjusting any of these immediately recalculates the tooltip's damage average. Values are saved per-browser in `localStorage` (`tooltipAmountWorn`, `tooltipPerItem`, `tooltipConditionalItems`) and persist across items that reference the same unit/item name.
