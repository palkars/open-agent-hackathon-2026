
import type {
    MemoryPort,
    ResearchRepository,
    ResearchResult,
    ResearchTrace
  } from "../data/types.ts";
  
  export class ResearchAgent {
    constructor(
      private readonly repository: ResearchRepository,
      private readonly memory: MemoryPort
    ) {}
  
    async investigate(question: string):
      Promise<ResearchResult> {
  
      if (!question.trim()) {
        throw new Error("Research question cannot be empty");
      }
  
      const trace: ResearchTrace[] = [];
  
      // Step 1: Retrieve existing research knowledge
      const memories = await this.memory.recall(question);
      trace.push({
        step: "H-MEM recall",
        status: "success",
        details: `${memories.length} memories retrieved`
      });
  
      // Step 2: Retrieve research evidence
      const [papers, notes, experiments] =
        await Promise.all([
          this.repository.searchPapers(question),
          this.repository.getNotes(question),
          this.repository.getExperiments(question)
        ]);
  
      trace.push({
        step: "Zetaris evidence retrieval",
        status: "success",
        details:
          `${papers.length} papers, ` +
          `${notes.length} notes, ` +
          `${experiments.length} experiments`
      });
  
      // Step 3: Detect a narrow, explicit potential conflict
      const potentialConflicts: string[] = [];
  
      const relevantMemories = memories.filter(m =>
        /trusted (opening authority|opener)/i.test(m.content)
        && /requir|must|necessary/i.test(m.content)
      );
  
      const contraryPapers = papers.filter(p =>
        p.trusted_opener_required === false &&
        p.provides_traceability === true
      );
  
      if (relevantMemories.length && contraryPapers.length) {
        potentialConflicts.push(
          "Earlier memory may conflict with evidence " +
          "supporting traceability without a single trusted opener."
        );
      }
  
      trace.push({
        step: "Potential conflict check",
        status: "success",
        details: `${potentialConflicts.length} potential conflicts`
      });
  
      // Step 4: Produce a deterministic evidence summary
      const paperReferences = papers.map(
        p => `${p.paper_id}: ${p.title}`
      );
  
      const answer = papers.length === 0
        ? "No matching papers were found. " +
          "The current evidence is insufficient."
        : [
            `Retrieved ${papers.length} papers, ` +
            `${notes.length} notes and ` +
            `${experiments.length} experiments.`,
            `Papers: ${paperReferences.join("; ")}`,
            potentialConflicts.length
              ? `Potential conflict: ${potentialConflicts.join(" ")}`
              : "No conflict detected by the current rule.",
            "This is an evidence inventory, not a validated " +
            "scientific conclusion."
          ].join("\n");
  
      // Step 5: Save a bounded, sourced research finding
      let newMemoryId: string | undefined;
  
      if (papers.length > 0) {
        const finding = [
          `Research question: ${question}`,
          `Evidence paper IDs: ${
            papers.map(p => p.paper_id).join(", ")
          }`,
          `Potential conflicts: ${
            potentialConflicts.join("; ") || "none detected"
          }`,
          "Status: preliminary; requires scientific validation"
        ].join("\n");
  
        newMemoryId = await this.memory.remember(finding);
  
        trace.push({
          step: "H-MEM learning",
          status: "success",
          details: `Stored memory ${newMemoryId}`
        });
      }
  
      return {
        question,
        answer,
        evidence: { papers, notes, experiments },
        memories,
        potentialConflicts,
        newMemoryId,
        trace
      };
    }
  }
  