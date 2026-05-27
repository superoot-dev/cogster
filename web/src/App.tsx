import React, { useEffect, useMemo, useState } from "react";
import { appendBinding, buildState, deleteLine, moveLine, nextNewName, setChartColor, setLiteralValue, setRhs, setRowChart } from "./cogsEngine";
import { BindingsPane } from "./BindingsPane";
import { ChartsPane } from "./ChartsPane";

export function App({ initialSource }: { initialSource: string }) {
  const [source, setSource] = useState(initialSource);
  const state = useMemo(() => buildState(source), [source]);
  const [bases, setBases] = useState<Record<string, number>>({});
  useEffect(() => {
    setBases((prev) => {
      let dirty = false;
      const next = { ...prev };
      for (const r of state.rows) {
        if (next[r.name] === undefined) { next[r.name] = r.baseValue; dirty = true; }
      }
      return dirty ? next : prev;
    });
  }, [state.rows]);

  function handleValueChange(lineIndex: number, value: number) {
    setSource(setLiteralValue(source, lineIndex, value));
  }
  function handleRhsChange(lineIndex: number, rhs: string) {
    setSource(setRhs(source, lineIndex, rhs));
  }
  function handleColorChange(ref: string, chart: string, color: string) {
    setSource(setChartColor(source, ref, chart, color));
  }
  function handleChartChange(ref: string, chartKey: string, color: string) {
    setSource(setRowChart(source, ref, chartKey, color));
  }
  function handleReorder(from: number, to: number) {
    setSource(moveLine(source, from, to));
  }
  function handleDelete(lineIndex: number) {
    setSource(deleteLine(source, lineIndex));
  }
  function handleAdd() {
    setSource(appendBinding(source, nextNewName(state), 0));
  }
  function handleDownload() {
    const blob = new Blob([source], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cogster.cogs";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app">
      <BindingsPane
        state={state}
        error={state.error}
        bases={bases}
        onValueChange={handleValueChange}
        onRhsChange={handleRhsChange}
        onColorChange={handleColorChange}
        onChartChange={handleChartChange}
        onReorder={handleReorder}
        onDelete={handleDelete}
        onAdd={handleAdd}
        onDownload={handleDownload}
      />
      <ChartsPane charts={state.charts} />
    </div>
  );
}
