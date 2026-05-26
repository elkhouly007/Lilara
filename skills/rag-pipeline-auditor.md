# Skill: rag-pipeline-auditor

---
name: rag-pipeline-auditor
description: Reviews a RAG (Retrieval-Augmented Generation) pipeline for six quality dimensions: chunking strategy (size, overlap, semantic vs fixed-window), embedding model fitness (dimension, domain alignment, staleness), retrieval configuration (top-k, reranking, hybrid sparse+dense), context-window budget management (token accounting and overflow handling), grounding-check rate (citation presence, hallucination surface), and "lost in the middle" mitigation. Produces a scored audit card with specific findings and remediation steps for each dimension.
---

# RAG Pipeline Auditor

Surface the retrieval, chunking, and context-budget problems that cause hallucinations, missed recalls, and degraded answer quality before they reach users.

## When to Use

- A RAG-powered feature is producing answers that ignore clearly relevant source documents
- Hallucination rate is above acceptable threshold in production monitoring
- Preparing a RAG pipeline for a production traffic increase (more documents or users)
- Evaluating a newly integrated vector store or embedding model change
- When answer quality degrades after adding a large batch of new documents to the knowledge base

## Process

1. **Collect pipeline configuration** — gather: chunking parameters (strategy, chunk size in tokens, overlap), embedding model name and dimension, vector store type, retrieval k and similarity threshold, reranker presence, LLM context window size, and the system prompt template showing how retrieved chunks are injected.

2. **Chunking strategy audit** — evaluate the chunking approach:

   - **Fixed-window chunking**: flag if chunk size > 512 tokens without semantic boundaries — mid-sentence cuts degrade embedding quality and retrieval recall.
   - **Overlap adequacy**: overlap < 10% of chunk size risks losing context at boundaries; overlap > 30% wastes index space and degrades precision.
   - **Semantic chunking**: preferred for narrative or code documents — flag if fixed-window is used on content with natural section breaks (headings, function definitions).
   - **Metadata attachment**: each chunk must carry `source`, `page`/`section`, and `timestamp` fields for grounding and citation.

   Score 1–5 (5 = semantic, well-overlapped, metadata-rich).

3. **Embedding model fitness audit** — evaluate the embedding configuration:

   - **Domain alignment**: general-purpose models (e.g., text-embedding-ada-002) perform poorly on domain-specific corpora (legal, medical, code). Flag mismatches.
   - **Dimension vs. corpus size**: 1536-dim embeddings on a 500-document corpus waste compute; 384-dim may underfit a 1M-document corpus.
   - **Staleness**: if the embedding model was updated and the index was not re-embedded, retrieval quality degrades silently. Flag if index creation date and model version differ.
   - **Asymmetric retrieval**: query encoder and passage encoder must match (SPLADE, BGE-M3 require paired encoders).

   Score 1–5 (5 = domain-fitted, consistent version, correct dimension).

4. **Retrieval configuration audit** — evaluate top-k and ranking:

   - **Top-k calibration**: k < 3 risks missing the relevant chunk; k > 10 fills the context window with noise. Optimal range is k = 4–8 for most prompts.
   - **Similarity threshold**: if no minimum threshold is set, irrelevant chunks flood results at low corpus quality. Recommend threshold ≥ 0.75 cosine similarity.
   - **Reranker presence**: cross-encoder reranking (e.g., ms-marco-MiniLM) improves precision at the cost of latency — flag if absent on precision-sensitive flows.
   - **Hybrid retrieval**: sparse (BM25/keyword) + dense (embedding) retrieval outperforms dense-only for exact-match queries and technical terms. Flag if only dense retrieval is used.

   Score 1–5 (5 = calibrated k, threshold set, reranker present, hybrid).

5. **Context-window budget audit** — evaluate token accounting:

   - **Budget calculation**: verify that `system_prompt_tokens + (k × avg_chunk_tokens) + user_query_tokens + response_reserve` ≤ model context window. Flag if no explicit budget check exists.
   - **Overflow handling**: if the sum exceeds the window, chunks must be dropped by relevance rank (lowest first), not truncated mid-chunk. Flag truncation-based overflow.
   - **Dynamic chunk selection**: if chunk sizes vary (semantic chunking), a fixed k may overflow; verify that token counting is dynamic.
   - **Response reserve**: ≥ 512 tokens must be reserved for the model's response; flag if the full window is allocated to context.

   Score 1–5 (5 = explicit budget, relevance-ranked overflow, dynamic, response reserve set).

6. **Grounding check audit** — evaluate citation and hallucination surface:

   - **Citation instruction**: the system prompt must instruct the model to cite the source chunk for every factual claim. Flag if citation instruction is absent.
   - **Source passthrough**: retrieved chunk metadata (`source`, `section`) must reach the prompt template. Flag if only chunk text is injected without provenance.
   - **Grounding check rate**: if a grounding verifier (NLI model, LLM-as-judge, or regex citation check) is not in the pipeline, hallucination surface is unmonitored. Flag as CRITICAL.
   - **Fallback behavior**: when no relevant chunks are retrieved (similarity threshold produces zero results), the model must be instructed to say "I don't have information on this" rather than generating from parametric memory.

   Score 1–5 (5 = citation required, provenance passed, grounding verified, fallback defined).

7. **"Lost in the middle" mitigation audit** — LLMs recall information at the beginning and end of context better than the middle (Liu et al., 2023):

   - **Chunk ordering**: most-relevant chunks must be placed first and last in the context window, not in the middle.
   - **Relevance-ordered injection**: verify the prompt template inserts chunks in descending relevance order or uses a "bookend" pattern (top-1 first, top-2 last, remaining in between).
   - **Chunk count vs. window size**: with k > 6, middle-chunk recall degrades significantly — recommend reducing k or using a reranker that surfaces only the top-3 most relevant.

   Score 1–5 (5 = bookend ordering, relevance-ranked, k ≤ 6 or reranker present).

8. **Produce the scored audit card** — compile all six dimension scores, list findings with severity (CRITICAL / HIGH / MEDIUM), and provide a prioritized remediation plan.

## Output Format

```
## RAG Pipeline Audit

Pipeline: chat-with-docs v2.1 | Vector store: Pinecone | LLM: gpt-4o (128k context)
Embedding: text-embedding-3-small (1536-dim) | Chunking: fixed-window 512t / 50t overlap

### Chunking Strategy — 3/5

Finding CH1 (MEDIUM): Fixed-window on narrative documentation
  Issue: Documents are structured with headings and paragraphs. Fixed-window cuts
         mid-paragraph, degrading embedding coherence.
  Fix:   Switch to sentence-boundary chunking (LangChain RecursiveCharacterTextSplitter
         with separators=["\n\n", "\n", ". "]). Chunk size 400t, overlap 80t.

Finding CH2 (LOW): Overlap at 9.7% of chunk size (borderline)
  Issue: 50-token overlap on 512-token chunks risks losing context at boundaries.
  Fix:   Increase overlap to 80 tokens (15.6%).

### Embedding Model Fitness — 4/5

Finding EM1 (LOW): General-purpose model on mixed technical corpus
  Issue: text-embedding-3-small is adequate but code-heavy sections may benefit
         from a code-aware model (voyage-code-2, jina-embeddings-v3).
  Fix:   Benchmark voyage-code-2 vs. current model on your code-heavy queries.

### Retrieval Configuration — 2/5

Finding RC1 (CRITICAL): No similarity threshold configured
  Issue: All top-k results are returned regardless of similarity score, including
         irrelevant chunks near the tail of the corpus.
  Fix:   Set minimum cosine similarity threshold ≥ 0.75 in Pinecone query filter.

Finding RC2 (HIGH): Dense-only retrieval — no sparse component
  Issue: Exact-match queries for product names and error codes return poor results.
  Fix:   Add BM25 keyword retrieval (Pinecone sparse-dense hybrid) with α = 0.5.

Finding RC3 (MEDIUM): No reranker
  Issue: Top-k precision is not post-processed.
  Fix:   Add ms-marco-MiniLM-L-6-v2 cross-encoder as a reranker (latency ~40ms).

### Context-Window Budget — 3/5

Finding CW1 (HIGH): No explicit token budget check
  Issue: k=8 × avg_chunk=512t = 4096t + system (800t) + query (200t) = 5096t.
         With response_reserve=0, the model can overflow on long queries.
  Fix:   Implement dynamic budget: reserve 1024t for response; drop lowest-ranked
         chunks until total ≤ context_window - 1024.

### Grounding Check — 1/5

Finding GR1 (CRITICAL): No citation instruction in system prompt
  Issue: The model generates answers without citing which chunk supports each claim.
  Fix:   Add to system prompt: "For every factual claim, cite the source document
         and section in brackets: [source: <filename>, section: <heading>]."

Finding GR2 (CRITICAL): No grounding verifier in pipeline
  Issue: Hallucination rate is unmonitored in production.
  Fix:   Add an LLM-as-judge grounding check step that verifies each claim
         appears in the retrieved chunks before the answer is returned to the user.

### Lost in the Middle — 2/5

Finding LM1 (HIGH): Chunks injected in arbitrary order
  Issue: Middle chunks (rank 2–7 of 8) are retrieved but statistically underweighted
         by the LLM's attention mechanism.
  Fix:   Reorder: inject rank-1 chunk first, rank-2 last, remaining in descending
         order from rank-3 to rank-7 (bookend pattern).

### Summary Scorecard

| Dimension | Score | Status |
|---|---|---|
| Chunking Strategy | 3/5 | Improve boundary handling |
| Embedding Fitness | 4/5 | Good — optional code-model trial |
| Retrieval Config | 2/5 | Fix before scaling |
| Context Budget | 3/5 | Add explicit token check |
| Grounding Check | 1/5 | CRITICAL — add before production |
| Lost in the Middle | 2/5 | Fix chunk ordering |
| **Overall** | **2.5/5** | **Not production-ready** |

### Prioritized Remediation

1. [CRITICAL] Add similarity threshold (RC1) — 30 min, prevents irrelevant chunk injection
2. [CRITICAL] Add citation instruction (GR1) — 15 min, zero infrastructure cost
3. [CRITICAL] Add grounding verifier (GR2) — 1–2 days, required for production trust
4. [HIGH] Add BM25 hybrid retrieval (RC2)
5. [HIGH] Fix chunk ordering — bookend pattern (LM1)
6. [HIGH] Add token budget check (CW1)
```

## Constraints

- Audit is static analysis — it reviews configuration and prompt templates, it does not run the pipeline against live queries.
- "Lost in the middle" scoring assumes transformer-based LLMs with attention; for models with explicit retrieval-augmented architectures (RAG-native models), this dimension may not apply.
- Grounding check scores of 1–2 are marked CRITICAL regardless of overall score — an unverified grounding pipeline should not reach production.
- Semantic similarity thresholds (0.75 cosine) are calibrated for normalized embedding models; dot-product similarity spaces use different thresholds — flag the similarity metric in use.
- Reranker latency estimates (ms-marco-MiniLM ~40ms) are CPU-based; GPU inference is 5–10× faster — adjust the recommendation based on the deployment environment.
