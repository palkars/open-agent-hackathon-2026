import type { AgentResult } from "./research-agent.ts";
import type { Evaluation } from "./evaluator.ts";

// Terminal rendering of agent runs for research.ts.

export function modeLabel(result: AgentResult): string {
  return result.route ? `${result.route.id} (${result.route.model})` : "offline planner (no model route configured)";
}

function evaluationLabel(e: Evaluation): string {
  const subject = e.memoryId ?? "question";
  const evidence = e.evidence.join("+") || "-";
  return `${e.relationship.padEnd(11)} ${subject.padEnd(8)} ${evidence.padEnd(10)} ${e.confidence.toFixed(2)}  ${e.reason}`;
}

export function formatAgentResult(result: AgentResult): string {
  const lines: string[] = [];
  lines.push(`question: ${result.question}`);
  lines.push(`evidence: ${result.dataSource} | model: ${modeLabel(result)} | memory: ${result.memoryUsed ? "H-MEM (warm)" : "off (cold)"} | chain: Markovian ${result.run.engine}`);

  if (result.memoryUsed) {
    const recalled = result.recall.map((t) => t.summary).join("; ");
    lines.push(`\nrecall into chunk 0: ${recalled || "nothing"}`);
  }

  for (const iteration of result.iterations) {
    lines.push(`\niteration ${iteration.step}  (prompt ~${iteration.promptTokens} tokens, ${result.run.tokenLabel})`);
    lines.push(`  carryover in: ${iteration.carryoverIn ? iteration.carryoverIn.replace(/\n/g, " | ") : "(none: first chunk)"}`);
    for (const tool of iteration.tools) {
      lines.push(`  tool ${tool.tool} ${JSON.stringify(tool.args)} -> ${tool.error ? `ERROR ${tool.error}` : tool.summary}`);
    }
    for (const line of iteration.content.split("\n").filter(Boolean)) lines.push(`  ${line}`);
  }

  const relevant = result.evaluations.filter((e) => e.relationship !== "UNRELATED");
  const unrelated = result.evaluations.length - relevant.length;
  lines.push(`\nevaluations (${result.evaluationSource}):`);
  for (const e of relevant) lines.push(`  ${evaluationLabel(e)}`);
  if (unrelated > 0) lines.push(`  (${unrelated} memories judged UNRELATED to the evidence)`);
  if (result.evaluations.length === 0) lines.push("  none");

  lines.push(`\nanswer:\n  ${result.answer}`);

  const learning = result.learning;
  lines.push("\nlearning (H-MEM):");
  if (!learning.enabled) {
    lines.push("  off for this run");
  } else {
    for (const c of learning.conflicts) lines.push(`  conflict_detected on ${c.memoryId} (evidence ${c.evidence.join(", ")})`);
    if (learning.stored) {
      const replaced = learning.superseded.length > 0 ? `, superseding ${learning.superseded.join(", ")}` : "";
      lines.push(`  stored ${learning.stored.id} ${learning.stored.type} "${learning.stored.content}" (sources ${learning.stored.sourceIds.join(", ")}, confidence ${learning.stored.confidence})${replaced}`);
    }
    if (learning.helpful.length > 0) lines.push(`  helpful feedback: ${learning.helpful.join(", ")}`);
    if (learning.skipped) lines.push(`  no new memory: ${learning.skipped}`);
  }

  for (const note of result.notes) lines.push(`note: ${note}`);
  const run = result.run;
  lines.push(
    `\nmarkovian ${run.id}: ${run.status} in ${run.chunks} chunk(s) | prompt ${run.promptTokens} + output ${run.outputTokens} tokens (${run.tokenLabel})`,
  );
  return lines.join("\n");
}

export function formatComparison(cold: AgentResult, warm: AgentResult): string {
  const contradictions = (r: AgentResult) => r.evaluations.filter((e) => e.memoryId && e.relationship === "CONTRADICTS").length;
  const rows: [string, string, string][] = [
    ["", "cold (no memory)", "warm (H-MEM in chunk 0)"],
    ["chunks", String(cold.run.chunks), String(warm.run.chunks)],
    [`prompt tokens (${cold.run.tokenLabel})`, String(cold.run.promptTokens), String(warm.run.promptTokens)],
    [`output tokens (${cold.run.tokenLabel})`, String(cold.run.outputTokens), String(warm.run.outputTokens)],
    ["memories consulted", String(cold.memories.length), String(warm.memories.length)],
    ["contradictions with memory", String(contradictions(cold)), String(contradictions(warm))],
  ];
  const lines = rows.map(([a, b, c]) => `  ${a.padEnd(28)}| ${b.padEnd(18)}| ${c}`);
  const savedChunks = cold.run.chunks - warm.run.chunks;
  const savedTokens = cold.run.promptTokens + cold.run.outputTokens - warm.run.promptTokens - warm.run.outputTokens;
  lines.push("");
  lines.push(`  cold answer: ${cold.answer}`);
  lines.push(`  warm answer: ${warm.answer}`);
  lines.push("");
  lines.push(
    savedChunks > 0
      ? `  memory saved ${savedChunks} chunk(s) and ${savedTokens} ${cold.run.tokenLabel} tokens on this question.`
      : `  memory saved no chunks on this question (warm runs skip steps once an earlier run has stored a conclusion: try \`ask\` first).`,
  );
  return lines.join("\n");
}
