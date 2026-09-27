# Anthropic Engineering: Writing effective tools for agents

- Kind: primary engineering blog, **Writing effective tools for agents—with agents**. Canonical https://www.anthropic.com/engineering/writing-tools-for-agents ; linked [evaluation cookbook](https://platform.claude.com/cookbook/tool-evaluation-tool-evaluation), [tool-definition guide](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use#best-practices-for-tool-definitions), [MCP](https://modelcontextprotocol.io/docs/getting-started/intro).
- Author: Ken Aizawa, with Anthropic Research/MCP/Product/Applied AI colleagues credited. Published 2025-09-11. DOCUMENTED on the [article](https://www.anthropic.com/engineering/writing-tools-for-agents), fully reread 2026-09-24, not merely inferred from prior recollection as in the seed.
- License: no article-specific reuse grant located. Ordinary copyrighted publication, not an MIT library. Adopt independently implemented principles; cite ideas and use only limited quotations. No source-code repository stats or release history apply to this article; linked cookbook code was not audited here and must have its own licensing checked before copying.
- Status: publicly reachable engineering guidance grounded in internal Slack/Asana evaluations; not a peer-reviewed CAD study or a mathematical guarantee. All DOCUMENTED statements below refer to the [primary article](https://www.anthropic.com/engineering/writing-tools-for-agents), with section headings to locate them.

## What it is

DOCUMENTED, “What is a tool?”: tools are contracts between deterministic software and nondeterministic agents; ordinary API wrappers are not automatically ergonomic action interfaces. The article presents an iterative build/evaluate/refine workflow and principles for selection, naming, high-signal responses, context budgets and descriptions. It supports wonky's interface design, not its numeric kernel.

## How it works

DOCUMENTED recommendations, “Principles for writing effective tools”:

1. **Consolidate natural workflows, not everything indiscriminately.** A few tools with distinct purpose are preferable to many overlapping endpoint wrappers. Examples: `schedule_event` handles availability plus scheduling; `search_logs` returns relevant lines with surrounding context instead of whole logs; `get_customer_context` aggregates useful recent records. Search rather than dumping every contact. Consolidation saves agent turns and irrelevant intermediate output, not necessarily backend work.
2. **Namespace by service/resource.** `asana_search`, `jira_search`, `asana_projects_search`, `asana_users_search`. Prefix versus suffix materially affected internal evaluations, but effect varied by model. There is no universally optimal naming rule established here.
3. **Semantic context alongside actionable identity.** Human-meaningful names/descriptors or simple indexed IDs were more usable than opaque UUIDs in internal retrieval tests. Do not remove identifiers required for subsequent calls: `search_user(name='jane') → send_message(id=12345)` still needs the ID. A `response_format` enum exposes concise/detailed modes; detailed mode recovers omitted technical fields. Task/agent-specific evaluation chooses JSON/XML/Markdown, not blanket preference for one format.
4. **Bound observations explicitly.** Pagination, range selection, filtering and truncation need sensible defaults. Truncation should tell the agent how to narrow the request or fetch the next portion. Invalid inputs should return specific, actionable corrections rather than opaque status codes or entire stack traces. The cited Claude Code default response cap is 25,000 tokens **as of the 2025 article**, not verified current runtime behavior.
5. **Document implicit assumptions.** Explain specialized terms, expected query syntax and resource relationships; enforce strict input/output data models. Parameter names should distinguish `user_id` from vague `user`. MCP annotations disclose destructive/open-world behavior; they describe capability, not user authorization.

DOCUMENTED workflow, “Running an evaluation” and “Collaborating with agents”:

- Prototype locally with actual API/library documentation, connect tools, test rough edges, collect user feedback.
- Build dozens of realistic multi-step tasks with verifiable outcomes. Weak evals give the exact ID/operation and test only a single trivial call. Strong evals combine discovery, reasoning and multiple resources; avoid toy environments too simple to expose real failures.
- Programmatic agent loop per task; record outcome accuracy, individual-call/task runtime, call count, token consumption and errors. Optional expected tools help diagnose understanding, but do not enforce one path when many valid strategies exist.
- Review raw calls and responses, not only the agent's self-explanation. Omitted warnings or unmentioned workarounds can be more informative than its feedback. Redundant calls suggest bad pagination/budgets; invalid arguments suggest unclear schemas/examples.
- Iterate tool implementations/descriptions against a development evaluation and check a **held-out** set to avoid overfitting. Agents can help inspect transcripts, but their statements about success are not the verifier.

## Robustness and guarantees

DOCUMENTED: empirical engineering advice; no formal correctness, optimality or security guarantee. It recommends verifiable outcomes without rejecting valid alternative formatting/phrasing. It explicitly notes that feedback and raw behavior can disagree. Internal examples do not establish that every broad tool is better than composable primitives.

INFERRED for CAD: evaluate model outcomes independently through exact dimensions, geometry validity, revision/provenance checks and explicit tolerances; never grade only the narrative or the existence of an export. A helpful error must preserve the actual failure and uncertainty, not instruct the model to assume success. Compressing observation text must not silently suppress failed features or uncertified geometry.

## Parallelism and performance

DOCUMENTED concrete token example: detailed Slack response 206 tokens versus concise 72, about one third. It is one example, not an average universal 3× improvement. Article includes held-out Slack/Asana performance plots and claims tool-description refinements helped Sonnet 3.5 on SWE-bench Verified, but no machine-readable task-level data or controlled CAD numbers are provided. Do not invent absolute success rates or speedups from those claims.

INFERRED: batching independent wonky observations can reduce serial agent latency; numerical summaries can use balanced fork-join maps/reductions. Consolidated state inspection should use one immutable revision, otherwise concurrent reads can yield an inconsistent “snapshot.” Pagination/filtering controls serialization cost, not automatically kernel cost. Benchmark both separately.

## Known failures, limitations, war stories

DOCUMENTED in “Analyzing results”: early web-search behavior unnecessarily appended 2025 to queries, degrading results; tool-description changes corrected it. Other failure patterns include selecting wrong tools, correct tools with wrong parameters, too few calls, mishandled responses, repeated redundant calls and context wasted on entire lists. Agent self-reports may omit these errors. This is primary author experience, not an issue-tracker reproduction.

INFERRED limitations: internal Slack/Asana task distributions differ from CAD. The article does not test F32 versus F64, topology changes, near-tangent Booleans, naming persistence, or manifoldness. Its 2025 context/token and model observations should not be treated as timeless specifications.

## Relevance for wonky

INFERRED proposal derived from the article, not its own prescribed CAD API:

- Small entry surface such as `wonky_evaluate` (execute FS against a revision), `wonky_describe` (bounded structural snapshot), `wonky_query` (typed geometric evaluation), `wonky_render`, and `wonky_export`; retain code-level primitives so the agent can compose operations instead of requiring one MCP tool per feature.
- Snapshot default includes revision, body count, failed/warning features, dimensional bounds, changed-provenance summary, units/frame, method/tolerance and completeness. Detailed entities/images are fetched by selector or stable handle. Stable IDs **plus** descriptors are better than names alone; names may collide and display indices can change after edits.
- Separate `total_count`, `returned_count`, `truncated`, cursor and applied filters. In detailed mode expose exact values/intervals; human-rounded numbers are explicitly display-only. Return `unsupported`/`unknown` instead of an empty successful result when backend work fails.
- Errors carry code, failing operation/source span, affected IDs, supported domain, actual parameter and one concrete remedy where known. Distinguish wrong selection, stale revision, invalid parameter, unsupported SSI, timeout and valid no-op. For a too-large result suggest a face-type/body/region filter rather than endlessly truncating.
- Evaluation cases: fillet-adjacent face selection, sketch-on-side-face frame, intentional versus accidental no-op cut, failed feature followed by repair, repeated-instance parameter edit, stale query after topology change, thin-wall/clearance checks. Grade dimensions/provenance and unchanged-region invariants, while logging tokens/latency/turns. Freeze a hold-out set of real Marc models and permit multiple correct workflows.

Bend fit: the coordination/JSON/MCP layer can be JS, but all production geometric answers stay in Bend. Immutable snapshots and U32 IDs suit affine arrays; F32x2 values must retain uncertainty and supported exponent/scale limits. Namespacing/token budgets impose no F64/FFI requirement. Uniform GPU work benefits from bounded batches of known query types; heterogeneous requests can be bucketed. No exact-predicate/SSI/Boolean/fillet algorithm is supplied by this article.

## Pointers worth porting or studying

Primary article sections “Generating evaluation tasks”, “Analyzing results”, “Choosing the right tools”, “Returning meaningful context”, “Optimizing tool responses for token efficiency”, “Prompt-engineering your tool descriptions”. Local source capture `<repo>/tmp/research/anthropic-writing-tools-for-agents.html`; readable extract `<repo>/tmp/research/anthropic-writing-tools-for-agents.txt`. No kernel code changed; cookbook not executed.

## Verdict: adopt

Adopt the evaluation discipline and interface principles, then validate them on wonky-specific tasks. They are concrete, low-dependency ways to improve agent correctness and cost, but not substitutes for exact geometric predicates, complete diagnostics, authorization boundaries or manufacturing checks.

