
export interface Paper {
    paper_id: string;
    title: string;
    crypto_family?: string;
    crypto_method?: string;
    abstract?: string;
    key_claim?: string;
    limitation?: string;
    post_quantum?: boolean;
    provides_anonymity?: boolean;
    provides_traceability?: boolean;
    trusted_opener_required?: boolean | null;
  }
  
  export interface ResearchNote {
    note_id: string;
    paper_id?: string;
    text: string;
    type?: string;
    confidence?: number;
  }
  
  export interface Experiment {
    experiment_id: string;
    paper_id: string;
    scheme: string;
    verify_time_ms?: number;
    signature_size_bytes?: number;
    communication_kb?: number;
    result?: string;
  }
  
  export interface ResearchEvidence {
    papers: Paper[];
    notes: ResearchNote[];
    experiments: Experiment[];
  }
  
  export interface ResearchMemory {
    id: string;
    content: string;
    relevance?: number;
  }
  
  export interface ResearchRepository {
    searchPapers(query: string): Promise<Paper[]>;
    getNotes(query: string): Promise<ResearchNote[]>;
    getExperiments(query: string): Promise<Experiment[]>;
  }
  
  export interface MemoryPort {
    recall(question: string): Promise<ResearchMemory[]>;
    remember(content: string): Promise<string>;
  }
  
  export interface ResearchTrace {
    step: string;
    status: "success" | "failed";
    details?: string;
  }
  
  export interface ResearchResult {
    question: string;
    answer: string;
    evidence: ResearchEvidence;
    memories: ResearchMemory[];
    potentialConflicts: string[];
    newMemoryId?: string;
    trace: ResearchTrace[];
  }
  