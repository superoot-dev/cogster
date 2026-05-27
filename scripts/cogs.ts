import { readFileSync } from "node:fs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { parseProgram } from "../lib/CogsParser";
import { evalProgram } from "../lib/CogsEvaluator";
import { fmtQty } from "../lib/CogsUnits";

const argv = yargs(hideBin(process.argv))
  .scriptName("cogs")
  .command("eval <file>", "evaluate a .cogs file", (y) =>
    y.positional("file", { type: "string", demandOption: true }).option("json", { type: "boolean", default: false }),
  )
  .command("parse <file>", "print parsed AST", (y) =>
    y.positional("file", { type: "string", demandOption: true }),
  )
  .demandCommand(1)
  .strict()
  .help()
  .parseSync();

const file = String((argv as Record<string, unknown>).file);
const src = readFileSync(file, "utf8");
const parsed = parseProgram(src);
if (!parsed.ok) {
  console.error(`parse error: ${parsed.error}`);
  process.exit(1);
}

const cmd = (argv as { _: string[] })._[0];
if (cmd === "parse") {
  console.log(JSON.stringify(parsed.value, null, 2));
  process.exit(0);
}

const evald = evalProgram(parsed.value);
if (!evald.ok) {
  console.error(`eval error: ${evald.error}`);
  process.exit(1);
}

function fmtTags(at: Record<string, string>, axes: string[]): string {
  return axes.map((a) => `:${at[a]}`).join(" ");
}

const useJson = (argv as { json?: boolean }).json;
if (useJson) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of evald.value) {
    if (v.axes.length === 0) {
      const c = v.cells[0];
      out[k] = { value: c.qty.value, unit: fmtQty(c.qty).replace(/^[^\s]+\s?/, "") };
    } else {
      out[k] = {
        axes: v.axes,
        cells: v.cells.map((c) => ({ at: c.at, value: c.qty.value, unit: fmtQty(c.qty).replace(/^[^\s]+\s?/, "") })),
      };
    }
  }
  console.log(JSON.stringify(out, null, 2));
} else {
  const keys = [...evald.value.keys()];
  const width = keys.length ? Math.max(...keys.map((k) => k.length)) : 0;
  for (const [k, v] of evald.value) {
    if (v.axes.length === 0) {
      const cell = v.cells[0];
      if (!cell) {
        console.log(`${k.padEnd(width)}  (empty)`);
        continue;
      }
      console.log(`${k.padEnd(width)}  ${fmtQty(cell.qty)}`);
    } else {
      console.log(k);
      if (v.cells.length === 0) {
        console.log("  (no cells)");
        continue;
      }
      const tagWidth = Math.max(...v.cells.map((c) => fmtTags(c.at, v.axes).length));
      for (const cell of v.cells) {
        console.log(`  ${fmtTags(cell.at, v.axes).padEnd(tagWidth)}  ${fmtQty(cell.qty)}`);
      }
    }
  }
}
