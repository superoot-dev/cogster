# cogster

Goal - lightweight by super powerful expressive way to model things like COGS expenses, get quick reports out with visualizations.

beetbook.example.yml and beetbook.superoot.yml both contains set of data that captures a big picture of what we might like to model, including but not limited to:

- Ingredients
  - at price tiers
- Processing (Tolling)
  - at price tiers
- Packaging
  - at price tiers
- Freight
- Distributor & Broker Fees
- One time fees
- Marketing spend
- Sell-in
- Trade spend

These yaml files are ONLY an example for context.

We want to create a super flexible written syntax that's easy to write, read, parse, serialize.

.cogs syntax

Create super flexible syntax

```cogs
packs per case = 6
units per pack = 16
servings per unit = 1

foobar sku ingredients cost = ginger price +

ginger per serving = 1000 mg
ginger price = $100 / kg @ 10kg
ginger price at 20kg = $80 per kg

lemon per serving = 500 mg
lemon price = $10 per kg @ 100 lb
lemon price at 1000lb = 5 USD per kg

bob monthly salary = 10000 dollars
jim salary = 2222 per month

acme copack processing cost per foobar sku unit = 0.085 at 30000 units, 0.72 at 100000 units

fakemart total stores = 100
fakemart units per sku per store per week = 16

// formula
fakemart units sold per month = fakemart total stores * fakemart units per sku per store per month

// some way to define what values we show inside of a chart, and how to show the chart.
// pie chart by default
// maybe something like this, with brackets
[jim salary, fakemart units sold per month]
```

Somehow, super flexibly parse all and make into a single format, maybe:

```
{
on
unit
value
per
at // at what rate or location? (.loc instead for that?)
of // what type of thing
from // start date
to // end date
}
```

Any value expression be adjusted with a slider in a UI.

These values are dynamically calculated - everything is an expression but value types

## Try it

```
yarn cogs eval examples/sample.cogs
yarn cogs parse examples/sample.cogs
```

See [examples/sample.cogs](./examples/sample.cogs) for the syntax in action.

## Canonical IR

Every parsed binding lowers to one shape:

```
Binding   = { name, expr }
Expr      = Qty | Ref | Op(+|-|*|/) | Neg | Call | Tiers
Qty       = { value: number, unit: { num: string[], den: string[] } }
Call      = { name, args: Expr[] }
Tiers     = [{ at: Qty, expr: Expr }]   // step function, sorted asc
```

Time rates (`per month`, `per week`) collapse into the unit's denominator,
so `$10000 per month + $2000 per month` unifies as `$/month`.

## Syntax constraints

- `name = expr` per line; `//` for comments
- Identifiers are multi-word phrases (`fakemart units per sku per store per week`)
- After a number, `per <unit>` and `/<unit>` extend the unit's denominator
- Tiers: `<expr> @ <qty>, <expr> @ <qty>, ...` — step-based (no interpolation)
- Function calls: `name(arg, arg, ...)` — uses the shared math library
  (`min`, `max`, `clamp`, `sqrt`, `getRoundTo`, `calcMax`, `getAvg`, etc.)
- SKU blocks: `sku <name> { ... }` namespaces every binding inside under
  `<name>.<binding>`. Refs inside resolve local-first then global. Cross-SKU
  refs use the dotted path (`widget bar.cogs per bar`). See
  [examples/multi-sku.cogs](./examples/multi-sku.cogs).

Reports/charts live outside the file — pick fields and views in the CLI/UI.
