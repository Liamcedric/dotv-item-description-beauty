# DOTV Item Description (Beauty)

A Tampermonkey userscript for [Dragons of the Void](https://play.dragonsofthevoid.com/) that enhances item and magic tooltips: customizable colors and width, per-unit/conditional/distinct item tracking for damage-average math, item drop-location lookup, and (planned) live magic-scaling display.

## Install

Install from GreasyFork: <!-- add the GreasyFork listing URL here -->

## How updates work

This script is distributed from this repo. GreasyFork checks `item-description-beauty.user.js` on the `main` branch of this repo for version changes via its `@updateURL`. **Only push finished, version-bumped changes to `main`** — every push to `main` is effectively a release. Do in-progress work on a branch or locally and merge to `main` when ready.

To cut a release:
1. Bump `@version` in `item-description-beauty.user.js`.
2. Add an entry to `CHANGELOG.md`.
3. Commit and push to `main`.

## Data tables (`data/`)

These JSON files are fetched live from this repo's raw GitHub URL at runtime (via `GM_xmlhttpRequest`, cached in `GM_setValue`) — editing them does **not** require a new script version or GreasyFork update.

- `data/item-locations.json` — maps an item's exact in-game name to where it drops/is obtained. Populated and live: a 📍 button appears on item tooltips, opening a modal with the location details. Cached client-side for 24 hours.
- `data/magic-scaling.json` — maps a magic/spell's exact in-game name to whether it scales off the caster's or the hitter's Magic stat, so the tooltip can eventually show accurate live numbers using stats scraped from the game's own fetch responses. Still only a `_schema` placeholder entry and an example — this feature is not yet wired into the script.

## Editing color/width settings

End users configure colors and tooltip width in-game via the gear icon on item/magic tooltips; these are stored in that browser's `localStorage`, not in this repo.
