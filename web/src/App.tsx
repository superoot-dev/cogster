import React, { useEffect, useMemo, useState } from "react";
import { appendBinding, buildState, deleteLine, moveLine, nextNewName, renameBinding, setCellValue, setChartColor, setLiteralValue, setRhs, setRowChart, setUnit } from "./cogsEngine";
import { BindingsPane } from "./BindingsPane";
import { ChartsPane } from "./ChartsPane";

export function App({ initialSource, initialScenario = null }: { initialSource: string; initialScenario?: string | null }) {
  const [source, setSource] = useState(initialSource);
  const [scenario, setScenario] = useState<string | null>(initialScenario);
  const state = useMemo(() => buildState(source, scenario), [source, scenario]);
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
  function handleNameChange(oldName: string, newName: string) {
    setSource(renameBinding(source, oldName, newName));
  }
  function handleUnitChange(lineIndex: number, unit: string) {
    setSource(setUnit(source, lineIndex, unit));
  }
  function handleCellValueChange(lineIndex: number, assignment: Record<string, string>, value: number, currency: boolean) {
    setSource(setCellValue(source, state.program, lineIndex, assignment, value, currency));
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
        scenarios={state.program.scenarios.map((s) => s.name)}
        scenario={scenario}
        onScenario={setScenario}
        onValueChange={handleValueChange}
        onRhsChange={handleRhsChange}
        onNameChange={handleNameChange}
        onUnitChange={handleUnitChange}
        onCellValueChange={handleCellValueChange}
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
