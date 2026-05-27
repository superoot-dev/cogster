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

const useJson = (argv as { json?: boolean }).json;
if (useJson) {
  const out: Record<string, { value: number; unit: string }> = {};
  for (const [k, v] of evald.value) out[k] = { value: v.value, unit: fmtQty(v).replace(/^[^\s]+\s?/, "") };
  console.log(JSON.stringify(out, null, 2));
} else {
  const width = Math.max(...[...evald.value.keys()].map((k) => k.length));
  for (const [k, v] of evald.value) {
    console.log(`${k.padEnd(width)}  ${fmtQty(v)}`);
  }
  if (parsed.value.charts.length > 0) {
    console.log("\ncharts:");
    for (const ch of parsed.value.charts) {
      const r = `${ch.range.from ?? ""}..${ch.range.to ?? ""}${ch.range.per ? ` per ${ch.range.per}` : ""}`.trim();
      console.log(`  ${ch.as ?? "pie"}: [${ch.refs.join(", ")}]${r !== ".." ? ` ${r}` : ""}`);
    }
  }
}
