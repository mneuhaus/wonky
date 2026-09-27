# Farjana & Han 2018: Mechanisms of Persistent Identification of Topological Entities in CAD Systems: A Review

- Kind: literature review. Canonical DOI: https://doi.org/10.1016/j.aej.2018.01.007. Publisher: https://www.sciencedirect.com/science/article/pii/S1110016818300814. Author-institution repository: https://dro.deakin.edu.au/articles/journal_contribution/Mechanisms_of_Persistent_Identification_of_Topological_Entities_in_CAD_Systems_A_Review/20610213. Full PDF actually read, all 13 pages: https://ndownloader.figshare.com/files/36817107.
- Authors: Shahjadi Hisan Farjana (Macquarie University at publication), Soonhung Han (KAIST). Alexandria Engineering Journal 57(4), 2018, pp. 2837-2849; accepted January 30, available online November 16, 2018, per PDF.
- DOCUMENTED license: the publisher article printed in the repository PDF explicitly states CC-BY-NC-ND-4.0 and copyright Faculty of Engineering, Alexandria University. Repository API metadata instead says All Rights Reserved; OpenAlex's CC-BY description of the repository is not reliable here. Prefer the license printed on the actual article, flag the metadata discrepancy, and independently implement ideas rather than adapting protected figures/prose. No code/port license is granted. Sources: PDF p. 2837; https://api.figshare.com/v2/articles/20610213; https://creativecommons.org/licenses/by-nc-nd/4.0/.
- Access: ScienceDirect returned 403; Deakin/Figshare supplied the complete publisher-layout raster PDF. Text extraction yielded no article text, so it was read visually through the PDF Read tool, not treated as an empty source.
- Status: historical review, not a library, implementation release or benchmark artifact. Repository stars, language, contributors and last commit do not apply.

## What it is

DOCUMENTED: a classification of persistent identification into basic naming, ambiguity resolution and name matching/mapping, then a mechanism-by-mechanism literature tour. Its best value is distinguishing tasks often all called 'persistent naming' and collecting Korean/KAIST macro-parametric exchange work. The review proposes no complete new implementation, theorem or tested universal standard. Source: Sections 1-6 of the PDF above.

Evidence convention: DOCUMENTED below means what the review itself says. Mechanism descriptions of papers not directly inspected in this task are SECONDHAND/HEARSAY about those originals, not independently established algorithm details. Capoyleas and Wang were separately read from primary full texts, allowing specific cross-checks noted below.

## How it works

### Task decomposition and edit taxonomy

DOCUMENTED review taxonomy (Figs. 1, 6, 10, 13; Sections 3.1-3.3):

- Basic naming allocates descriptions when entities are created. Separate invariant entities directly determined by a constructive gesture from contingent entities produced by interactions with existing geometry.
- Ambiguity resolution distinguishes entities sharing a basic name after splits, merges or patterning.
- Name matching reconnects initial and reevaluated entities within a modeling setting; name mapping translates selection references across different CAD systems.
- Local matching compares one queried entity with candidates (1:N); global matching compares subsets (N:N). The review calls global matching more costly and more accurate, but supplies no benchmark proving this general ranking.

DOCUMENTED five editing categories E1-E5: insert/delete feature; change feature attributes; modify dimensions; change dimension scheme; change feature-shape definition. It explicitly states E1-E4 require name matching; it does not give a general solution for all E5 changes. Source: p. 2839.

### Mechanism catalogue with concrete representations

The introduction to Section 4 says '6' mechanisms, but the actual numbered subsections run 4.1-4.7. Treat the seven headings as an organizational catalogue, not seven disjoint mathematical classes. DOCUMENTED headings and their content follow.

1. Feature orientation / Capoyleas: construction-relative sweep/revolution orientation plus local boundary orientation and context expressions Ee=[Ce,Le,Fe], Ev=[Cv,Lv,Fv]. Sources: Section 4.1, pp. 2842-2843. PRIMARY CROSS-CHECK: the review reproduces a triple-normal sign formula without preserving the important rejection in Capoyleas's report; that report pp. 13-14 says the sign is not used because invariance is doubtful. Read the original before implementing it: https://www.cs.purdue.edu/cgvlab/www/resources/papers/Capoyleas-Computer_aided_design-1996-Generic_naming_in_generative.pdf.

2. faceIDGraph / Kripac: review gives FaceID=[StepID,faceIndex,SurfaceType], EdgeID=[adjFaceIDs,edgeIntersCode], VertexID=[adjFaceIDs,vertexIntersCode], plus graph updates recording historical face split/merge relationships. Multiple incoming/outgoing links express merges/splits. It criticizes missing basic-name and intersCode detail and memory cost. Source: Section 4.2, pp. 2843-2844. HEARSAY about original scope/performance: neither the Kripac implementation nor these criticisms were independently checked here.

3. ShellGraph / Agbodan-Marcheix-Pierra: hierarchical shells/subshells at multiple feature granularities; connected, overlapping and aggregate shells; preserve invariant/contingent history, then match graph structures. The review describes local pairwise topological-similarity measures followed by a global similarity-maximizing binary relation. Source: Section 4.3, p. 2844. HEARSAY as an account of the original algorithm; this review does not contain enough equations to implement the similarity objective safely.

4. Feature ID / Wu plus Mun-Han: review records construction fields such as feature ID, profile ID, element ID, path ID, trajectory ID, plus start/end roles or instance numbers for patterns. Wu's Parametric Space Information adds [originalName,sequence,total] for ambiguous names. Mun's Object Space Information instead orders representative points by x/y/z and stores OSI=[Order,Total_Num]; Secondary Name SN stores related face counts/names and merge/split history. A face name combines basic name, OSI and SN; edge/vertex names combine adjacent-face names plus OSI. Sources: Section 4.4, pp. 2844-2846, Figs. 21-24. HEARSAY regarding originals, but these field formats are explicitly printed in the review.

5. Semantic ID: this heading mixes Hepworth et al.'s multi-user reservation/caching work with Wang-Nnaji's surface-derived semantic names. They are different problems and should not become one implementation module. PRIMARY CROSS-CHECK: Wang really does use surfaces, boundary supports and derivative-based branch disambiguation; the primary paper contains crucial limitations absent from this summary. Sources: Section 4.5; https://msse.gatech.edu/publication/JCAD_PID_wang.pdf.

6. B-rep-based: combines boundary-representation variance ideas with Bidarra-Bronsvoort's separation between persistent entities in the parametric definition and their identification in evaluated B-rep. Review says design references should target the former and use feature information to locate the latter. Source: Section 4.6, p. 2846. HEARSAY regarding original guarantees or required user intervention; not a complete resolver specification.

7. Point-based / Song-Han: construct lines/faces from named construction points. Printed examples include Line=[Type,Point1,Point2,Op_point], polygonal Face=[Type,n,Point1,...,PointN], and circular Face=[Circle,Center_Point,Radius,Op_Radius]. New split vertices derive from sketch edge/start/end and operation roles. Source: Section 4.7, pp. 2846-2847. This is a neutral naming/exchange description, not a sufficient general representation of arbitrarily trimmed curved faces.

DOCUMENTED comparison/conclusion: the authors favor Mun-style topology-based names plus OSI ambiguity information, recommend expanding feature coverage and including dimensional-modification information, and argue for combining topology and geometry. They do not prove this scheme is universally unambiguous. Sources: Fig. 25 and Sections 5-6, pp. 2847-2848.

## Robustness and guarantees

DOCUMENTED: no common persistent-identification standard is established across the studied CAD systems; split, merge and pattern ambiguity recur. The review seeks a future hybrid approach and identifies feature-coverage gaps. It contains no numeric tolerance budget, exact-number model, completeness proof, statistical evaluation or reproducible matching code. Source: Sections 3, 5 and 6.

INFERRED from the described OSI scheme: ordering representative points by current coordinates does not establish history-stable identity under rotation, motion through a coordinate-order crossing, symmetries or coincident representatives. It is at best an additional discriminator with a defined frame and tie policy. Neither F32x2 nor exact integers solves this semantic problem. Source basis: OSI=[Order,Total_Num], p. 2845.

INFERRED source-quality caution: the review's categorical statements (e.g. geometry-based methods generating no ambiguity, or particular proprietary systems using only one naming family) are overbroad unless checked in original implementations. Fig. 5 screenshots and generic product-homepage references are not specifications of current kernels. Its reuse of a rejected Capoyleas orientation formula is a concrete reason to treat it as a reading map, not the implementation authority. Sources: pp. 2840, 2843, 2847-2848; Capoyleas primary cross-check above.

## Parallelism and performance

DOCUMENTED: qualitative comparisons only: graph methods may require more memory/computation; local matching is presented as cheaper than global; feature histories add data. No timings, dataset sizes, matching accuracy or measured parallel speedups appear. Source: Sections 3.3, 4.2-4.3 and 5.

INFERRED: basic-name allocation, degree-limited signature generation and pairwise geometric evidence can be data-parallel. History graph traversal and global correspondence selection require more careful staging. U32 immutable arrays, sorted adjacency/lineage records and fork-join candidate batches fit Bend; variable-degree histories and expanding ambiguous candidate sets need capacity limits or CPU execution rather than unbounded uniform GPU recursion. No performance prediction is claimed.

## Known failures, limitations, war stories

DOCUMENTED as historical examples collected by the review: Fig. 14 shows a SolidWorks fillet reference failing after extending a slot; Fig. 15 shows a FreeCAD naming ambiguity; Figs. 16-17 depict Siemens JT monitor IDs being duplicated by a split or accumulated on a merge. These are SECONDHAND/HEARSAY about the products, not reproduced issue reports, and should not be asserted against 2026 versions. Several references are only product homepages, not dated issue tickets. Source: Section 3.4, pp. 2841-2842 and references 22, 28, 29.

DOCUMENTED limitations of this source: it surveys rather than implements; its mechanism count is inconsistent; its classifications overlap; modern learning-based matching and subsequent product changes postdate it. Matching equations, numeric models and failure rates for the cited originals must be obtained separately. No issue tracker accompanies the paper.

## Relevance for wonky

INFERRED architecture checklist, derived from the review's task separation:

1. Creation: assign stable feature-role/support IDs and explicit instance lineage.
2. Operation output: record generated, modified, split, merged and deleted relations as many-to-many records, not only inherited display names.
3. Resolution: accept a revision-scoped semantic reference and return a candidate set, cardinality, evidence and failure status. Geometry supplements known history; it does not overwrite provenance silently.
4. Exchange: distinguish replaying neutral parametric history from history-free B-rep import. A scheme requiring an IGM/feature history is not a drop-in matcher for arbitrary STEP.
5. Diff: report separate feature, topology and geometric changes; test the three recurring ambiguity families (split, merge, pattern) under E1-E5 edits and frame changes.

Bend numeric fit: graph/name layers require only U32 symbols, offsets, enums and counts. OSI or geometric evidence requires explicit units/local frames and F32x2 tolerance-aware comparisons; exact predicates can use U32 limbs where their input model permits. Do not encode implicit f64 assumptions from host CAD APIs. Rigid-frame sensitivity, repeated-pattern identities and name collisions require structural policies, not more precision. Source basis: Sections 3-4.

For wonky's hybrid Boolean, the strongest lesson is to emit lineage while constructing analytic recovery results instead of reconstructing it afterward. For LLM ergonomics, expose whether failure occurred during base naming, disambiguation, revision mapping or unsupported geometry. This source does not provide an SSI, Boolean, offset or fillet algorithm.

## Pointers worth porting or studying

- Figs. 1/6/10/13: task decomposition and literature map.
- Figs. 7-9 and 16-17: merge/split/pattern test categories.
- Section 4.4: feature-role IDs versus coordinate-based disambiguation versus secondary history names.
- Follow-up primary sources identified, NOT fully read here:
  - Mun & Han 2005, Identification of Topological Entities and Naming Mapping for Parametric CAD Model Exchanges: https://www.koreascience.or.kr/article/JAKO200503018236985.page; institutional PDF https://koasas.kaist.ac.kr/bitstream/10203/6600/1/Identification%20of%20Topological%20Entities%20and%20Naming.pdf.
  - Cheon, Mun, Han, Kim 2012, Name matching method using topology merging and splitting history for exchange of feature-based CAD models: https://doi.org/10.1007/s12206-012-0827-3.
  - Mun & Han 2006, Persistent naming method using OSI (Object Space Information) and SN (Secondary Name), Korea CADCAM conference, review reference 15. No authoritative full-text URL verified here.
  - Farjana, Han, Mun 2016, Implementation of persistent identification of topological entities based on macro-parametrics approach: https://doi.org/10.1016/j.jcde.2016.01.001; publisher landing https://academic.oup.com/jcde/article/3/2/161/5743368.
  - Agbodan et al. 2003, A topological entity matching technique for geometric parametric models: https://ieeexplore.ieee.org/document/1199623/.
  - Wu et al., face-based naming paper, and Song/Han 2010 geometry-based neutral macro-file work: references 8 and 16, pp. 2848-2849; inspect originals before trusting this review's bibliographic years/claims.
- Local PDF: <repo>/tmp/research/pdf/farjana-han-2018-persistent-identification-review.pdf.

## Verdict: learn-from

Useful taxonomy, test checklist and bibliography bridge, especially toward OSI/SN and macro-parametric exchange. Not a correctness authority or direct algorithm port: validate the underlying papers, reject unsupported uniqueness/performance claims, and keep coordinate ordering subordinate to provenance and explicit ambiguity. All pages were read; follow-up originals and modern product behavior remain unverified.

Sources:
- [Full review PDF](https://ndownloader.figshare.com/files/36817107)
- [Review DOI](https://doi.org/10.1016/j.aej.2018.01.007)
- [Repository metadata](https://api.figshare.com/v2/articles/20610213)
- [Mun/Han 2005 follow-up record](https://www.koreascience.or.kr/article/JAKO200503018236985.page)
- [Cheon et al. 2012 follow-up](https://doi.org/10.1007/s12206-012-0827-3)
- [Farjana et al. 2016 follow-up](https://doi.org/10.1016/j.jcde.2016.01.001)
- [Agbodan et al. 2003 follow-up](https://ieeexplore.ieee.org/document/1199623/)

