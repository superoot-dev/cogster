# ⚙ cogster

Lightweight, expressive way to model COGS, trade spend, and unit economics — with a live web UI for sliders, scrubbable inputs, and instant chart rollups.

A `.cogs` file is one expression per line. Multi-word names, units, currencies, tiered prices, tagged axes, matrix tables, and chart definitions all live in the same plain-text format.

## Try it

```bash
yarn install
yarn cogs eval examples/sample.cogs          # print computed values
yarn cogs parse examples/sample.cogs         # print AST
yarn cogs serve examples/widget-bars.cogs    # launch web UI at http://127.0.0.1:5173
```

The web UI offers:
- editable value rows (slider, click-and-drag scrub, or type)
- live recompute as you tweak
- collapsible section groups from `// --- name ---` comments
- per-binding chart membership: type a chart key, pick a color
- bar + pie charts that auto-update
- file-watch live reload when the `.cogs` file changes on disk
- Download button to save the modified source

## Syntax

### Bindings & expressions

```cogs
// scalars + units + currencies
packs per case = 6
ginger per serving = 1000 mg
bob salary = $10000 per month

// formulas
units per case = packs per case * units per pack

// tiered prices (step-based, no interpolation)
ginger price = $100 / kg @ 10 kg, $80 / kg @ 20 kg

// function calls (min / max / clamp / sqrt / etc.)
marketing capped = min(marketing budget cap, marketing monthly)
```

- `name = expr` per line; `//` line comments
- Identifiers are multi-word phrases (`fakemart units per sku per store per week`)
- After a number, `per <unit>` and `/<unit>` extend the unit's denominator
- Time rates collapse into the denominator: `$10000 per month + $2000 per month` unifies as `$/month`
- Line continuation: lines ending in `+`, `-`, `*`, `/`, `(`, or `,` continue on the next line

### Axes & tagged values

```cogs
axis sku = :widget bar :energy bar
axis channel = :fakemart :indie :amazon :shopify

// one branch per line
cogs per bar =
  :widget bar  $0.64
  :energy bar  $0.55

// inline-tagged literal — one-liner
tier rate = :gold 0.05, :silver 0.08, :bronze 0.10

// 2D markdown-style matrix
price per bar =
  |               | :fakemart | :indie | :amazon | :shopify
  | :widget bar   | $1.55     | $1.65  | $2.50   | $1.69
  | :energy bar   | $1.45     | $1.55  | $2.75   | $1.79

// default-via-RHS — bare value on '=' line is the default arm
commission rate = 0.07
  :gold     0.05
  :silver   0.06

// formula auto-broadcasts over whichever axes its refs carry
revenue = price per bar * bars per year

// selectors and aggregations
widget fakemart = revenue :widget bar :fakemart
total = sum revenue over :sku :channel
by sku = sum revenue over :channel       // also: avg, min, max
```

- Tag syntax is `:tag` — no space allowed between `:` and the name
- Same axis on one line = union; different axes = intersection (one specific cell)
- `:*` = default arm; specific matches win
- Tag values may include `-` and start with digits (`:tier-1`, `:q4-2026`)

### Charts

Charts and chart entries live in the source. The UI groups entries by chart key.

```cogs
// per-entry: #color.chartKey <binding ref>
chart cogs = pie                          // optional: pie | bar (default bar)

#amber.cogs recipe cost per bar
#blue.cogs packaging cost per bar
#purple.cogs processing cost per bar

// auto-expand: tagged refs become one series per cell
chart channels = pie
#auto.channels profit by channel          // uses palette for distinct slices

// scalar refs work too — palette walk via #auto
#auto.totals total gross profit
#auto.totals annual fixed burn
```

- Colors: 3- or 6-char hex (`#1f8`, `#f6f6f6`), named (`#red`, `#blue`, `#teal`…), or `#auto` for palette walk
- Chart keys are single tokens; refs are full multi-word binding names
- Default kind: bar. Override with `chart <name> = pie`

### Section headers (UI grouping)

The web UI scans the source for `// --- name ---` style comments and groups subsequent bindings under collapsible section headers with row counts.

```cogs
// --- ingredients (purchase prices) ---
oats price = $42 / 50 lb
almond butter price = $215 / 25 lb

// --- recipe (bar-level amounts) ---
oats per bar = 0.05 lb
```

## Canonical IR

Every parsed binding lowers to one shape:

```
Program       = { axes, bindings, charts, chartConfigs }
Binding       = { name, expr }
Expr          = Qty | Ref | Op(+|-|*|/) | Neg | Call | Tiers
              | Branches | Select | Aggregate
Qty           = { value: number, unit: { num: string[], den: string[] } }
CogValue      = { axes: string[], cells: [{ at: Assignment, qty: Qty }, ...] }
ChartEntry    = { color, chart, ref }
ChartConfig   = { name, kind: "bar" | "pie" }
```

A scalar binding evaluates to a `CogValue` with no axes (one cell). A tagged binding (with branches) evaluates to a `CogValue` with one cell per axis assignment.

## Embedding the UI

The UI bundles to a single drop-in script.

```bash
yarn build:lib   # produces dist/ui/cogster-ui.js
```

```html
<div id="app"></div>
<script src="cogster-ui.js"></script>
<script>
  window.cogsterMount('#app', `
    packs per case = 6
    units per pack = 16
    units per case = packs per case * units per pack
    #auto.summary units per case
  `);
</script>
```

CSS is inlined into the bundle. No network calls required at runtime.

## VS Code syntax highlighting

`.vscode/extensions/cogs/` ships a TextMate grammar for `.cogs` files. Install via "Developer: Install Extension from Location..." or symlink to `~/.vscode/extensions/`.

## Examples

- [examples/sample.cogs](./examples/sample.cogs) — minimal end-to-end demo with bar + pie charts
- [examples/widget-bars.cogs](./examples/widget-bars.cogs) — full single-SKU model with COGS breakdown, channel margins, trade stack, burn, and bottom-line rollups
- [examples/multi-sku.cogs](./examples/multi-sku.cogs) — multi-SKU × multi-channel matrix model with auto-expanding charts
