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

// axis groups: indented `group :name = :tag :tag` lines after the axis decl.
// A group resolves to its member tags anywhere a tag is accepted (selectors,
// branches, matrix rows/cols).
axis tier = :gold :silver :bronze :tin
  group :metals = :gold :silver :bronze
  group :base   = :tin

// one branch per line
cogs per bar =
  :widget bar  $0.64
  :energy bar  $0.55

// inline-tagged literal — one-liner
tier rate = :gold 0.05, :silver 0.08, :bronze 0.10

// 2D markdown-style matrix; use `:*` as a row or column header for a
// default arm that fills any tag not explicitly listed
price per bar =
  |               | :fakemart | :indie | :*
  | :widget bar   | $1.55     | $1.65  | $2.50
  | :energy bar   | $1.45     | $1.55  | $2.75

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
// block form (preferred): indented entries under the chart decl.
// First token `#color` is optional; omit it for palette walk.
chart cogs = pie                          // optional: pie | bar (default bar)
  #amber  recipe cost per bar
  #blue   packaging cost per bar
  #purple processing cost per bar
          shipping cost per bar           // no color = palette walk

chart channels = pie
  profit by channel                       // tagged refs auto-expand per cell

chart totals
  total gross profit
  annual fixed burn

// legacy per-entry form still works:
#amber.cogs recipe cost per bar
```

- Colors: 3- or 6-char hex (`#1f8`, `#f6f6f6`), named (`#red`, `#blue`, `#teal`…), or `#auto` for palette walk
- In block form, color is optional; omit for palette walk
- Chart keys are single tokens; refs are full multi-word binding names
- Default kind: bar. Override with `chart <name> = pie`

### Scenarios (override blocks)

A scenario directive redefines existing bindings under a named scenario, so an alternate set of assumptions can sit *next to* the defaults in the source. The base model is unaffected until a scenario is selected (web dropdown, or CLI `--scenario <name>`).

```cogs
cases per pallet = 80
#macgray { cases per pallet = 128 }            // one-line form

stick film cost per unit = $0.079 @ 80000 unit, $0.072 @ 160000 unit
#macgray {                                     // block form, braces may span lines
  stick film cost per unit = $0.069 @ 80000 unit, $0.059 @ 160000 unit
}
```

- `#name { ... }` block (anywhere, any number) or one-line `#name <binding>`; all blocks of the same name merge.
- A scenario may only **override bindings that already exist** in the base — it cannot introduce new names, axes, or charts. This keeps the base model standalone-evaluable.
- Overrides are full binding definitions (scalars, tiered ladders, branches) and flow into everything downstream.
- Disambiguated from chart lines by the absence of a `.` after the name (`#blue.chart ref` is a chart; `#blue { ... }` / `#blue x = 1` is a scenario).

```bash
cogs eval model.cogs                 # base
cogs eval model.cogs --scenario macgray
cogs serve model.cogs --scenario macgray   # dropdown defaults to this
```

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
Program       = { axes, bindings, charts, chartConfigs, scenarios }
Binding       = { name, expr }
Scenario      = { name, bindings }   // override bindings applied when active
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
