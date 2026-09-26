from __future__ import annotations

import copy
import re
from difflib import SequenceMatcher
from typing import Any

from runtime.text_authority import reanchor_quote_to_authorities
from runtime.authority_contract import authority_manifest
from runtime.shot_visibility import visible_character_refs
from runtime.performance_logic_guard import (
    logic_evidence_grounded, logic_item_renderable, renderable_logic_fields, unsupported_logic_fields, unsupported_story_claim_terms,
)
from runtime.director_execution_authority import (
    performance_execution_field_violations, performance_execution_hard_violations, performance_execution_unrecognized,
    dialogue_delivery_field_violations, dialogue_delivery_hard_violations, dialogue_delivery_unrecognized,
)
from runtime.camera_grammar import canonicalize_framing_note, framing_note_violations, framing_note_unrecognized_clauses, framing_note_authority_violations

from prompt_foundry_v1_3.director_contract import (
    BODY_REGIONS,
    CONTINUITY_MODES,
    DEPENDENCY_TAGS,
    FOCUS_TYPES,
    FORBIDDEN_PERFORMANCE_MODIFIERS,
    STATIC_ASSET_STATE_KEYS,
    TRANSFORMATION_TYPES,
)
from prompt_foundry_v1_3.state_resolver import empty_state, resolve_state_in
from prompt_foundry_v1_3.asset_compilers import CAMERA_MAP, MOVEMENT_MAP, SHOT_SIZE_MAP

CONTRACT_VERSION = "director_shot.v18_0_2"

SOFT_QUALITY_ERROR_TYPES = frozenset({
    # Dialogue-restatement detection is lexical/heuristic. Exact evidence, refs,
    # continuity and state transitions remain hard Director gates.
    "director_speech_action_restates_dialogue",
    "director_repeated_continuity_design",
    # Director v17 quality signals are intentionally soft during the first
    # production-learning cycle. They may block final rendering selectively,
    # but they must not consume the single semantic Repair budget by themselves.
    "director_performance_logic_ungrounded",
    "director_performance_logic_unsupported_inference",
    "director_performance_too_abstract",
    "director_action_transition_missing",
    "director_performance_density_mismatch",
    "director_performance_budget_high",
    "director_performance_execution_grammar_unrecognized",
    # v17.8: execution/delivery prose is optional non-authoritative enrichment.
    # Unsupported story facts are diagnosed and filtered before rendering instead
    # of spending the single model Repair budget. Authoritative performance_actions,
    # refs, evidence, continuity and state remain hard gates.
    "director_performance_execution_unsafe",
    "director_dialogue_delivery_unsafe",
    # Camera natural language is open-ended. Unknown-but-not-leaking framing prose
    # is diagnostic only; hard E027 is reserved for deterministic ownership or
    # authority violations.
    "director_camera_grammar_unrecognized",
    "director_camera_authority_unresolved",
    "director_camera_note_unsafe",
    "director_dialogue_delivery_grammar_unrecognized",
    # Camera diversity is an aesthetic/quality heuristic, not an objective
    # contract invariant. Keep the signal visible without consuming Repair.
    "director_repeated_execution_design",
    "director_scene_design_monoculture",
    "director_scene_camera_distribution_pressure",
    # v18 Scene Context is quality enhancement. Not using an available context is
    # observable but must never consume Repair or pause the run.
    "W018_SCENE_CONTEXT_UNUSED",
    # Core-chain-first policy: camera/framing coherence is important for quality,
    # but it is not objective story authority.  Deterministic stabilizers repair
    # the common cases first; any residual design mismatch remains visible as a
    # warning instead of pausing the whole run.
    "director_shot_purpose_design_conflict",
    "director_shot_purpose_framing_conflict",
    "director_over_shoulder_invalid",
    "director_over_shoulder_target_conflict",
    "director_two_shot_invalid",
    "director_framing_design_conflict",
    "director_framing_target_conflict",
    "director_shot_size_focus_conflict",
    "director_visual_target_focus_mismatch",
})

SYSTEM_PROMPT = """你是 Prompt Foundry Core v1.3 的 Director v18.0_2 Reaction & Camera Consumption 层，当前只处理一个 Shot。
你只负责导演语义，不得修改 Base Shot、Script、Story Bible 或任何 stable ref。
只输出 JSON：{\"director\": {...}}。
模型拥有并输出：dramatic_intent、shot_purpose、scene_position、scene_context_usage、primary_subject_refs、reaction_target_refs、performance_actions、performance_logic、performance_execution、dialogue_delivery、camera_execution、visual_target、visual_focus、execution_framing、execution_shot_design、action_delta、continuity_scope。performance_logic / performance_execution / dialogue_delivery 都允许空数组；不要为了填 Schema 凑字段。camera_execution 与 execution_framing / execution_shot_design 表示同一摄影执行决定，必须保持一致。
程序拥有：speaker_target_refs、state_in、state_out、Base Fact Constraints、Base Execution Fallback、runtime-derived creative context、allowed refs、全局第一镜 reset；不要输出 speaker_target_refs、state_in 或 state_out。Base Fact Constraints 属于 Fact Authority，绝不能修改；Base Execution Fallback 只是摄影执行参考，不是正确答案。state_out 由程序根据 resolved state_in + action_delta 确定性计算。
primary_subject_refs / reaction_target_refs / performance_actions[*].character_ref / execution_framing.foreground_character_refs 只能使用 program_owned.allowed_character_refs；道具绝不能写入 primary_subject_refs。道具视觉主体只允许写入 visual_target.prop_refs / visual_focus.prop_refs，且只能使用 program_owned.allowed_prop_refs。
reaction_target_refs 只表示当前镜头视觉上承接反应的角色，不是客观剧情动作声明；它不要求同角色必须存在 performance_action。performance_actions 仅在当前 Shot 权威证据明确支持客观可见动作时输出；没有客观动作证据时允许 reaction_target 只通过 performance_execution / 构图呈现，二者也都可以为空，不得为了满足 reaction 镜头而编造动作。


shot_purpose 是当前镜头的叙事功能，只能从 output_contract.allowed_values 中选择。必须先判断“这一镜为什么存在”，再决定摄影：establish_space 建立空间；relationship 建立人物关系；speaker 承载说话者；reaction 承载听者/受作用者反应；detail 强调手、道具、局部线索；action 承载明确可见动作；reveal 揭示当前已授权信息；transition 处理进出、移动或空间转换；emotional_peak 承载情绪峰值；closing 提供段落或场景落点；continuity 仅用于真正需要保持上一镜连续动作/视角的情况。不要把 continuity 当作逃避镜头设计的默认值。
scene_position 表示当前 Shot 在整场戏中的戏剧阶段，只能是 setup / reveal / reaction / escalation / confirmation / transition / release。若 program_owned.scene_context_status 为 available 或 repaired，program_owned.scene_position 是 Runtime 从 Scene Context Phase membership 确定性派生的 creative context；模型应按该值输出，Runtime 最终会确定性 canonicalize，不能把它当剧情事实改写。若 Scene Context 不可用，才根据当前已授权 Shot/Beat 独立判断，不得编造剧情。
scene_context_usage 只能从 dramatic_function / emotional_arc / relationship_dynamics / reaction_strategy / camera_strategy / character_performance_baseline 中选择，表示本镜实际使用过哪些 Scene Context 决策。Scene Context 不可用时必须输出 []；可用时不要为了填字段虚报，确实使用了哪些就写哪些。
Director v18.0_2 的执行决策必须读取 program_owned.scene_position、reaction_opportunity、reaction_candidate_refs、scene_director_context、previous_shot_design、next_shot_purpose、scene_camera_baseline、scene_distribution_so_far。严格按“当前戏剧功能 → visual subject → framing/foreground relation → shot_size/camera/movement”的顺序决策；不要先读取 Base Execution 再解释它为什么合理。Scene Context 负责整场策略，不提供具体动作、具体机位或具体运镜；previous_shot_design 只告诉你上一镜实际怎么拍；next_shot_purpose 只包含下一镜 scene_position；scene_distribution_so_far 只是观察信息，不是多样性硬门槛。
当 reaction_opportunity=true 时，必须先显式比较两个合法视觉方案：A=当前 speaker/既有视觉主体；B=program_owned.reaction_candidate_refs 中由当前 Shot 反应证据、Scene speaker_listener 关系或唯一非 speaker 角色确定性筛出的 listener/reaction target。若选择 B，primary_subject_refs、reaction_target_refs、visual_target 与 execution_framing 必须一致表达该反应主体；dialogue speaker、FrozenText、dialogue ownership 与客观事件完全不变。若 B 为空，表示多人关系仍有歧义，不得自行把任意非 speaker 推断成 listener；此时可以继续选择 A。reaction_opportunity 不是 listener quota，但不能被忽略。
Camera Consumption 顺序固定为：先确定 scene_position 与 visual subject，再确定 framing/foreground relation，再比较 previous_shot_design 与 next_shot_purpose.scene_position，最后结合 scene_camera_baseline 选择 shot_size/camera/movement。Base Execution Fallback 只在上述信息都没有给出更合适执行时才使用。scene_camera_baseline=stable/mostly_static 只定义场景阈值，不等于当前镜头必须 eye_level/static；当 reveal→reaction、transition→escalation、confirmation→release 等现有 Dramatic Turn 使主体关系或信息权重发生变化时，应重新判断景别、机位与构图是否仍服务当前 Shot。movement 仍需有明确叙事理由，禁止为变化而变化。
execution_framing 决定画面关系，而不是剧情事实。framing_type 只能是 single / two_shot / over_shoulder / reaction / detail / environment。foreground_character_refs 只用于当前 Shot 已有角色：over_shoulder 时必须明确前景肩后角色，视觉主体由 visual_target 决定；two_shot 用于关系与对峙；reaction 用于说话声持续时切听者/受作用者；detail 用于手、物件、局部身体；environment 用于空间建立或转场。不得凭空新增第三人、遮挡物或不存在的空间位置。
镜头语法优先服务叙事功能：建立空间优先远景/全景；人物关系优先双人关系镜或过肩；关键说话可用中近景/近景；听者反应、情绪转折、死亡/震惊/认知变化等可用反应近景或特写；手、钥匙、伤口、道具等关键视觉信息优先细节近景/特写；人物进出、移动、场景转换可用全景/远景和必要移动。不要为了“高级感”随机变化。
连续对话不要机械连续拍同一说话者：优先形成“关系建立镜 → 说话者/受作用者 → 反应镜/细节镜 → 必要时回到关系镜”的可读节奏。voice source 与 visual target 已分离，所以台词持续时允许画面切到另一人物反应。
visual_target 是“这一镜画面主要看谁/看什么”，与 speaker_target_refs（谁在说话）严格分离。对白或旁白持续时，画面可以切到听者反应、另一角色、道具或既有环境信息；不要因为某人说话就机械把视觉目标锁定为说话者。visual_target.target_type 只能是 character / reaction / prop / environment / spatial_relation。
visual_focus 是 visual_target 的局部强调：character/reaction 目标时，visual_focus.subject_refs/body_regions 必须落在 visual_target.character_refs 内；prop 目标时 visual_focus.prop_refs 必须落在 visual_target.prop_refs 内；environment 目标时 environment_keys 必须有上游环境权威。
execution_shot_design 是 Director 在 Fact Boundary 内重新做的执行设计。program_owned.base_shot_fact_constraints 属于最高 Fact Authority；program_owned.base_execution_fallback 只在前述 creative context 都不能给出更合适执行时作为 fallback。shot_size/camera/movement 只能使用 output_contract.allowed_values 中的冻结枚举。正式决策优先级：1 Fact Authority Constraints；2 current scene_position；3 reaction_opportunity + reaction_candidate_refs；4 current shot_purpose/dialogue function；5 primary visual subject；6 framing/foreground relation；7 previous_shot_design；8 next_shot_purpose.scene_position；9 scene_camera_baseline；10 base_execution_fallback。Scene baseline 不是逐镜命令，Base execution 也不是 authority；只有当前叙事功能、视觉主体和前后关系都没有要求变化且 Base execution 仍最合适时才完全沿用。多样性不是目标，intentional execution 才是目标。output_template 中 creative enum 的空字符串只是结构占位，不是默认答案；必须从 output_contract.allowed_values 选择实际值。
景别必须服务视觉重点：wide / extreme_wide 不得同时要求 face / eyes / mouth / hands 这类精细局部 visual_focus；需要精细局部时应选择更合适的 medium_close / close / extreme_close 等景别。
若 validation_errors 含 director_shot_size_focus_conflict：这是当前镜头内部的“执行景别 vs 精细视觉重点”冲突，必须在本次 Repair 内闭环，不得原样返回。若错误提供 allowed_repair_values，则保留 shot_purpose、visual_target、visual_focus、execution_framing 和其他合法字段，只把 director.execution_shot_design.shot_size 改为 allowed_repair_values 中最符合当前叙事功能的值；不得为了保留 wide 而删除 hands/face/eyes/mouth 等已合法视觉重点。若错误的 repair_action 要求 preserve_wide_and_relax_precision_focus，则说明 shot_purpose=establish_space，wide/extreme_wide 本身是硬要求：保持执行景别不变，把 visual_focus 从精细 body_region 收缩为与 visual_target 一致的非精细 character / spatial_relation / environment 焦点，不得同时把 establish_space 改成其他功能。兼容旧 checkpoint：若 director_shot_size_focus_conflict 只有 type/detail/path、没有 repair_action 或 allowed_repair_values，则读取 repair_instruction.invalid_output.director；若其 shot_purpose=establish_space，按 preserve_wide_and_relax_precision_focus 处理；否则保持现有精细 visual_focus 不变，只把 wide/extreme_wide 改成 medium_close / close / extreme_close 中与当前 purpose 最匹配的一项。
若 validation_errors 含 reaction 相关 director_shot_purpose_design_conflict：只修镜头执行尺度/构图冲突，不得因为 reaction_target 缺少客观 performance_action 而补写剧情动作。reaction_target 是视觉选择，不是动作事实；只要角色 ref 合法即可保留。
若 validation_errors 含 director_visual_target_focus_mismatch：visual_target 是当前镜头主视觉目标权威，不得为了通过校验而扩大或改写 visual_target。读取错误里的 repair_targets 与 allowed_character_refs / allowed_prop_refs，只修 visual_focus 对应字段，使 subject_refs、body_regions key 或 prop_refs 严格落在 visual_target 已声明集合内；保持 shot_purpose、execution_framing、execution_shot_design 及其他合法字段不变。不得新增角色/道具 ref，不得原样返回非法 focus。
若 validation_errors 含 invalid_primary_subject_ref：primary_subject_refs 只允许角色。读取 invalid_ref 与 allowed_character_refs / allowed_prop_refs；若 invalid_ref 是合法 prop_ref，只从 primary_subject_refs 删除该 ref，保持既有 visual_target / visual_focus 的合法 prop 表达不变，不得把 prop 改写为 character；若 invalid_ref 既不是合法 character 也不是合法 prop，则不得猜测替代 ref。
若 quality warnings 出现 director_repeated_execution_design / director_scene_design_monoculture / director_scene_camera_distribution_pressure：它们只提示摄影可能重复或过度集中，不是 Hard Repair 目标。保持剧情、对白、shot_purpose、visual_target 与连续性优先；只有当当前叙事功能确实需要时，才选择更合适的 shot_size / camera / framing / movement。禁止为了消除 warning 随机增加斜角、手持、推拉摇移或改变镜头功能。
Director v17.3 将“发生什么”和“怎么演”严格分开：performance_actions 仍绑定 Production Semantics 的客观事件；performance_logic 只解释当前人物为什么以这种方式表演，不能创造剧情事实；performance_execution 只写可见/可听的表演执行；dialogue_delivery 只决定冻结对白怎么说；camera_execution 只决定怎么拍。
performance_logic[*] 字段：character_ref、base_emotion、emotion_delta、trigger、behavior_goal、behavior_tendency、evidence_source。除 character_ref 外都可以为空。字段级 authority 规则：base_emotion / emotion_delta 只允许当前 authority 明确出现或同一冻结情绪概念的克制解释；trigger 必须直接引用当前 authority 已存在的事件短语，不得自由改写新事件；behavior_goal 只有当前 authority 明确表达该目标时才可填写；behavior_tendency 只允许“视线/呼吸/身体/手部/动作节奏/前压或回避”等纯表演倾向，禁止逃跑、攻击、抢夺、杀死、报警、联系他人、逼迫道歉等新剧情动作。base_emotion / behavior_tendency 是当前 narrative context 内可继承的表演基线；若 program_owned.performance_baseline_in 已有对应角色基线，除非当前权威证据明确支持变化，否则沿用。每条非空 performance_logic 必须绑定 evidence_source=[{quote}]；引用真实 quote 只证明证据存在，不自动授权 trigger / goal / emotion 推断。任何不满足字段级 authority 的内容只留 debug，不得进入 baseline 或最终 Prompt。
performance_execution[*] 字段：character_ref、expression、gaze、breathing、body、hands、movement、micro_reaction、action_transition、end_state。除 character_ref 外都可为空，只填当前镜头真实可见且有用的信息。expression/gaze/breathing/body/micro_reaction 只能做表演调制；hands/movement/action_transition/end_state 若改变客观动作、道具、伤势、人物进出或动作结果，必须由 program_owned.performance_execution_authority 明确支持。不得借表演字段创造枪、刀伤、血迹、爆炸、陌生人进入、逃跑、攻击等新剧情事实。
dialogue_delivery[*] 不得包含对白正文，只引用 program_owned.dialogue_delivery_targets 中的 frozen_text_unit_id / speaker_ref。emotion/volume/pace/pause/delivery/gaze_during_line 必须遵守受控 delivery 语义类别：可以使用自然中文组合描述情绪强度、音量、语速、停顿、咬字/吐字/语气/声线/尾音及当前合法视线，例如“语气平淡自然”“略带好奇和试探”“咬字清楚，尾音收住”；gaze 可指向 program_owned 当前允许角色/别名/道具，或“对方/当前对象/前方/下方”等泛化当前目标。不得写童年、复仇、枪声、逃跑、外部事件或新增人物/道具。对白文字始终由 FrozenTextUnit 原样回填。
camera_execution 字段：framing_type、foreground_character_refs、shot_size、camera、movement、framing_note。硬摄影事实由 framing_type / foreground_character_refs / visual_target / visual_focus / shot_size / camera / movement 等结构化字段承担。framing_note 只是可选的非权威导演构图备注：允许自然中文描述主体占比、视觉引导、留白、框景、层次和空间关系；不得写对白、人物表演、心理或场景光线。framing_note 永远不是 Hard authority：其中任何明确对白/表演/心理/光线泄漏，或无法从结构化当前 Shot authority 证明的自由文本实体，都只产生质量 Warning；Compiler 会整条省略该 note，不得因 framing_note 消耗 Repair。
program_owned.performance_density_target 为 low / medium / high：low 只需少量自然表演信号；medium 至少保留一个关键可见表演信号（如视线/表情/身体/手部）；high 必须提供足以执行的 performance_execution，不能通过留空 v17 字段退化成普通动作描述，并在存在 A→转折→B 时填写 action_transition。不要为了“专业”把所有字段填满。
performance_actions 只能做 physical_sequence_expansion / visible_state_expression / temporal_order_expansion。当前 Shot 的权威事件边界必须由 production_semantics 支持；在不新增叙事事件、关系、结果、道具或新信息的前提下，Director 可以增加可见且可执行的表演细节，例如眼神、停顿、呼吸、眉眼、嘴角、手指、肩颈、身体重心、轻微前倾/后退与自然说话反应。
performance_actions.action 以简体中文可执行表演谓词为主；character_ref 是该 action 唯一的动作主体字段，因此 action 不要在第一个动作动词前重复角色姓名/代词。可以在动词之后保留合法动作对象的人名、地名、品牌、型号等专有名词。语言形式不是剧情事实 Gate，不得仅因拉丁字母改写事实。
对于有对白的角色，performance_actions.action 只能描述可见表演 cue（如停顿、看向、抬眼、低头、开口、轻声/低声等有证据支持的表现），不得复述对白语义，不得写“问某事 / 回答某内容 / 告诉某事 / 讲述某经过 / 表示某意思 / 说出第几句台词”。对白正文只由 shot.dialogue 承载一次。若 validation_errors 含 director_speech_action_restates_dialogue，只删除 action 中复述对白含义的部分；若无其他可见 cue，则收缩为“说话”或与问号/对白形式一致的最小“询问”，不得修改 dialogue。
performance_actions.action 的表演修饰属于导演层软决策，不要求修饰词逐字出现在原文证据中；但必须是当前剧情情境下的可见表演，不得把“爱、恨、背叛、原谅、决定、相信、回忆、秘密”等心理/关系结论当作新增事实，也不得用表演细节改变原事件的因果、结果或人物立场。
performance_actions[*].dependency_tags 只能是 face / eyes / mouth / head / neck / upper_body / lower_body / hands / feet / wardrobe_interaction / prop_interaction / spatial_interaction / body_detail。
每个 performance_action.source_evidence 必须是非空数组 [{\"quote\":\"...\"}]，quote 只能逐字复制自 program_owned.current_shot_action_evidence；只要输出 performance_action，就绝不能把 source_evidence 留空。该白名单只来自 production_semantics.visual_events / production_choices 的 source_evidence，以及 production_semantics.dialogue 的冻结对白正文；不得再直接从 shot.description 或整个 Base Shot description 取动作证据。若 program_owned.current_shot_action_evidence 为空，则 performance_actions 必须输出 []，不得凭上下文自行补动作。
production_semantics 是当前 Shot 的生产语义权威：visual_events / 已批准 production_choices 决定“这一镜发生什么可拍动作”；Director 只负责表演与视觉强调。audio_events 不是表演动作证据，diegetic_text 不是表演动作证据，appearance_overlays 是程序拥有的视觉上下文覆盖，均不得被改写为新动作。script_beat 与 shot.description 只用于理解剧情上下文，不是 performance_actions 的动作证据。Context ≠ Evidence（上下文不等于证据）。
若 validation_errors 含 director_performance_subject_mismatch：character_ref 是 performance_action 唯一主体；action 只表达谓词。若 repair_action=rebind_character_ref_to_evidence_subject，说明逐字证据/结构化 Production Semantics 唯一确定了主体，只改 character_ref。若 repair_action=strip_redundant_action_subject_prefix，说明当前 action 在首个动作动词前重复/冲突写了 canonical_name，但声明 character_ref 仍属于当前证据允许的主体候选；只删除动作前的主体标签，保留动作谓词、对象、source_evidence 与剧情事件。若 repair_action=collapse_canonical_name_plus_pronoun，只删除冗余主语词。只有没有任何确定性结构规则可收敛时才允许模型 Repair；不得改 source_evidence、不得借别名/亲属称谓/自由代词消解猜主体。原样返回不是 Repair。
若 validation_errors 含 director_missing_performance_evidence：定位错误指向的 performance_action；先从 program_owned.current_shot_action_evidence 选择逐字存在且真正支持该动作事件的最小 quote，补成非空 source_evidence，并在必要时把 action 收缩到该证据支持的最小可见表演。若白名单为空，或没有任何白名单证据能够支持该动作事件，则删除该 performance_action，并同步删除仅由该动作产生的 reaction_target_refs、visual_focus 与 action_delta 变化；不得伪造 quote，不得从 script_beat/shot.description 借证据。
若 validation_errors 含 unanchored_performance_evidence：只允许从 program_owned.current_shot_action_evidence 中选择逐字存在且真正支持该动作的原句，并同步把 action 收缩到证据支持的最小动作；若没有任何当前 Shot 白名单证据支持该动作，则删除该 performance_action，并同步删除仅由该非法动作产生的 reaction_target_refs、visual_focus 与 action_delta 变化，不得伪造替代动作。state_out 为程序派生字段，不得输出或修改。
若 validation_errors 含 stale_action_delta：逐项读取错误 detail 中列出的字段路径；凡 action_delta 中该字段值与 resolved state_in 完全相同，必须从 action_delta 删除该字段，绝不能修改 state_in、绝不能换一种同义表达继续写回 action_delta。只有当前 Shot 结束时真实改变并需要下一镜继承的动态状态，才允许写入 action_delta。
speaking 属于镜内瞬时事件，不属于跨镜持久状态；说话由 shot.dialogue 与 performance_actions 表达，禁止写入 action_delta。若 validation_errors 含 transient_state_in_action_delta，直接删除对应 speaking 字段，不得转写到其他状态字段。
角色持有道具的状态只使用 props.<prop_ref>.held_by 表达；禁止在 characters 下重复写 hold_prop / held_prop / prop_in_hand / held_prop_refs。若需要结束持有关系，在 action_delta 中写 props.<prop_ref>.held_by = null。
visual_focus.focus_type 只能是 character / body_region / prop / spatial_relation / environment / reaction。
visual_focus.body_regions 必须是 JSON object：body_regions 的 key 必须是 program_owned.allowed_character_refs 中的 character_ref，value 必须是 body region 数组。body region 只能是 face / eyes / mouth / head / neck / upper_body / lower_body / hands / feet。
posture、gaze_direction、action 等语义标签绝不能作为 body_regions 的 key；“站立”“坐下”“望向监控屏幕”“转头”等动作/姿态/视线描述也绝不能作为 body region。若这些内容有当前权威文本支持，应放在 performance_actions.action 等对应语义字段；没有支持则不要新增。
visual_focus.subject_refs 只能放当前 Shot 角色 ID；visual_focus.prop_refs 只能放当前 Shot 道具 ID；不得把自然语言、字段名、动作名当 stable ref。
visual_focus.environment_keys 只能写 program_owned.environment_focus_authority 中已有文本能够直接支持的环境焦点；允许保留已授权专有名词，但不得新造环境事实。
action_delta 必须是 {characters:{}, props:{}, environment:{}}，只声明“镜头结束时仍成立、需要后续继承”的动态变化；镜内瞬时动作只放 performance_actions。state_out 不由模型输出，由程序将 action_delta 应用到 resolved state_in 后确定性生成。action_delta 字段值可用 null 表示清除一个已继承的动态字段；其他必填 array/object 仍不得为 null。
continuity_scope 是“模型选择 + 程序构造”的字段。模型输出固定使用简单结构 {"mode":"reset|inherit|partial","inherit_paths":[]}；不要直接输出嵌套 inherit 对象。
reset：输出 {"mode":"reset","inherit_paths":[]}，表示不继承上一镜动态状态。
inherit：输出 {"mode":"inherit","inherit_paths":[]}，表示完整继承上一镜动态状态。
partial：只用于“从 previous_state_out 选择部分既有动态字段继承”，输出 {"mode":"partial","inherit_paths":["characters.char_002.position","props.prop_001.held_by","environment.door_state"]}。
partial 的 inherit_paths 必须是非空字符串数组，每一项必须逐字来自 output_contract.continuity_scope.partial.allowed_inherit_paths；不得写状态值、自然语言描述或未声明路径。
程序会把 inherit_paths 确定性转换成 canonical inherit 对象并计算 state_in；模型不得输出 state_in/state_out。没有任何字段要继承时用 mode=reset；需要完整继承时用 mode=inherit。
如果 user payload 含 repair_instruction：这是当前 Unit 的定点修复，不是重新创作。必须以 repair_instruction.invalid_output 为基底，只修 validation_errors 指向的字段；其余已合法语义保持不变，并严格重新核对 output_contract.allowed_values、stable refs 与嵌套 JSON 结构。
除 action_delta 的具体动态字段值可用 null 表示“清除已继承状态”外，所有必填 array/object 用 []/{} 且不得为 null。不得输出未知字段、image_prompt、video_prompt、platform_prompt 或 markdown。"""

DIRECTOR_MODEL_FIELDS = {
    "dramatic_intent",
    "primary_subject_refs",
    "reaction_target_refs",
    "performance_actions",
    # v17 director-quality blocks. Arrays may be empty; individual optional
    # execution fields use empty strings when not useful for the current Shot.
    "performance_logic",
    "performance_execution",
    "dialogue_delivery",
    "camera_execution",
    "shot_purpose",
    "scene_position",
    "scene_context_usage",
    "visual_target",
    "visual_focus",
    # v16 compatibility fields remain model-visible for one release so existing
    # targeted Repair paths keep working. camera_execution is the v17 canonical
    # grouping and Runtime keeps the representations synchronized.
    "execution_framing",
    "execution_shot_design",
    "action_delta",
    "continuity_scope",
}
DIRECTOR_CANONICAL_FIELDS = DIRECTOR_MODEL_FIELDS | {"speaker_target_refs", "state_out"}
PERFORMANCE_FIELDS = {
    "character_ref", "action", "transformation_type", "dependency_tags", "source_evidence"
}
PERFORMANCE_LOGIC_FIELDS = {
    "character_ref", "base_emotion", "emotion_delta", "trigger", "behavior_goal",
    "behavior_tendency", "evidence_source",
}
PERFORMANCE_EXECUTION_FIELDS = {
    "character_ref", "expression", "gaze", "breathing", "body", "hands", "movement",
    "micro_reaction", "action_transition", "end_state",
}
DIALOGUE_DELIVERY_FIELDS = {
    "frozen_text_unit_id", "speaker_ref", "emotion", "volume", "pace", "pause",
    "delivery", "gaze_during_line",
}
CAMERA_EXECUTION_FIELDS = {
    "framing_type", "foreground_character_refs", "shot_size", "camera", "movement", "framing_note",
}
EVIDENCE_FIELDS = {"quote"}
FOCUS_FIELDS = {"focus_type", "subject_refs", "body_regions", "prop_refs", "environment_keys"}
VISUAL_TARGET_TYPES = {"character", "reaction", "prop", "environment", "spatial_relation"}
VISUAL_TARGET_FIELDS = {"target_type", "character_refs", "prop_refs", "environment_keys"}
SHOT_PURPOSES = {"establish_space", "relationship", "speaker", "reaction", "detail", "action", "reveal", "transition", "emotional_peak", "closing", "continuity"}
SCENE_POSITIONS = {"setup", "reveal", "reaction", "escalation", "confirmation", "transition", "release"}
SCENE_CONTEXT_USAGE_VALUES = {
    "dramatic_function", "emotional_arc", "relationship_dynamics", "reaction_strategy",
    "camera_strategy", "character_performance_baseline",
}
FRAMING_TYPES = {"single", "two_shot", "over_shoulder", "reaction", "detail", "environment"}
EXECUTION_FRAMING_FIELDS = {"framing_type", "foreground_character_refs"}
EXECUTION_DESIGN_FIELDS = {"shot_size", "camera", "movement"}
PRECISION_BODY_REGIONS = {"face", "eyes", "mouth", "hands"}
STATE_FIELDS = {"characters", "props", "environment"}
SCOPE_FIELDS = {"mode", "inherit"}
INHERIT_FIELDS = {"characters", "props", "environment"}



_VISIBLE_EXECUTION_FIELDS = (
    "expression", "gaze", "breathing", "body", "hands", "movement", "micro_reaction",
    "action_transition", "end_state",
)

_ABSTRACT_PERFORMANCE_TERMS_RE = re.compile(
    r"(?:压迫感|破碎感|宿命感|复杂情绪|内心(?:震动|挣扎|崩溃)|感到|觉得|意识到|"
    r"愤怒|暴怒|伤心|失望|心死|控制欲|羞愧|绝望|爱|恨|原谅|背叛|决定|相信)"
)
# Camera ownership is validated by runtime.camera_grammar positive grammar.
_ACTION_TRANSITION_HINT_RE = re.compile(r"(?:随后|然后|接着|转而|停住|停下|改为|转向|再|下一秒|紧接着|→)")


def _performance_logic_authorities(context: dict[str, Any]) -> list[str]:
    """Exact authority surface for v17 performance interpretation.

    Interpretation may use current Script/Shot context, but it may not invent
    history/relationships. This list is deliberately text-grounded and small.
    """
    values: list[str] = []
    program = context.get("program_owned") if isinstance(context.get("program_owned"), dict) else {}
    for value in program.get("current_shot_action_evidence") or _collect_current_shot_action_evidence(context):
        if isinstance(value, str) and value.strip() and value.strip() not in values:
            values.append(value.strip())
    shot = context.get("shot") if isinstance(context.get("shot"), dict) else {}
    for item in shot.get("source_evidence") or []:
        if isinstance(item, dict) and isinstance(item.get("quote"), str) and item.get("quote", "").strip():
            quote = item["quote"].strip()
            if quote not in values:
                values.append(quote)
    for item in shot.get("dialogue") or []:
        if isinstance(item, dict):
            line = str(item.get("line") or item.get("text") or "").strip()
            if line and line not in values:
                values.append(line)
    beat = context.get("script_beat") if isinstance(context.get("script_beat"), dict) else {}
    description = str(beat.get("description") or "").strip()
    if description and description not in values:
        values.append(description)
    narration = beat.get("narration")
    if isinstance(narration, str) and narration.strip() and narration.strip() not in values:
        values.append(narration.strip())
    elif isinstance(narration, list):
        for value in narration:
            if isinstance(value, str) and value.strip() and value.strip() not in values:
                values.append(value.strip())
    for item in beat.get("dialogue") or []:
        if isinstance(item, dict):
            line = str(item.get("line") or item.get("text") or "").strip()
            if line and line not in values:
                values.append(line)
    return values


def _logic_item_grounded(item: dict[str, Any], context: dict[str, Any]) -> bool:
    return logic_evidence_grounded(item, _performance_logic_authorities(context))


def _logic_item_renderable(item: dict[str, Any], context: dict[str, Any]) -> bool:
    return logic_item_renderable(item, _performance_logic_authorities(context))


def _allowed_director_entity_terms(context: dict[str, Any]) -> list[str]:
    terms: list[str] = []
    program = context.get("program_owned") if isinstance(context.get("program_owned"), dict) else {}
    allowed_chars = set(program.get("allowed_character_refs") or [])
    allowed_props = set(program.get("allowed_prop_refs") or [])
    assets = context.get("assets") if isinstance(context.get("assets"), dict) else {}
    chars = assets.get("characters") if isinstance(assets.get("characters"), dict) else {}
    for ref in allowed_chars:
        item = chars.get(ref) if isinstance(chars.get(ref), dict) else {}
        for value in [item.get("canonical_name"), item.get("name"), *(item.get("aliases") or [])]:
            text = str(value or "").strip()
            if text and text not in terms:
                terms.append(text)
    story = context.get("story_bible") if isinstance(context.get("story_bible"), dict) else {}
    # Character aliases are safe for gaze/framing target validation when they
    # belong to an already allowed current-Shot character. They are *not* used
    # by E021 subject ownership, which intentionally stays canonical-name only.
    for char in story.get("characters") or []:
        if not isinstance(char, dict) or str(char.get("character_id") or "") not in allowed_chars:
            continue
        for value in [char.get("canonical_name"), *(char.get("aliases") or [])]:
            text = str(value or "").strip()
            if text and text not in terms:
                terms.append(text)
    for prop in story.get("props") or []:
        if not isinstance(prop, dict) or str(prop.get("prop_id") or "") not in allowed_props:
            continue
        for value in [prop.get("canonical_name"), prop.get("name"), *(prop.get("aliases") or [])]:
            text = str(value or "").strip()
            if text and text not in terms:
                terms.append(text)
    return terms


def _performance_execution_authorities(context: dict[str, Any]) -> list[str]:
    values = list(_performance_logic_authorities(context))
    semantics = context.get("production_semantics") if isinstance(context.get("production_semantics"), dict) else {}
    for group in ("visual_events", "production_choices"):
        for item in semantics.get(group) or []:
            if not isinstance(item, dict):
                continue
            for key in ("action", "choice", "description"):
                value = str(item.get(key) or "").strip()
                if value and value not in values:
                    values.append(value)
    shot = context.get("shot") if isinstance(context.get("shot"), dict) else {}
    for key in ("description", "spatial_blocking", "composition"):
        value = str(shot.get(key) or "").strip()
        if value and value not in values:
            values.append(value)
    return values


def _camera_framing_authorities(context: dict[str, Any]) -> list[str]:
    values = _performance_execution_authorities(context)
    for value in _collect_environment_focus_authority(context):
        if value not in values:
            values.append(value)
    return values


def _renderable_logic_fields(item: dict[str, Any], context: dict[str, Any]) -> dict[str, str]:
    return renderable_logic_fields(item, _performance_logic_authorities(context))

def _performance_density_target(context: dict[str, Any], director: dict[str, Any] | None = None) -> str:
    """Deterministic prompt-size hint; not a creative judgment."""
    shot = context.get("shot") if isinstance(context.get("shot"), dict) else {}
    semantics = context.get("production_semantics") if isinstance(context.get("production_semantics"), dict) else {}
    visual_events = [x for x in semantics.get("visual_events", []) or [] if isinstance(x, dict) and str(x.get("action") or "").strip()]
    visible_count = len([x for x in shot.get("character_refs", []) or [] if isinstance(x, str) and x])
    dialogue_count = len([x for x in shot.get("dialogue", []) or [] if isinstance(x, dict) and str(x.get("line") or x.get("text") or "").strip()])
    action_text = "；".join(str(x.get("action") or "") for x in visual_events)
    transition_rich = bool(_ACTION_TRANSITION_HINT_RE.search(action_text)) or len(visual_events) >= 2
    purpose = str((director or {}).get("shot_purpose") or "")
    if purpose == "emotional_peak" or (purpose == "action" and transition_rich) or (transition_rich and visible_count >= 2):
        return "high"
    if purpose in {"speaker", "reaction", "relationship", "reveal", "action"} or dialogue_count or visible_count >= 2 or visual_events:
        return "medium"
    return "low"


def _performance_signal_count(director: dict[str, Any]) -> int:
    count = 0
    for item in director.get("performance_execution") or []:
        if not isinstance(item, dict):
            continue
        count += sum(1 for field in _VISIBLE_EXECUTION_FIELDS if str(item.get(field) or "").strip())
    return count


def _performance_payload_chars(director: dict[str, Any]) -> int:
    fields: list[str] = []
    for key in ("performance_logic", "performance_execution"):
        for item in director.get(key) or []:
            if not isinstance(item, dict):
                continue
            for name, value in item.items():
                if name in {"character_ref", "evidence_source"}:
                    continue
                if isinstance(value, str) and value.strip():
                    fields.append(value.strip())
    return sum(len(x) for x in fields)


def _dialogue_delivery_targets(context: dict[str, Any]) -> list[dict[str, Any]]:
    shot = context.get("shot") if isinstance(context.get("shot"), dict) else {}
    refs = [str(x) for x in ((shot.get("frozen_text_unit_refs") or {}).get("dialogue") or []) if isinstance(x, str) and x]
    dialogue = [x for x in shot.get("dialogue", []) or [] if isinstance(x, dict)]
    out: list[dict[str, Any]] = []
    for index, item in enumerate(dialogue):
        if index >= len(refs):
            break
        out.append({
            "dialogue_index": index,
            "frozen_text_unit_id": refs[index],
            "speaker_ref": str(item.get("character_id") or ""),
        })
    return out


def _performance_baseline_in(context: dict[str, Any]) -> dict[str, dict[str, str]]:
    previous = context.get("previous_state_out") if isinstance(context.get("previous_state_out"), dict) else {}
    chars = previous.get("characters") if isinstance(previous.get("characters"), dict) else {}
    out: dict[str, dict[str, str]] = {}
    for ref, state in chars.items():
        if not isinstance(state, dict):
            continue
        baseline = state.get("performance_baseline") if isinstance(state.get("performance_baseline"), dict) else {}
        clean = {
            key: str(baseline.get(key) or "").strip()
            for key in ("base_emotion", "behavior_tendency")
            if str(baseline.get(key) or "").strip()
        }
        if clean:
            out[str(ref)] = clean
    return out

_SUBJECT_ACTION_VERB_RE = re.compile(
    r"(?:抬|低|看|望|转|伸|走|推|拉|递|接|拿|放|敲|压|修|坐|站|起|停|点|摇|说|开口|问|回答|抓|甩|靠|退|前倾|后退|离开|进入|经过|扶|翻|按|拍|挥)"
)


def _explicit_canonical_subject_refs(text: str, names: dict[str, str]) -> list[str]:
    """Return visible character refs explicitly named before the first action verb.

    This is intentionally lexical and high-confidence only. It does not resolve
    aliases, relationship titles, nicknames or pronouns.
    """
    value = str(text or "").strip()
    if not value:
        return []
    verb = _SUBJECT_ACTION_VERB_RE.search(value)
    if not verb:
        return []
    subject_prefix = value[:verb.start()]
    return [ref for ref, name in names.items() if name and name in subject_prefix]


def _strip_canonical_subject_prefix(text: str, names: dict[str, str]) -> str:
    """Canonicalize a performance action to predicate-only wording.

    `character_ref` is the sole structural owner of a performance action.  A
    canonical character name that appears before the first action verb is therefore
    transport prose, not a second ownership authority.  Remove the named subject
    while preserving any executable modifier between the last subject name and the
    first verb.  Names that occur after the first verb remain untouched because they
    may be legitimate action targets (e.g. ``看向角色乙``).
    """
    value = str(text or "").strip()
    if not value:
        return value
    verb = _SUBJECT_ACTION_VERB_RE.search(value)
    if not verb:
        return value
    prefix = value[:verb.start()]
    occurrences: list[tuple[int, int]] = []
    for name in names.values():
        if not name:
            continue
        start = prefix.rfind(name)
        if start >= 0:
            occurrences.append((start, start + len(name)))
    if not occurrences:
        return value
    _, last_end = max(occurrences, key=lambda pair: pair[1])
    modifier = prefix[last_end:]
    modifier = re.sub(r"^[\s，,、:：]*(?:(?:他|她|它|其)[\s，,、:：]*)?(?:的)?", "", modifier)
    normalized = f"{modifier}{value[verb.start():]}".strip(" \t，,、:：")
    return normalized or value


def _semantic_evidence_subject_refs(context: dict[str, Any], names: dict[str, str]) -> dict[str, list[str]]:
    """Map exact current-shot provenance quotes to upstream semantic owners.

    Production Semantics is the objective action authority. When one exact evidence
    quote is already attached to a visual event / approved production choice with a
    unique character owner, Director may reuse that owner without language inference.
    If multiple owners remain, the quote stays ambiguous.
    """
    out: dict[str, list[str]] = {}
    semantics = context.get("production_semantics") if isinstance(context.get("production_semantics"), dict) else {}
    for group in ("visual_events", "production_choices"):
        for item in semantics.get(group) or []:
            if not isinstance(item, dict):
                continue
            refs = item.get("character_refs") or item.get("affected_character_refs") or item.get("subject_refs") or []
            refs = [str(ref) for ref in refs if isinstance(ref, str) and ref in names]
            # If the upstream semantic action itself names one canonical subject, use
            # that stronger owner signal to narrow a multi-character event.
            semantic_text = str(item.get("action") or item.get("choice") or "").strip()
            explicit = _explicit_canonical_subject_refs(semantic_text, names) if semantic_text else []
            if len(explicit) == 1 and explicit[0] in refs:
                refs = explicit
            refs = list(dict.fromkeys(refs))
            if not refs:
                continue
            for evidence in item.get("source_evidence") or []:
                if not isinstance(evidence, dict):
                    continue
                quote = str(evidence.get("quote") or "").strip()
                if not quote:
                    continue
                bucket = out.setdefault(quote, [])
                for ref in refs:
                    if ref not in bucket:
                        bucket.append(ref)
    return out


def _director_subject_ownership_errors(
    director: dict[str, Any], context: dict[str, Any], state_in: dict[str, Any]
) -> list[dict[str, Any]]:
    """Detect high-confidence structured/text subject ownership collisions.

    Canonical names are the only names interpreted here. Evidence may decide which
    structured owner is correct only when one current-shot source_evidence quote has
    a unique explicit canonical subject before its first action verb.
    """
    shot = context.get("shot") if isinstance(context.get("shot"), dict) else {}
    visible_refs = visible_character_refs(
        shot,
        director=director,
        state_in=state_in,
        legacy_fallback=False,
    )
    assets = context.get("assets") if isinstance(context.get("assets"), dict) else {}
    chars = assets.get("characters") if isinstance(assets.get("characters"), dict) else {}
    names = {
        ref: str((chars.get(ref) or {}).get("canonical_name") or "").strip()
        for ref in visible_refs
        if isinstance(chars.get(ref), dict)
    }
    semantic_evidence_owners = _semantic_evidence_subject_refs(context, names)
    errors: list[dict[str, Any]] = []
    for index, item in enumerate(director.get("performance_actions", []) or []):
        if not isinstance(item, dict):
            continue
        owner_ref = str(item.get("character_ref") or "")
        text = str(item.get("action") or "").strip()
        if not text:
            continue
        verb = _SUBJECT_ACTION_VERB_RE.search(text)
        if not verb:
            continue
        subject_prefix = text[:verb.start()]
        owner_name = names.get(owner_ref, "")
        action_path = f"director.performance_actions[{index}].action"
        owner_path = f"director.performance_actions[{index}].character_ref"

        # Canonical name + redundant pronoun is mechanically collapsible because
        # both tokens denote the already-declared same subject; no pronoun resolution
        # is needed.
        if owner_name and re.match(rf"^{re.escape(owner_name)}[\s，,:：]*(?:他|她|它|其)", subject_prefix):
            error = _err(
                "director_performance_subject_mismatch",
                f"performance action redundantly encodes canonical subject '{owner_name}' followed by a pronoun before the first action verb",
                path=action_path,
            )
            error.update({
                "code": "E021_DIRECTOR_PERFORMANCE_SUBJECT_MISMATCH",
                "declared_character_ref": owner_ref,
                "conflicting_character_ref": owner_ref,
                "conflicting_canonical_name": owner_name,
                "subject_collision_kind": "canonical_name_plus_pronoun",
                "repair_targets": [action_path],
                "repair_action": "collapse_canonical_name_plus_pronoun",
                "repair_instruction": "remove only the redundant pronoun immediately following the canonical subject; preserve the canonical name, event and evidence",
            })
            errors.append(error)
            continue

        for other_ref, canonical_name in names.items():
            if other_ref == owner_ref or not canonical_name:
                continue
            if canonical_name not in subject_prefix:
                continue

            evidence_subject_refs: list[str] = []
            structural_subject_refs: list[str] = []
            for evidence in item.get("source_evidence") or []:
                if not isinstance(evidence, dict):
                    continue
                quote = str(evidence.get("quote") or "").strip()
                for ref in _explicit_canonical_subject_refs(quote, names):
                    if ref not in evidence_subject_refs:
                        evidence_subject_refs.append(ref)
                for ref in semantic_evidence_owners.get(quote, []):
                    if ref not in structural_subject_refs:
                        structural_subject_refs.append(ref)
            # Structured Production Semantics ownership outranks lexical inference
            # because it is already part of the frozen current-shot action authority.
            unique_structural_subject = structural_subject_refs[0] if len(structural_subject_refs) == 1 else ""
            unique_evidence_subject = unique_structural_subject or (evidence_subject_refs[0] if len(evidence_subject_refs) == 1 else "")
            evidence_candidate_subject_refs = _ordered_unique(structural_subject_refs + evidence_subject_refs)

            error = _err(
                "director_performance_subject_mismatch",
                f"performance action is owned by {owner_ref}, but another visible canonical character name '{canonical_name}' appears before the first action verb",
                path=action_path,
            )
            base = {
                "code": "E021_DIRECTOR_PERFORMANCE_SUBJECT_MISMATCH",
                "declared_character_ref": owner_ref,
                "declared_canonical_name": owner_name,
                "conflicting_character_ref": other_ref,
                "conflicting_canonical_name": canonical_name,
                "source_evidence_quotes": [
                    str(e.get("quote") or "").strip()
                    for e in (item.get("source_evidence") or [])
                    if isinstance(e, dict) and str(e.get("quote") or "").strip()
                ],
                "semantic_evidence_subject_refs": structural_subject_refs,
                "evidence_candidate_subject_refs": evidence_candidate_subject_refs,
            }
            if unique_evidence_subject == other_ref:
                base.update({
                    "evidence_subject_ref": other_ref,
                    "evidence_subject_canonical_name": canonical_name,
                    "repair_targets": [owner_path],
                    "repair_action": "rebind_character_ref_to_evidence_subject",
                    "repair_instruction": "exact evidence uniquely owns the action; change only character_ref and preserve the predicate/evidence",
                })
            elif unique_evidence_subject == owner_ref:
                base.update({
                    "evidence_subject_ref": owner_ref,
                    "evidence_subject_canonical_name": owner_name,
                    "repair_targets": [action_path],
                    "repair_action": "strip_redundant_action_subject_prefix",
                    "repair_instruction": "character_ref already matches the unique evidence owner; remove only the canonical subject label before the first action verb and keep the predicate/evidence unchanged",
                })
            elif owner_ref in evidence_candidate_subject_refs:
                # Ambiguous quote/semantic ownership cannot be made less ambiguous by
                # asking the model to repeat the same evidence.  The structured
                # character_ref is already one of the authorized candidates and is
                # the schema's sole owner field, so canonicalize action prose to a
                # predicate instead of spending the one semantic Repair.
                base.update({
                    "evidence_subject_ref": None,
                    "repair_targets": [action_path],
                    "repair_action": "strip_redundant_action_subject_prefix",
                    "repair_instruction": "source evidence permits the declared character_ref but does not uniquely resolve the pronoun; keep character_ref and remove only the conflicting canonical subject label from action prose",
                })
            elif other_ref in evidence_candidate_subject_refs:
                base.update({
                    "evidence_subject_ref": other_ref,
                    "evidence_subject_canonical_name": canonical_name,
                    "repair_targets": [owner_path],
                    "repair_action": "rebind_character_ref_to_evidence_subject",
                    "repair_instruction": "declared character_ref is outside the evidence candidates while the explicit action subject is evidence-authorized; rebind only character_ref",
                })
            else:
                # No evidence layer can uniquely arbitrate the pronoun.  Re-asking
                # the model with the same evidence cannot create new information and
                # was the source of E021 -> repair_no_effect loops.  Preserve the
                # already-valid structured owner and remove only the competing prose
                # subject label.  A unique contrary evidence owner would already
                # have been handled by the branches above.
                base.update({
                    "evidence_subject_ref": None,
                    "repair_targets": [action_path],
                    "repair_action": "strip_redundant_action_subject_prefix",
                    "repair_instruction": "current-shot evidence cannot uniquely arbitrate ownership; character_ref remains the sole structured owner, so remove only the competing canonical subject label from action prose",
                })
            error.update(base)
            errors.append(error)
            break
    return errors

TRANSIENT_CHARACTER_STATE_FIELDS = {"speaking"}
CHARACTER_PROP_HOLDING_ALIASES = {"hold_prop", "held_prop", "prop_in_hand", "held_prop_refs"}

# Persistent state is for externally observable continuity only. Psychological / relationship
# conclusions belong to dramatic_intent or current-shot performance and must never leak across shots.
NON_PERSISTENT_SEMANTIC_STATE_KEYS = {
    "mood", "emotion", "feeling", "nervous", "sad", "angry", "fear", "afraid",
    "love", "hate", "trust", "relationship", "relationship_state", "motive",
    "motivation", "intention", "belief", "memory", "thought", "secret", "attitude",
}

# Positive state vocabulary: only externally observable continuity that may still matter
# in the following shot. Unknown keys are rejected instead of silently becoming new state.
PERSISTENT_CHARACTER_STATE_FIELDS = {
    "position", "posture", "pose", "orientation", "gaze_target", "gaze_direction",
    "physical_condition", "injury", "wetness", "visible_clothing_state", "body_state",
}
PERSISTENT_PROP_STATE_FIELDS = {"position", "state", "held_by", "open_state", "visible_condition"}
PERSISTENT_ENVIRONMENT_STATE_FIELDS = {"door_state", "window_state", "light_state", "weather_state", "surface_state", "visibility_state"}


def _state_map_shape_ok(value: Any) -> bool:
    return isinstance(value, dict) and all(isinstance(value.get(k), dict) for k in STATE_FIELDS)


def _normalize_prop_holding_aliases(delta: Any, context: dict[str, Any]) -> tuple[Any, int]:
    """Mechanical alias normalization only; canonical holding relation lives on props.<ref>.held_by."""
    if not _state_map_shape_ok(delta):
        return delta, 0
    out = copy.deepcopy(delta)
    changes = 0
    allowed_props = set(((context.get("program_owned") or {}).get("allowed_prop_refs") or []))
    characters = out.get("characters") or {}
    props = out.get("props") or {}
    for char_ref, fields in list(characters.items()):
        if not isinstance(fields, dict):
            continue
        for alias in list(CHARACTER_PROP_HOLDING_ALIASES):
            if alias not in fields:
                continue
            raw = fields.get(alias)
            refs: list[str] = []
            if isinstance(raw, str) and raw:
                refs = [raw]
            elif isinstance(raw, list) and all(isinstance(x, str) and x for x in raw):
                refs = list(raw)
            if not refs or any(ref not in allowed_props for ref in refs):
                continue
            conflict = False
            for prop_ref in refs:
                current = (props.get(prop_ref) or {}).get("held_by") if isinstance(props.get(prop_ref), dict) else None
                if current not in (None, char_ref):
                    conflict = True
                    break
            if conflict:
                continue
            for prop_ref in refs:
                props.setdefault(prop_ref, {})["held_by"] = char_ref
            del fields[alias]
            changes += 1
        if not fields:
            del characters[char_ref]
    out["characters"] = characters
    out["props"] = props
    return out, changes


def _apply_action_delta(state_in: dict[str, Any], delta: dict[str, Any]) -> dict[str, Any]:
    """Program-owned state transition: state_out = state_in patched by persistent action_delta."""
    out = copy.deepcopy(state_in if _state_map_shape_ok(state_in) else empty_state())
    if not _state_map_shape_ok(delta):
        return out
    for section in ("characters", "props"):
        for ref, fields in (delta.get(section) or {}).items():
            if not isinstance(fields, dict):
                continue
            target = out[section].setdefault(ref, {})
            for field, value in fields.items():
                if section == "characters" and field in TRANSIENT_CHARACTER_STATE_FIELDS:
                    continue
                if value is None:
                    target.pop(field, None)
                else:
                    target[field] = copy.deepcopy(value)
            if not target:
                out[section].pop(ref, None)
    for field, value in (delta.get("environment") or {}).items():
        if value is None:
            out["environment"].pop(field, None)
        else:
            out["environment"][field] = copy.deepcopy(value)
    return out


def derive_state_out_v10(state_in: dict[str, Any], action_delta: dict[str, Any]) -> dict[str, Any]:
    """Public Runtime v10 state transition used by compile-time compatibility validation."""
    return _apply_action_delta(state_in, action_delta)


def _err(etype: str, detail: str, *, path: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"type": etype, "detail": detail}
    if path:
        out["path"] = path
    return out


def _ordered_unique(values: list[str]) -> list[str]:
    out: list[str] = []
    for value in values:
        if value not in out:
            out.append(value)
    return out


def _speaker_refs(context: dict[str, Any]) -> list[str]:
    refs: list[str] = []
    for item in ((context.get("shot") or {}).get("dialogue") or []):
        if isinstance(item, dict) and isinstance(item.get("character_id"), str) and item.get("character_id"):
            refs.append(item["character_id"])
    return _ordered_unique(refs)


def _normalize_evidence(value: Any) -> tuple[Any, int]:
    changes = 0
    if isinstance(value, str):
        return ([{"quote": value}] if value.strip() else []), 1
    if not isinstance(value, list):
        return value, 0
    out: list[Any] = []
    for item in value:
        if isinstance(item, str):
            out.append({"quote": item})
            changes += 1
        else:
            out.append(copy.deepcopy(item))
    return out, changes


def _allowed_partial_inherit_paths(previous_state_out: dict[str, Any]) -> list[str]:
    allowed = _allowed_partial_inherit_fields(previous_state_out)
    paths: list[str] = []
    for section in ("characters", "props"):
        for ref, fields in (allowed.get(section) or {}).items():
            for field in fields:
                paths.append(f"{section}.{ref}.{field}")
    for field in allowed.get("environment") or []:
        paths.append(f"environment.{field}")
    return paths


def _inherit_scope_from_paths(paths: list[str]) -> dict[str, Any] | None:
    inherit: dict[str, Any] = {"characters": {}, "props": {}, "environment": []}
    for raw_path in paths:
        if not isinstance(raw_path, str) or not raw_path.strip():
            return None
        path = raw_path.strip()
        parts = path.split(".")
        if len(parts) == 3 and parts[0] in {"characters", "props"} and parts[1] and parts[2]:
            section, ref, field = parts
            fields = inherit[section].setdefault(ref, [])
            if field not in fields:
                fields.append(field)
            continue
        if len(parts) == 2 and parts[0] == "environment" and parts[1]:
            field = parts[1]
            if field not in inherit["environment"]:
                inherit["environment"].append(field)
            continue
        return None
    return inherit


def _canonicalize_continuity_scope(scope: Any) -> tuple[Any, int]:
    """Normalize the model continuity envelope into the canonical state-resolver shape.

    The model selects only mode + flat inherit_paths. Runtime owns the nested
    inherit representation. Legacy nested inherit is accepted for checkpoint/repair
    compatibility. Empty partial selections are mathematically equivalent to reset.
    """
    if not isinstance(scope, dict):
        return scope, 0
    mode = scope.get("mode")
    if mode in {"reset", "inherit"}:
        canonical = {"mode": mode}
        return canonical, int(scope != canonical)
    if mode != "partial":
        return scope, 0

    if "inherit_paths" in scope:
        paths = scope.get("inherit_paths")
        if not isinstance(paths, list) or not all(isinstance(x, str) and x.strip() for x in paths):
            return scope, 0
        unique = _ordered_unique([x.strip() for x in paths])
        if not unique:
            canonical = {"mode": "reset"}
            return canonical, int(scope != canonical)
        inherit = _inherit_scope_from_paths(unique)
        if inherit is None:
            return scope, 0
        canonical = {"mode": "partial", "inherit": inherit}
        return canonical, int(scope != canonical)

    # Backward-compatible legacy representation. Missing sections mean "select none"
    # for that section and can be filled mechanically. An empty selection equals reset.
    inherit = scope.get("inherit")
    if inherit in (None, "", []):
        canonical = {"mode": "reset"}
        return canonical, int(scope != canonical)
    if not isinstance(inherit, dict):
        return scope, 0
    chars = copy.deepcopy(inherit.get("characters", {}))
    props = copy.deepcopy(inherit.get("props", {}))
    env = copy.deepcopy(inherit.get("environment", []))
    if not isinstance(chars, dict) or not isinstance(props, dict) or not isinstance(env, list):
        return scope, 0
    if not chars and not props and not env:
        canonical = {"mode": "reset"}
        return canonical, int(scope != canonical)
    canonical = {"mode": "partial", "inherit": {"characters": chars, "props": props, "environment": env}}
    return canonical, int(scope != canonical)


def _derived_scene_position(context: dict[str, Any]) -> str:
    program = context.get("program_owned") if isinstance(context.get("program_owned"), dict) else {}
    status = str(program.get("scene_context_status") or "")
    if status not in {"available", "repaired"}:
        return ""
    explicit = str(program.get("scene_position") or "")
    if explicit in SCENE_POSITIONS:
        return explicit
    scene_context = program.get("scene_director_context") if isinstance(program.get("scene_director_context"), dict) else {}
    shot_id = str((context.get("shot") or {}).get("shot_id") or "")
    matches = [
        str(phase.get("function") or "")
        for phase in (scene_context.get("emotional_arc") or [])
        if isinstance(phase, dict) and shot_id in (phase.get("shot_refs") or [])
    ]
    matches = [value for value in matches if value in SCENE_POSITIONS]
    return matches[0] if len(matches) == 1 else ""


def _base_execution_fallback(context: dict[str, Any]) -> dict[str, Any]:
    program = context.get("program_owned") if isinstance(context.get("program_owned"), dict) else {}
    fallback = program.get("base_execution_fallback")
    if isinstance(fallback, dict) and fallback:
        return fallback
    legacy = program.get("base_shot_design")
    if isinstance(legacy, dict) and legacy:
        return legacy
    shot = context.get("shot") if isinstance(context.get("shot"), dict) else {}
    return {
        "shot_size": shot.get("shot_size"),
        "camera": shot.get("camera"),
        "movement": shot.get("movement"),
    }


def canonicalize_director_fragment(
    raw: Any,
    context: dict[str, Any],
    *,
    is_first_global_shot: bool,
) -> tuple[Any, int]:
    """Mechanical representation normalization only; never repair Director semantics."""
    if not isinstance(raw, dict):
        return raw, 0
    out = copy.deepcopy(raw)
    changes = 0

    # Director v16 backward-compatible representation migration. Old v15 outputs
    # did not carry visual_target / execution_shot_design. Both can be recovered
    # without inventing semantics: visual_target mirrors the already-authored
    # visual_focus, while execution_shot_design defaults to the frozen Base Shot.
    if "visual_target" not in out and isinstance(out.get("visual_focus"), dict):
        focus = out.get("visual_focus") or {}
        focus_type = str(focus.get("focus_type") or "")
        target_type = (
            "reaction" if focus_type == "reaction" else
            "prop" if focus_type == "prop" else
            "environment" if focus_type == "environment" else
            "spatial_relation" if focus_type == "spatial_relation" else
            "character"
        )
        character_refs = list(focus.get("subject_refs") or [])
        if target_type in {"character", "reaction"} and not character_refs:
            character_refs = list(out.get("primary_subject_refs") or [])
        out["visual_target"] = {
            "target_type": target_type,
            "character_refs": character_refs if target_type in {"character", "reaction", "spatial_relation"} else [],
            "prop_refs": list(focus.get("prop_refs") or []) if target_type in {"prop", "spatial_relation"} else [],
            "environment_keys": list(focus.get("environment_keys") or []) if target_type in {"environment", "spatial_relation"} else [],
        }
        changes += 1
    if "execution_shot_design" not in out:
        base_design = _base_execution_fallback(context)
        shot = context.get("shot") or {}
        out["execution_shot_design"] = {
            "shot_size": base_design.get("shot_size") or shot.get("shot_size"),
            "camera": base_design.get("camera") or shot.get("camera"),
            "movement": base_design.get("movement") or shot.get("movement"),
        }
        changes += 1
    if "shot_purpose" not in out:
        out["shot_purpose"] = "continuity"
        changes += 1
    derived_scene_position = _derived_scene_position(context)
    if derived_scene_position:
        if out.get("scene_position") != derived_scene_position:
            changes += 1
        out["scene_position"] = derived_scene_position
    elif "scene_position" not in out:
        out["scene_position"] = "transition" if out.get("shot_purpose") == "transition" else "setup"
        changes += 1
    if "scene_context_usage" not in out or out.get("scene_context_usage") is None:
        out["scene_context_usage"] = []
        changes += 1
    if "execution_framing" not in out:
        target = out.get("visual_target") if isinstance(out.get("visual_target"), dict) else {}
        target_type = str(target.get("target_type") or "")
        framing_type = (
            "environment" if target_type == "environment" else
            "detail" if target_type == "prop" else
            "reaction" if target_type == "reaction" else
            "single"
        )
        out["execution_framing"] = {"framing_type": framing_type, "foreground_character_refs": []}
        changes += 1

    # Director v17 blocks are optional at the semantic level. Canonical output
    # always materializes the collection keys so downstream code has one shape,
    # while empty collections mean "not needed for this Shot" rather than missing.
    for key in ("performance_logic", "performance_execution", "dialogue_delivery"):
        if key not in out or out.get(key) is None:
            out[key] = []
            changes += 1

    # camera_execution is the v17 grouped camera authority. The v16 fields remain
    # canonical compatibility aliases for one release because existing deterministic
    # validators / ShotSpec code already consume them. When the v17 block is present,
    # it wins and Runtime synchronizes the legacy aliases mechanically.
    camera_execution = out.get("camera_execution") if isinstance(out.get("camera_execution"), dict) else None
    if camera_execution is None:
        framing = out.get("execution_framing") if isinstance(out.get("execution_framing"), dict) else {}
        design = out.get("execution_shot_design") if isinstance(out.get("execution_shot_design"), dict) else {}
        out["camera_execution"] = {
            "framing_type": str(framing.get("framing_type") or "single"),
            "foreground_character_refs": list(framing.get("foreground_character_refs") or []),
            "shot_size": str(design.get("shot_size") or ""),
            "camera": str(design.get("camera") or ""),
            "movement": str(design.get("movement") or ""),
            "framing_note": "",
        }
        changes += 1
    else:
        canonical_camera = {
            "framing_type": str(camera_execution.get("framing_type") or (out.get("execution_framing") or {}).get("framing_type") or "single"),
            "foreground_character_refs": list(camera_execution.get("foreground_character_refs") or (out.get("execution_framing") or {}).get("foreground_character_refs") or []),
            "shot_size": str(camera_execution.get("shot_size") or (out.get("execution_shot_design") or {}).get("shot_size") or ""),
            "camera": str(camera_execution.get("camera") or (out.get("execution_shot_design") or {}).get("camera") or ""),
            "movement": str(camera_execution.get("movement") or (out.get("execution_shot_design") or {}).get("movement") or ""),
            "framing_note": canonicalize_framing_note(camera_execution.get("framing_note")),
        }
        if camera_execution != canonical_camera:
            out["camera_execution"] = canonical_camera
            changes += 1
        target_framing = {
            "framing_type": canonical_camera["framing_type"],
            "foreground_character_refs": copy.deepcopy(canonical_camera["foreground_character_refs"]),
        }
        target_design = {
            "shot_size": canonical_camera["shot_size"],
            "camera": canonical_camera["camera"],
            "movement": canonical_camera["movement"],
        }
        if out.get("execution_framing") != target_framing:
            out["execution_framing"] = target_framing
            changes += 1
        if out.get("execution_shot_design") != target_design:
            out["execution_shot_design"] = target_design
            changes += 1

    # speaker targets are always program-owned, regardless of model output.
    speakers = _speaker_refs(context)
    if out.get("speaker_target_refs") != speakers:
        out["speaker_target_refs"] = speakers
        changes += 1

    # The first global shot has no prior state. reset is mechanical, not a model choice.
    if is_first_global_shot and out.get("continuity_scope") != {"mode": "reset"}:
        out["continuity_scope"] = {"mode": "reset"}
        changes += 1
    elif not is_first_global_shot:
        normalized_scope, scope_changes = _canonicalize_continuity_scope(out.get("continuity_scope"))
        if scope_changes:
            out["continuity_scope"] = normalized_scope
            changes += scope_changes

    actions = out.get("performance_actions")
    if isinstance(actions, list):
        shot = context.get("shot") if isinstance(context.get("shot"), dict) else {}
        action_visible_refs = visible_character_refs(
            shot, director=out, state_in=context.get("previous_state_out") or {}, legacy_fallback=False
        )
        chars = ((context.get("assets") or {}).get("characters") or {}) if isinstance(context.get("assets"), dict) else {}
        action_names = {
            ref: str((chars.get(ref) or {}).get("canonical_name") or "").strip()
            for ref in action_visible_refs
            if isinstance(chars.get(ref), dict)
        }
        for action in actions:
            if not isinstance(action, dict):
                continue
            # v17.9 canonical form: character_ref is the sole action owner.  When
            # model prose merely repeats that same canonical subject before the
            # first verb, remove the redundant subject so Compiler can safely prepend
            # the canonical name exactly once.  Conflicting/multi-subject prefixes
            # remain for E021 to adjudicate against current-shot evidence.
            action_text = str(action.get("action") or "").strip()
            owner_ref = str(action.get("character_ref") or "")
            explicit_subjects = _explicit_canonical_subject_refs(action_text, action_names)
            if explicit_subjects and set(explicit_subjects) == {owner_ref}:
                predicate = _strip_canonical_subject_prefix(action_text, action_names)
                if predicate != action_text:
                    action["action"] = predicate
                    changes += 1
            evidence, delta = _normalize_evidence(action.get("source_evidence"))
            if delta:
                action["source_evidence"] = evidence
                changes += delta
            if isinstance(action.get("source_evidence"), list):
                authorities = (context.get("program_owned") or {}).get("current_shot_action_evidence") or _collect_current_shot_action_evidence(context)
                for ev in action["source_evidence"]:
                    if not isinstance(ev, dict) or not isinstance(ev.get("quote"), str):
                        continue
                    anchored = _reanchor_director_performance_quote(
                        ev.get("quote"),
                        [text for text in authorities if isinstance(text, str) and text.strip()],
                        action,
                        context,
                    )
                    if anchored is not None and anchored != ev.get("quote"):
                        ev["quote"] = anchored
                        changes += 1

    # Optional Director enrichment must never become a core-chain blocker merely
    # because the model attached it to an invalid/non-current character. These
    # blocks own no objective story facts, so invalid items are deterministically
    # dropped before validation. Objective performance_actions remain hard-gated.
    allowed_model_chars = set((context.get("program_owned") or {}).get("allowed_character_refs") or [])

    logic_items = out.get("performance_logic")
    if isinstance(logic_items, list):
        compact_logic = [
            item for item in logic_items
            if not isinstance(item, dict)
            or str(item.get("character_ref") or "") in allowed_model_chars
        ]
        if compact_logic != logic_items:
            out["performance_logic"] = compact_logic
            logic_items = compact_logic
            changes += 1

    execution_items = out.get("performance_execution")
    if isinstance(execution_items, list):
        compact_execution_refs = [
            item for item in execution_items
            if not isinstance(item, dict)
            or str(item.get("character_ref") or "") in allowed_model_chars
        ]
        if compact_execution_refs != execution_items:
            out["performance_execution"] = compact_execution_refs
            execution_items = compact_execution_refs
            changes += 1

    # dialogue_delivery is optional metadata over immutable FrozenText. Unknown
    # units are dropped, duplicate units keep the first instruction, and speaker
    # ownership is corrected from the frozen unit itself. No dialogue text changes.
    delivery_items = out.get("dialogue_delivery")
    if isinstance(delivery_items, list):
        targets = {
            str(item.get("frozen_text_unit_id") or ""): item
            for item in _dialogue_delivery_targets(context)
            if isinstance(item, dict) and str(item.get("frozen_text_unit_id") or "")
        }
        compact_delivery = []
        seen_delivery_units: set[str] = set()
        for item in delivery_items:
            if not isinstance(item, dict):
                compact_delivery.append(item)
                continue
            unit_id = str(item.get("frozen_text_unit_id") or "")
            target = targets.get(unit_id)
            if target is None or unit_id in seen_delivery_units:
                changes += 1
                continue
            normalized_item = copy.deepcopy(item)
            expected_speaker = str(target.get("speaker_ref") or "")
            if normalized_item.get("speaker_ref") != expected_speaker:
                normalized_item["speaker_ref"] = expected_speaker
                changes += 1
            compact_delivery.append(normalized_item)
            seen_delivery_units.add(unit_id)
        if compact_delivery != delivery_items:
            out["dialogue_delivery"] = compact_delivery

    # v17 performance-logic evidence uses a broader *current* interpretation
    # authority (Script Beat + current Shot evidence), still exact-text grounded.
    logic_authorities = _performance_logic_authorities(context)
    logic_items = out.get("performance_logic")
    if isinstance(logic_items, list):
        for item in logic_items:
            if not isinstance(item, dict):
                continue
            evidence, delta = _normalize_evidence(item.get("evidence_source"))
            if delta:
                item["evidence_source"] = evidence
                changes += delta
            if isinstance(item.get("evidence_source"), list):
                for ev in item["evidence_source"]:
                    if not isinstance(ev, dict) or not isinstance(ev.get("quote"), str):
                        continue
                    quote = ev.get("quote")
                    anchored = reanchor_quote_to_authorities(quote, logic_authorities)
                    if isinstance(anchored, str) and anchored and anchored != quote:
                        ev["quote"] = anchored
                        changes += 1

    # Empty v17 execution items are transport noise, not creative decisions.
    execution_items = out.get("performance_execution")
    if isinstance(execution_items, list):
        compact_execution = []
        for item in execution_items:
            if not isinstance(item, dict):
                compact_execution.append(item)
                continue
            ref = str(item.get("character_ref") or "")
            has_signal = any(str(item.get(field) or "").strip() for field in _VISIBLE_EXECUTION_FIELDS)
            if ref and not has_signal:
                changes += 1
                continue
            compact_execution.append(item)
        if compact_execution != execution_items:
            out["performance_execution"] = compact_execution

    # Stable ordering/deduping is mechanical; invalid refs are deliberately retained for repair.
    for key in ("primary_subject_refs", "reaction_target_refs"):
        value = out.get(key)
        if isinstance(value, list) and all(isinstance(x, str) for x in value):
            unique = _ordered_unique(value)
            if unique != value:
                out[key] = unique
                changes += 1

    # Director v10: state_out is program-owned. Ignore any legacy/model-provided copy.
    if "state_out" in out:
        out.pop("state_out", None)
        changes += 1

    normalized_delta, delta_changes = _normalize_prop_holding_aliases(out.get("action_delta"), context)
    if delta_changes:
        out["action_delta"] = normalized_delta
        changes += delta_changes

    derived_state_out = empty_state()
    try:
        scope = out.get("continuity_scope") or {}
        state_in = resolve_state_in(context.get("previous_state_out") or empty_state(), scope)
        if _state_map_shape_ok(out.get("action_delta")):
            derived_state_out = _apply_action_delta(state_in, out["action_delta"])
    except Exception:
        # Validation will report the actual continuity/state-shape error.
        pass
    # Character performance baseline is program-carried context state, not a
    # second Story Bible. Only grounded v17 logic may establish it; once present,
    # later Shots inherit it within the active narrative context unless grounded
    # evidence explicitly establishes a new baseline.
    baseline_in = (context.get("program_owned") or {}).get("performance_baseline_in")
    if not isinstance(baseline_in, dict):
        baseline_in = _performance_baseline_in(context)
    baseline_out = copy.deepcopy(baseline_in)
    for item in out.get("performance_logic") or []:
        if not isinstance(item, dict):
            continue
        renderable = _renderable_logic_fields(item, context)
        if not renderable:
            continue
        ref = str(item.get("character_ref") or "")
        if not ref:
            continue
        current = copy.deepcopy(baseline_out.get(ref) or {})
        base_emotion = str(renderable.get("base_emotion") or "").strip()
        behavior_tendency = str(renderable.get("behavior_tendency") or "").strip()
        if base_emotion and (not current.get("base_emotion") or base_emotion != current.get("base_emotion")):
            current["base_emotion"] = base_emotion
        if behavior_tendency and (not current.get("behavior_tendency") or behavior_tendency != current.get("behavior_tendency")):
            current["behavior_tendency"] = behavior_tendency
        if current:
            baseline_out[ref] = current
    for ref, baseline in baseline_out.items():
        if not isinstance(baseline, dict) or not baseline:
            continue
        derived_state_out.setdefault("characters", {}).setdefault(ref, {})["performance_baseline"] = copy.deepcopy(baseline)
    out["state_out"] = derived_state_out

    return out, changes


def _shape_errors(director: Any) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if not isinstance(director, dict):
        return [_err("shape_type_mismatch", "director must be JSON object", path="director")]

    for field in sorted(set(director) - DIRECTOR_CANONICAL_FIELDS):
        errors.append(_err("extra_director_field", f"unsupported director field: {field}", path=f"director.{field}"))
    for field in sorted(DIRECTOR_CANONICAL_FIELDS - set(director)):
        errors.append(_err("missing_director_field", f"missing director field: {field}", path=f"director.{field}"))

    if not isinstance(director.get("dramatic_intent"), str) or not director.get("dramatic_intent", "").strip():
        errors.append(_err("invalid_dramatic_intent", "dramatic_intent must be non-empty string", path="director.dramatic_intent"))
    for field in ("primary_subject_refs", "speaker_target_refs", "reaction_target_refs"):
        value = director.get(field)
        if not isinstance(value, list) or not all(isinstance(x, str) and x for x in value):
            errors.append(_err("shape_type_mismatch", f"{field} must be string array", path=f"director.{field}"))

    actions = director.get("performance_actions")
    if not isinstance(actions, list):
        errors.append(_err("shape_type_mismatch", "performance_actions must be array", path="director.performance_actions"))
    else:
        for i, action in enumerate(actions):
            p = f"director.performance_actions[{i}]"
            if not isinstance(action, dict):
                errors.append(_err("shape_type_mismatch", "performance_action must be object", path=p))
                continue
            for field in sorted(set(action) - PERFORMANCE_FIELDS):
                errors.append(_err("extra_director_field", f"unsupported performance field: {field}", path=f"{p}.{field}"))
            for field in sorted(PERFORMANCE_FIELDS - set(action)):
                errors.append(_err("missing_director_field", f"missing performance field: {field}", path=f"{p}.{field}"))
            if not isinstance(action.get("character_ref"), str) or not action.get("character_ref"):
                errors.append(_err("shape_type_mismatch", "character_ref must be non-empty string", path=f"{p}.character_ref"))
            if not isinstance(action.get("action"), str) or not action.get("action", "").strip():
                errors.append(_err("shape_type_mismatch", "action must be non-empty string", path=f"{p}.action"))
            if not isinstance(action.get("transformation_type"), str):
                errors.append(_err("shape_type_mismatch", "transformation_type must be string", path=f"{p}.transformation_type"))
            tags = action.get("dependency_tags")
            if not isinstance(tags, list) or not all(isinstance(x, str) and x for x in tags):
                errors.append(_err("shape_type_mismatch", "dependency_tags must be string array", path=f"{p}.dependency_tags"))
            evidence = action.get("source_evidence")
            if not isinstance(evidence, list):
                errors.append(_err("shape_type_mismatch", "source_evidence must be object array", path=f"{p}.source_evidence"))
            elif not evidence:
                errors.append(_err("director_missing_performance_evidence", "performance action requires at least one current-shot authority evidence item", path=f"{p}.source_evidence"))
            else:
                for j, item in enumerate(evidence):
                    ep = f"{p}.source_evidence[{j}]"
                    if not isinstance(item, dict):
                        errors.append(_err("shape_type_mismatch", "evidence must be object", path=ep))
                        continue
                    for field in sorted(set(item) - EVIDENCE_FIELDS):
                        errors.append(_err("extra_director_field", f"unsupported evidence field: {field}", path=f"{ep}.{field}"))
                    if not isinstance(item.get("quote"), str) or not item.get("quote", "").strip():
                        errors.append(_err("shape_type_mismatch", "evidence.quote must be non-empty string", path=f"{ep}.quote"))

    logic_items = director.get("performance_logic")
    if not isinstance(logic_items, list):
        errors.append(_err("shape_type_mismatch", "performance_logic must be array", path="director.performance_logic"))
    else:
        for i, item in enumerate(logic_items):
            p = f"director.performance_logic[{i}]"
            if not isinstance(item, dict):
                errors.append(_err("shape_type_mismatch", "performance_logic item must be object", path=p))
                continue
            for field in sorted(set(item) - PERFORMANCE_LOGIC_FIELDS):
                errors.append(_err("extra_director_field", f"unsupported performance_logic field: {field}", path=f"{p}.{field}"))
            if not isinstance(item.get("character_ref"), str) or not item.get("character_ref"):
                errors.append(_err("shape_type_mismatch", "performance_logic.character_ref must be non-empty string", path=f"{p}.character_ref"))
            for field in ("base_emotion", "emotion_delta", "trigger", "behavior_goal", "behavior_tendency"):
                if field in item and not isinstance(item.get(field), str):
                    errors.append(_err("shape_type_mismatch", f"{field} must be string when present", path=f"{p}.{field}"))
            evidence = item.get("evidence_source", [])
            if not isinstance(evidence, list):
                errors.append(_err("shape_type_mismatch", "performance_logic.evidence_source must be object array", path=f"{p}.evidence_source"))
            else:
                for j, ev in enumerate(evidence):
                    ep = f"{p}.evidence_source[{j}]"
                    if not isinstance(ev, dict):
                        errors.append(_err("shape_type_mismatch", "performance_logic evidence must be object", path=ep))
                        continue
                    for field in sorted(set(ev) - EVIDENCE_FIELDS):
                        errors.append(_err("extra_director_field", f"unsupported evidence field: {field}", path=f"{ep}.{field}"))
                    if not isinstance(ev.get("quote"), str) or not ev.get("quote", "").strip():
                        errors.append(_err("shape_type_mismatch", "performance_logic evidence.quote must be non-empty string", path=f"{ep}.quote"))

    execution_items = director.get("performance_execution")
    if not isinstance(execution_items, list):
        errors.append(_err("shape_type_mismatch", "performance_execution must be array", path="director.performance_execution"))
    else:
        for i, item in enumerate(execution_items):
            p = f"director.performance_execution[{i}]"
            if not isinstance(item, dict):
                errors.append(_err("shape_type_mismatch", "performance_execution item must be object", path=p))
                continue
            for field in sorted(set(item) - PERFORMANCE_EXECUTION_FIELDS):
                errors.append(_err("extra_director_field", f"unsupported performance_execution field: {field}", path=f"{p}.{field}"))
            if not isinstance(item.get("character_ref"), str) or not item.get("character_ref"):
                errors.append(_err("shape_type_mismatch", "performance_execution.character_ref must be non-empty string", path=f"{p}.character_ref"))
            for field in _VISIBLE_EXECUTION_FIELDS:
                if field in item and not isinstance(item.get(field), str):
                    errors.append(_err("shape_type_mismatch", f"performance_execution.{field} must be string when present", path=f"{p}.{field}"))

    delivery_items = director.get("dialogue_delivery")
    if not isinstance(delivery_items, list):
        errors.append(_err("shape_type_mismatch", "dialogue_delivery must be array", path="director.dialogue_delivery"))
    else:
        for i, item in enumerate(delivery_items):
            p = f"director.dialogue_delivery[{i}]"
            if not isinstance(item, dict):
                errors.append(_err("shape_type_mismatch", "dialogue_delivery item must be object", path=p))
                continue
            for field in sorted(set(item) - DIALOGUE_DELIVERY_FIELDS):
                errors.append(_err("extra_director_field", f"unsupported dialogue_delivery field: {field}", path=f"{p}.{field}"))
            for field in ("frozen_text_unit_id", "speaker_ref"):
                if not isinstance(item.get(field), str) or not item.get(field):
                    errors.append(_err("shape_type_mismatch", f"dialogue_delivery.{field} must be non-empty string", path=f"{p}.{field}"))
            for field in ("emotion", "volume", "pace", "pause", "delivery", "gaze_during_line"):
                if field in item and not isinstance(item.get(field), str):
                    errors.append(_err("shape_type_mismatch", f"dialogue_delivery.{field} must be string when present", path=f"{p}.{field}"))

    camera_execution = director.get("camera_execution")
    if not isinstance(camera_execution, dict):
        errors.append(_err("shape_type_mismatch", "camera_execution must be object", path="director.camera_execution"))
    else:
        for field in sorted(set(camera_execution) - CAMERA_EXECUTION_FIELDS):
            errors.append(_err("extra_director_field", f"unsupported camera_execution field: {field}", path=f"director.camera_execution.{field}"))
        for field in ("framing_type", "shot_size", "camera", "movement"):
            if not isinstance(camera_execution.get(field), str) or not camera_execution.get(field):
                errors.append(_err("shape_type_mismatch", f"camera_execution.{field} must be non-empty string", path=f"director.camera_execution.{field}"))
        refs = camera_execution.get("foreground_character_refs")
        if not isinstance(refs, list) or not all(isinstance(x, str) and x for x in refs):
            errors.append(_err("shape_type_mismatch", "camera_execution.foreground_character_refs must be string array", path="director.camera_execution.foreground_character_refs"))
        if "framing_note" in camera_execution and not isinstance(camera_execution.get("framing_note"), str):
            errors.append(_err("shape_type_mismatch", "camera_execution.framing_note must be string", path="director.camera_execution.framing_note"))

    purpose = director.get("shot_purpose")
    if not isinstance(purpose, str) or not purpose:
        errors.append(_err("shape_type_mismatch", "shot_purpose must be non-empty string", path="director.shot_purpose"))

    scene_position = director.get("scene_position")
    if not isinstance(scene_position, str) or not scene_position:
        errors.append(_err("shape_type_mismatch", "scene_position must be non-empty string", path="director.scene_position"))
    scene_context_usage = director.get("scene_context_usage")
    if not isinstance(scene_context_usage, list) or not all(isinstance(x, str) and x for x in scene_context_usage):
        errors.append(_err("shape_type_mismatch", "scene_context_usage must be string array", path="director.scene_context_usage"))

    framing = director.get("execution_framing")
    if not isinstance(framing, dict):
        errors.append(_err("shape_type_mismatch", "execution_framing must be object", path="director.execution_framing"))
    else:
        for field in sorted(set(framing) - EXECUTION_FRAMING_FIELDS):
            errors.append(_err("extra_director_field", f"unsupported execution_framing field: {field}", path=f"director.execution_framing.{field}"))
        for field in sorted(EXECUTION_FRAMING_FIELDS - set(framing)):
            errors.append(_err("missing_director_field", f"missing execution_framing field: {field}", path=f"director.execution_framing.{field}"))
        if not isinstance(framing.get("framing_type"), str):
            errors.append(_err("shape_type_mismatch", "framing_type must be string", path="director.execution_framing.framing_type"))
        refs = framing.get("foreground_character_refs")
        if not isinstance(refs, list) or not all(isinstance(x, str) and x for x in refs):
            errors.append(_err("shape_type_mismatch", "foreground_character_refs must be string array", path="director.execution_framing.foreground_character_refs"))

    target = director.get("visual_target")
    if not isinstance(target, dict):
        errors.append(_err("shape_type_mismatch", "visual_target must be object", path="director.visual_target"))
    else:
        for field in sorted(set(target) - VISUAL_TARGET_FIELDS):
            errors.append(_err("extra_director_field", f"unsupported visual_target field: {field}", path=f"director.visual_target.{field}"))
        for field in sorted(VISUAL_TARGET_FIELDS - set(target)):
            errors.append(_err("missing_director_field", f"missing visual_target field: {field}", path=f"director.visual_target.{field}"))
        if not isinstance(target.get("target_type"), str):
            errors.append(_err("shape_type_mismatch", "target_type must be string", path="director.visual_target.target_type"))
        for field in ("character_refs", "prop_refs", "environment_keys"):
            value = target.get(field)
            if not isinstance(value, list) or not all(isinstance(x, str) and x for x in value):
                errors.append(_err("shape_type_mismatch", f"{field} must be string array", path=f"director.visual_target.{field}"))

    design = director.get("execution_shot_design")
    if not isinstance(design, dict):
        errors.append(_err("shape_type_mismatch", "execution_shot_design must be object", path="director.execution_shot_design"))
    else:
        for field in sorted(set(design) - EXECUTION_DESIGN_FIELDS):
            errors.append(_err("extra_director_field", f"unsupported execution_shot_design field: {field}", path=f"director.execution_shot_design.{field}"))
        for field in sorted(EXECUTION_DESIGN_FIELDS - set(design)):
            errors.append(_err("missing_director_field", f"missing execution_shot_design field: {field}", path=f"director.execution_shot_design.{field}"))
        for field in EXECUTION_DESIGN_FIELDS:
            if not isinstance(design.get(field), str) or not design.get(field):
                errors.append(_err("shape_type_mismatch", f"execution_shot_design.{field} must be non-empty string", path=f"director.execution_shot_design.{field}"))

    focus = director.get("visual_focus")
    if not isinstance(focus, dict):
        errors.append(_err("shape_type_mismatch", "visual_focus must be object", path="director.visual_focus"))
    else:
        for field in sorted(set(focus) - FOCUS_FIELDS):
            errors.append(_err("extra_director_field", f"unsupported visual_focus field: {field}", path=f"director.visual_focus.{field}"))
        for field in sorted(FOCUS_FIELDS - set(focus)):
            errors.append(_err("missing_director_field", f"missing visual_focus field: {field}", path=f"director.visual_focus.{field}"))
        if not isinstance(focus.get("focus_type"), str):
            errors.append(_err("shape_type_mismatch", "focus_type must be string", path="director.visual_focus.focus_type"))
        for field in ("subject_refs", "prop_refs", "environment_keys"):
            v = focus.get(field)
            if not isinstance(v, list) or not all(isinstance(x, str) and x for x in v):
                errors.append(_err("shape_type_mismatch", f"{field} must be string array", path=f"director.visual_focus.{field}"))
        br = focus.get("body_regions")
        if not isinstance(br, dict):
            errors.append(_err("shape_type_mismatch", "body_regions must be object", path="director.visual_focus.body_regions"))
        else:
            for ref, regions in br.items():
                if not isinstance(ref, str) or not ref or not isinstance(regions, list) or not all(isinstance(x, str) and x for x in regions):
                    errors.append(_err("shape_type_mismatch", "body_regions values must be string arrays", path=f"director.visual_focus.body_regions.{ref}"))

    for state_name in ("action_delta", "state_out"):
        state = director.get(state_name)
        if not isinstance(state, dict):
            errors.append(_err("shape_type_mismatch", f"{state_name} must be object", path=f"director.{state_name}"))
            continue
        extra = set(state) - STATE_FIELDS
        missing = STATE_FIELDS - set(state)
        for field in sorted(extra):
            errors.append(_err("extra_director_field", f"unsupported {state_name} section: {field}", path=f"director.{state_name}.{field}"))
        for field in sorted(missing):
            errors.append(_err("missing_director_field", f"missing {state_name} section: {field}", path=f"director.{state_name}.{field}"))
        for section in STATE_FIELDS:
            if section in state and not isinstance(state.get(section), dict):
                errors.append(_err("shape_type_mismatch", f"{state_name}.{section} must be object", path=f"director.{state_name}.{section}"))
            if section in {"characters", "props"} and isinstance(state.get(section), dict):
                for ref, fields in state[section].items():
                    if not isinstance(ref, str) or not ref or not isinstance(fields, dict):
                        errors.append(_err("shape_type_mismatch", f"{state_name}.{section}.{ref} must be object", path=f"director.{state_name}.{section}.{ref}"))

    scope = director.get("continuity_scope")
    if not isinstance(scope, dict):
        errors.append(_err("shape_type_mismatch", "continuity_scope must be object", path="director.continuity_scope"))
    else:
        for field in sorted(set(scope) - SCOPE_FIELDS):
            errors.append(_err("extra_director_field", f"unsupported continuity_scope field: {field}", path=f"director.continuity_scope.{field}"))
        if "mode" not in scope:
            errors.append(_err("missing_director_field", "continuity_scope.mode required", path="director.continuity_scope.mode"))
        if scope.get("mode") == "partial":
            inherit = scope.get("inherit")
            if not isinstance(inherit, dict):
                errors.append(_err("shape_type_mismatch", "partial continuity requires inherit object", path="director.continuity_scope.inherit"))
            else:
                for field in sorted(set(inherit) - INHERIT_FIELDS):
                    errors.append(_err("extra_director_field", f"unsupported inherit field: {field}", path=f"director.continuity_scope.inherit.{field}"))
                for field in sorted(INHERIT_FIELDS - set(inherit)):
                    errors.append(_err("missing_director_field", f"missing inherit field: {field}", path=f"director.continuity_scope.inherit.{field}"))
                for section in ("characters", "props"):
                    data = inherit.get(section)
                    if not isinstance(data, dict):
                        errors.append(_err("shape_type_mismatch", f"inherit.{section} must be object", path=f"director.continuity_scope.inherit.{section}"))
                    else:
                        for ref, fields in data.items():
                            if not isinstance(fields, list) or not fields or not all(isinstance(x, str) and x for x in fields):
                                errors.append(_err("shape_type_mismatch", f"inherit.{section}.{ref} must be non-empty string array", path=f"director.continuity_scope.inherit.{section}.{ref}"))
                env = inherit.get("environment")
                if not isinstance(env, list) or not all(isinstance(x, str) and x for x in env):
                    errors.append(_err("shape_type_mismatch", "inherit.environment must be string array", path="director.continuity_scope.inherit.environment"))
        elif "inherit" in scope:
            errors.append(_err("extra_director_field", "inherit is allowed only for partial continuity", path="director.continuity_scope.inherit"))
    return errors


def _collect_current_shot_action_evidence(context: dict[str, Any]) -> list[str]:
    """Director evidence comes only from approved Production Semantics + frozen dialogue."""
    texts: list[str] = []

    def add(value: Any) -> None:
        if isinstance(value, str) and value.strip() and value.strip() not in texts:
            texts.append(value.strip())

    semantics = context.get("production_semantics") or {}
    for group in ("visual_events", "production_choices"):
        for item in semantics.get(group) or []:
            if not isinstance(item, dict):
                continue
            for evidence in item.get("source_evidence") or []:
                if isinstance(evidence, dict):
                    add(evidence.get("quote"))
    for item in semantics.get("dialogue") or []:
        if isinstance(item, dict):
            add(item.get("line"))
    return texts


def _collect_reaction_performance_evidence_by_character(context: dict[str, Any]) -> dict[str, list[str]]:
    """Return only evidence that is uniquely attributable to one current-shot character.

    This map is diagnostic/contextual only.  reaction_target_refs are camera/visual
    choices and never require a performance_action.  Keeping this attribution strict
    prevents a multi-character semantic event from lending one character's quoted
    action to every other visible character.
    """
    out: dict[str, list[str]] = {}
    semantics = context.get("production_semantics") or {}
    assets = context.get("assets") if isinstance(context.get("assets"), dict) else {}
    chars = assets.get("characters") if isinstance(assets.get("characters"), dict) else {}

    def add(ref: Any, quote: Any) -> None:
        if not isinstance(ref, str) or not ref or not isinstance(quote, str) or not quote.strip():
            return
        bucket = out.setdefault(ref, [])
        text = quote.strip()
        if text not in bucket:
            bucket.append(text)

    for group in ("visual_events", "production_choices"):
        for item in semantics.get(group) or []:
            if not isinstance(item, dict):
                continue
            refs = item.get("character_refs") or item.get("affected_character_refs") or item.get("subject_refs") or []
            refs = [ref for ref in refs if isinstance(ref, str) and ref]
            if not refs:
                continue

            owner_refs = list(dict.fromkeys(refs))
            if len(owner_refs) > 1:
                names = {
                    ref: str((chars.get(ref) or {}).get("canonical_name") or "").strip()
                    for ref in owner_refs
                    if isinstance(chars.get(ref), dict)
                }
                semantic_text = str(item.get("action") or item.get("choice") or "").strip()
                explicit = _explicit_canonical_subject_refs(semantic_text, names) if semantic_text else []
                if len(explicit) == 1 and explicit[0] in owner_refs:
                    owner_refs = explicit

            for evidence in item.get("source_evidence") or []:
                quote = evidence.get("quote") if isinstance(evidence, dict) else None
                if not isinstance(quote, str) or not quote.strip():
                    continue
                resolved = list(owner_refs)
                if len(resolved) > 1:
                    names = {
                        ref: str((chars.get(ref) or {}).get("canonical_name") or "").strip()
                        for ref in resolved
                        if isinstance(chars.get(ref), dict)
                    }
                    explicit = _explicit_canonical_subject_refs(quote, names)
                    if len(explicit) == 1 and explicit[0] in resolved:
                        resolved = explicit
                if len(resolved) == 1:
                    add(resolved[0], quote)
    return out

def _collect_environment_focus_authority(context: dict[str, Any]) -> list[str]:
    """Collect only upstream visual/environment text that Director may emphasize.

    Environment focus is not a creative slot: it may select/emphasize an existing
    scene/shot detail, but it may not create a new set dressing fact.
    """
    texts: list[str] = []

    def add(value: Any) -> None:
        if isinstance(value, str) and value.strip() and value.strip() not in texts:
            texts.append(value.strip())
        elif isinstance(value, list):
            for item in value:
                add(item)
        elif isinstance(value, dict):
            for item in value.values():
                add(item)

    shot = context.get("shot") or {}
    add(shot.get("description"))
    for evidence in shot.get("source_evidence") or []:
        if isinstance(evidence, dict):
            add(evidence.get("quote"))

    scene_asset = ((context.get("assets") or {}).get("scene") or {})
    add(scene_asset.get("explicit_facts"))
    add(scene_asset.get("visual_lock"))

    semantics = context.get("production_semantics") or {}
    for event in semantics.get("visual_events") or []:
        if isinstance(event, dict):
            add(event.get("action"))
            add(event.get("source_evidence"))
    for choice in semantics.get("production_choices") or []:
        if isinstance(choice, dict):
            add(choice.get("choice"))
            add(choice.get("source_evidence"))
    return texts


def _environment_focus_is_anchored(value: str, authority: list[str]) -> bool:
    key = _norm_semantic_text(value)
    if not key:
        return False
    for source in authority:
        normalized = _norm_semantic_text(source)
        if normalized and (key in normalized or normalized in key):
            return True
    return False



_SPEECH_VERBS = ("询问", "回答", "回应", "告诉", "表示", "说明", "解释", "讲述", "提到", "说出", "问", "说")
_SPEECH_CUE_PREFIX_RE = re.compile(r"^(?:开口|低声|轻声|小声|停顿后|犹豫片刻后|抬眼后|低头后|看向[^，。；]{0,12}后)?")
_EVIDENCE_SPEECH_WRAPPERS = (
    "问", "询问", "说", "说道", "开口", "开口说", "回答", "回应",
    "低声说", "轻声说", "小声说", "低声问", "轻声问", "小声问",
)


def _norm_semantic_text(value: Any) -> str:
    return re.sub(r"[\s\u3000，。！？；：、“”‘’（）()\[\]{}<>《》,.!?;:'\"`~_-]+", "", str(value or ""))


def _speech_action_restates_dialogue(action_text: str, dialogue_lines: list[str]) -> bool:
    action = str(action_text or "").strip()
    if not action or not dialogue_lines:
        return False
    normalized_lines = [_norm_semantic_text(x) for x in dialogue_lines if _norm_semantic_text(x)]
    if not normalized_lines:
        return False
    for verb in _SPEECH_VERBS:
        pos = action.find(verb)
        if pos < 0:
            continue
        tail = action[pos + len(verb):].strip("，,；;：: 。")
        if not tail:
            continue
        tail_norm = _norm_semantic_text(tail)
        if not tail_norm:
            continue
        for line in normalized_lines:
            if tail_norm in line or line in tail_norm:
                return True
            if min(len(tail_norm), len(line)) >= 2 and SequenceMatcher(None, tail_norm, line).ratio() >= 0.62:
                return True
    return False


def _dialogue_lines_by_character(context: dict[str, Any]) -> dict[str, list[str]]:
    """Return frozen current-shot dialogue grouped by stable character ref."""
    out: dict[str, list[str]] = {}

    def add(ref: Any, line: Any) -> None:
        if not isinstance(ref, str) or not ref or not isinstance(line, str) or not line.strip():
            return
        bucket = out.setdefault(ref, [])
        value = line.strip()
        if value not in bucket:
            bucket.append(value)

    semantics = context.get("production_semantics") or {}
    for item in semantics.get("dialogue") or []:
        if isinstance(item, dict):
            add(item.get("character_id") or item.get("character_ref"), item.get("line") or item.get("text"))
    shot = context.get("shot") or {}
    for item in shot.get("dialogue") or []:
        if isinstance(item, dict):
            add(item.get("character_id") or item.get("character_ref"), item.get("line") or item.get("text"))
    return out


def _reanchor_director_performance_quote(
    quote: Any,
    authorities: list[str],
    action: dict[str, Any],
    context: dict[str, Any],
) -> str | None:
    """Re-anchor only high-confidence representation drift in Director evidence.

    Generic exact / punctuation-only drift is handled first.  One additional safe
    Director case is allowed: the model may wrap an exact frozen dialogue line as
    ``<canonical speaker name><speech verb><dialogue>`` (for example a prose-like
    evidence summary).  If and only if the declared action owner, canonical name,
    and one current-shot frozen dialogue line uniquely agree, drop the unsupported
    wrapper and return the exact authoritative dialogue string.

    This is not fuzzy evidence repair: no alias, pronoun, paraphrase, or semantic
    matching is performed.
    """
    anchored = reanchor_quote_to_authorities(quote, authorities)
    if anchored is not None:
        return anchored
    if not isinstance(quote, str) or not quote.strip() or not isinstance(action, dict):
        return None

    owner_ref = str(action.get("character_ref") or "")
    if not owner_ref:
        return None
    assets = context.get("assets") if isinstance(context.get("assets"), dict) else {}
    characters = assets.get("characters") if isinstance(assets.get("characters"), dict) else {}
    owner_asset = characters.get(owner_ref) if isinstance(characters.get(owner_ref), dict) else {}
    owner_name = str(owner_asset.get("canonical_name") or "").strip()
    if not owner_name:
        return None

    dialogue_by_ref = _dialogue_lines_by_character(context)
    owner_lines = dialogue_by_ref.get(owner_ref) or []
    if not owner_lines:
        return None

    authority_by_norm: dict[str, list[str]] = {}
    for authority in authorities:
        if not isinstance(authority, str) or not authority.strip():
            continue
        authority_by_norm.setdefault(_norm_semantic_text(authority), []).append(authority)

    quote_norm = _norm_semantic_text(quote)
    candidates: list[str] = []
    for line in owner_lines:
        line_norm = _norm_semantic_text(line)
        if not line_norm or not quote_norm.endswith(line_norm):
            continue
        exact_authorities = authority_by_norm.get(line_norm) or []
        if len(exact_authorities) != 1:
            continue
        prefix = quote_norm[:-len(line_norm)]
        allowed_prefixes = {
            _norm_semantic_text(f"{owner_name}{wrapper}")
            for wrapper in _EVIDENCE_SPEECH_WRAPPERS
        }
        if prefix not in allowed_prefixes:
            continue
        authority = exact_authorities[0]
        if authority not in candidates:
            candidates.append(authority)
    return candidates[0] if len(candidates) == 1 else None


def _state_fields(state: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for section in ("characters", "props"):
        for ref, fields in ((state or {}).get(section, {}) or {}).items():
            if isinstance(fields, dict):
                for field, value in fields.items():
                    out[f"{section}.{ref}.{field}"] = value
    for field, value in ((state or {}).get("environment", {}) or {}).items():
        out[f"environment.{field}"] = value
    return out


def _phase_e_errors(state_in: dict[str, Any], delta: dict[str, Any], state_out: dict[str, Any]) -> list[dict[str, Any]]:
    # Director v10: state_out is program-derived, so cross-copy consistency errors cannot occur.
    # Only reject no-op deltas; semantic validity remains model/validator responsibility.
    errors: list[dict[str, Any]] = []
    before = _state_fields(state_in)
    changes = _state_fields(delta)
    stale = [
        path for path, value in changes.items()
        if (path in before and before[path] == value) or (value is None and path not in before)
    ]
    if stale:
        errors.append(_err("stale_action_delta", "action_delta repeats or clears an unchanged/missing state_in field(s): " + ", ".join(stale)))
    return errors


def _state_policy_errors(delta: dict[str, Any], context: dict[str, Any]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if not _state_map_shape_ok(delta):
        return errors
    allowed_chars = set(((context.get("program_owned") or {}).get("allowed_character_refs") or []))
    allowed_props = set(((context.get("program_owned") or {}).get("allowed_prop_refs") or []))
    for char_ref, fields in (delta.get("characters") or {}).items():
        if char_ref not in allowed_chars:
            errors.append(_err("invalid_action_delta_character_ref", f"{char_ref} is not in shot.character_refs"))
        if not isinstance(fields, dict):
            continue
        for field in fields:
            normalized_field = str(field).strip().lower()
            if field not in PERSISTENT_CHARACTER_STATE_FIELDS and field not in CHARACTER_PROP_HOLDING_ALIASES:
                errors.append(_err(
                    "unsupported_persistent_character_state",
                    f"{field} is not in the persistent character-state whitelist.",
                    path=f"director.action_delta.characters.{char_ref}.{field}",
                ))
            if field in STATIC_ASSET_STATE_KEYS:
                errors.append(_err(
                    "static_asset_in_action_delta",
                    f"{field} is a static asset field and cannot be changed through Director action_delta.",
                    path=f"director.action_delta.characters.{char_ref}.{field}",
                ))
            if normalized_field in NON_PERSISTENT_SEMANTIC_STATE_KEYS:
                errors.append(_err(
                    "nonpersistent_semantic_state",
                    f"{field} is psychological/relational semantics and cannot persist through action_delta.",
                    path=f"director.action_delta.characters.{char_ref}.{field}",
                ))
            if field in TRANSIENT_CHARACTER_STATE_FIELDS:
                errors.append(_err(
                    "transient_state_in_action_delta",
                    f"{field} is a shot-local event and must not be persisted in action_delta; use dialogue/performance_actions instead.",
                    path=f"director.action_delta.characters.{char_ref}.{field}",
                ))
            if field in CHARACTER_PROP_HOLDING_ALIASES:
                errors.append(_err(
                    "noncanonical_prop_holding_state",
                    f"character-side {field} is not canonical; express holding as props.<prop_ref>.held_by.",
                    path=f"director.action_delta.characters.{char_ref}.{field}",
                ))
    for field in (delta.get("environment") or {}):
        if field not in PERSISTENT_ENVIRONMENT_STATE_FIELDS:
            errors.append(_err(
                "unsupported_persistent_environment_state",
                f"environment.{field} is not in the persistent environment-state whitelist.",
                path=f"director.action_delta.environment.{field}",
            ))
        if field in STATIC_ASSET_STATE_KEYS:
            errors.append(_err(
                "static_asset_in_action_delta",
                f"environment.{field} is a locked static asset and cannot be changed through Director action_delta.",
                path=f"director.action_delta.environment.{field}",
            ))
    for prop_ref, fields in (delta.get("props") or {}).items():
        if prop_ref not in allowed_props:
            errors.append(_err("invalid_action_delta_prop_ref", f"{prop_ref} is not in shot.prop_refs"))
        if not isinstance(fields, dict):
            continue
        for field in fields:
            if field not in PERSISTENT_PROP_STATE_FIELDS:
                errors.append(_err(
                    "unsupported_persistent_prop_state",
                    f"props.{prop_ref}.{field} is not in the persistent prop-state whitelist.",
                    path=f"director.action_delta.props.{prop_ref}.{field}",
                ))
        if "held_by" in fields:
            holder = fields.get("held_by")
            if holder is not None and holder not in allowed_chars:
                errors.append(_err(
                    "invalid_prop_holder_ref",
                    f"props.{prop_ref}.held_by must be null or a current shot character_ref; got {holder}",
                    path=f"director.action_delta.props.{prop_ref}.held_by",
                ))
    return errors


def _allowed_partial_inherit_fields(previous_state_out: dict[str, Any]) -> dict[str, Any]:
    previous = previous_state_out if isinstance(previous_state_out, dict) else {}
    out: dict[str, Any] = {"characters": {}, "props": {}, "environment": []}
    for section in ("characters", "props"):
        source = previous.get(section) if isinstance(previous.get(section), dict) else {}
        for ref, fields in source.items():
            if isinstance(ref, str) and ref and isinstance(fields, dict) and fields:
                # performance_baseline is program-carried Director v17 context state,
                # not a model-selectable physical continuity field.
                names = sorted(
                    str(name) for name in fields
                    if isinstance(name, str) and name and name != "performance_baseline"
                )
                if names:
                    out[section][ref] = names
    env = previous.get("environment") if isinstance(previous.get("environment"), dict) else {}
    out["environment"] = sorted(str(name) for name in env if isinstance(name, str) and name)
    return out


def _partial_continuity_errors(scope: dict[str, Any], previous_state_out: dict[str, Any]) -> list[dict[str, Any]]:
    if scope.get("mode") != "partial":
        return []
    inherit = scope.get("inherit") or {}
    allowed = _allowed_partial_inherit_fields(previous_state_out)
    errors: list[dict[str, Any]] = []

    for section, ref_type in (("characters", "character"), ("props", "prop")):
        for ref, fields in (inherit.get(section) or {}).items():
            allowed_fields = allowed[section].get(ref)
            if allowed_fields is None:
                errors.append(_err(
                    f"invalid_continuity_{ref_type}_ref",
                    f"{ref} has no inheritable state in previous_state_out",
                    path=f"director.continuity_scope.inherit.{section}.{ref}",
                ))
                continue
            for index, field in enumerate(fields):
                if field not in allowed_fields:
                    errors.append(_err(
                        f"invalid_continuity_{ref_type}_field",
                        f"{ref}.{field} is not present in previous_state_out",
                        path=f"director.continuity_scope.inherit.{section}.{ref}[{index}]",
                    ))

    for index, field in enumerate(inherit.get("environment") or []):
        if field not in allowed["environment"]:
            errors.append(_err(
                "invalid_continuity_environment_field",
                f"environment.{field} is not present in previous_state_out",
                path=f"director.continuity_scope.inherit.environment[{index}]",
            ))
    return errors


def _partial_scope_example(allowed: dict[str, Any]) -> dict[str, Any]:
    example = {"mode": "partial", "inherit": {"characters": {}, "props": {}, "environment": []}}
    for section in ("characters", "props"):
        refs = allowed.get(section) or {}
        if refs:
            ref = sorted(refs)[0]
            fields = refs[ref]
            if fields:
                example["inherit"][section][ref] = [fields[0]]
    environment = allowed.get("environment") or []
    if environment:
        example["inherit"]["environment"] = [environment[0]]
    return example


def _annotate_director_repair_errors(
    errors: list[dict[str, Any]],
    context: dict[str, Any],
) -> list[dict[str, Any]]:
    """Attach executable Director-specific repair authority to structural errors."""
    anchors = (context.get("program_owned") or {}).get("current_shot_action_evidence") or _collect_current_shot_action_evidence(context)
    legal_evidence = [text for text in anchors if isinstance(text, str) and text.strip()]
    for error in errors:
        if not isinstance(error, dict) or error.get("type") not in {
            "director_missing_performance_evidence",
            "unanchored_performance_evidence",
        }:
            continue
        path = str(error.get("path") or "")
        match = re.match(r"director\.performance_actions\[(\d+)\]\.source_evidence$", path)
        if match:
            action_index = match.group(1)
            error["target_path"] = f"director.performance_actions[{action_index}]"
            if error.get("type") == "unanchored_performance_evidence":
                action_path = f"director.performance_actions[{action_index}].action"
                error["repair_targets"] = [path, action_path]
                error["must_change_any_of_paths"] = [path]
        error["available_current_shot_action_evidence"] = copy.deepcopy(legal_evidence)
        if error.get("type") == "director_missing_performance_evidence":
            error["repair_action"] = (
                "Attach the smallest exact quote from available_current_shot_action_evidence that supports this action; "
                "if none supports it, delete this performance_action and remove only dependencies created solely by it."
            )
        else:
            error["repair_action"] = (
                "Replace the invalid source_evidence with the smallest exact quote from "
                "available_current_shot_action_evidence that supports the same action, and shrink only the action wording "
                "if needed to stay inside that evidence; if no current-shot authority supports the event, delete this "
                "performance_action and only dependencies created solely by it."
            )
    return errors



def stabilize_director_contract_conflicts(
    director: Any,
    errors: list[dict[str, Any]],
    context: dict[str, Any],
) -> tuple[Any, int, list[str]]:
    """Deterministically close Director contradictions that require no creative choice.

    This is deliberately narrower than model Repair. It may only enforce relations
    already fixed by the current Director output plus current-shot authority:
    - wide/extreme-wide cannot retain precision body-region focus;
    - a reaction target either receives an evidence-anchored visible action or is
      removed when no same-character evidence exists;
    - a retained reaction purpose uses a readable reaction scale.

    It never invents plot facts, dialogue, emotion labels, new refs, or new evidence.
    """
    if not isinstance(director, dict) or not isinstance(errors, list):
        return director, 0, []

    out = copy.deepcopy(director)
    changes = 0
    applied: list[str] = []
    program = context.get("program_owned") or {}
    allowed_chars = set(program.get("allowed_character_refs") or [])
    reaction_evidence_map = program.get("reaction_performance_evidence_by_character") or _collect_reaction_performance_evidence_by_character(context)
    allowed_props = set(program.get("allowed_prop_refs") or [])

    # 0) primary_subject_refs is character-only. If the model placed a ref here that
    # is already a valid current-shot prop, removing it is deterministic and preserves
    # the prop's proper visual_target / visual_focus ownership. Unknown refs remain hard
    # errors and are never silently dropped.
    invalid_primary_prop_refs = {
        str(error.get("invalid_ref") or "")
        for error in errors
        if isinstance(error, dict)
        and error.get("type") == "invalid_primary_subject_ref"
        and str(error.get("invalid_ref") or "") in allowed_props
    }
    if invalid_primary_prop_refs:
        primary_refs = list(out.get("primary_subject_refs") or [])
        cleaned_primary_refs = [ref for ref in primary_refs if ref not in invalid_primary_prop_refs]
        if cleaned_primary_refs != primary_refs:
            out["primary_subject_refs"] = cleaned_primary_refs
            changes += 1
            for ref in sorted(invalid_primary_prop_refs):
                applied.append(f"prop_removed_from_primary_subject_refs:{ref}")

    # 0b) Subject ownership corrections that are mechanically determined by the
    # current Director text plus exact source evidence.  character_ref is the sole
    # owner field; when evidence admits multiple candidates, subject prose is reduced
    # to a predicate instead of asking a Repair call to resolve an unresolvable pronoun.
    for error in errors:
        if not isinstance(error, dict) or error.get("type") != "director_performance_subject_mismatch":
            continue
        path = str(error.get("path") or "")
        match = re.match(r"director\.performance_actions\[(\d+)\]\.action$", path)
        if not match:
            continue
        index = int(match.group(1))
        actions = out.get("performance_actions") if isinstance(out.get("performance_actions"), list) else []
        if index < 0 or index >= len(actions) or not isinstance(actions[index], dict):
            continue
        item = actions[index]
        repair_action = str(error.get("repair_action") or "")
        if repair_action == "rebind_character_ref_to_evidence_subject":
            target_ref = str(error.get("evidence_subject_ref") or "")
            if target_ref and target_ref in allowed_chars and item.get("character_ref") != target_ref:
                item["character_ref"] = target_ref
                changes += 1
                applied.append(f"performance_subject_rebound_to_evidence:{index}:{target_ref}")
            continue
        if repair_action == "collapse_canonical_name_plus_pronoun":
            canonical_name = str(error.get("conflicting_canonical_name") or "")
            action_text = str(item.get("action") or "")
            if canonical_name:
                collapsed = re.sub(
                    rf"^({re.escape(canonical_name)})[\s，,:：]*(?:他|她|它|其)(?={_SUBJECT_ACTION_VERB_RE.pattern})",
                    r"\1",
                    action_text,
                    count=1,
                )
                if collapsed != action_text:
                    item["action"] = collapsed
                    changes += 1
                    applied.append(f"performance_subject_pronoun_collapsed:{index}")
            continue
        if repair_action == "strip_redundant_action_subject_prefix":
            action_text = str(item.get("action") or "")
            normalized = _strip_canonical_subject_prefix(action_text, names={
                ref: str((context.get("assets") or {}).get("characters", {}).get(ref, {}).get("canonical_name") or "").strip()
                for ref in allowed_chars
                if isinstance((context.get("assets") or {}).get("characters", {}).get(ref), dict)
            })
            if normalized != action_text:
                item["action"] = normalized
                changes += 1
                applied.append(f"performance_subject_prefix_stripped:{index}")
            continue

    # 1) Resolve shot-size / precision-focus contradictions without asking the model
    # to rediscover an already deterministic constraint.
    for error in errors:
        if not isinstance(error, dict) or error.get("type") != "director_shot_size_focus_conflict":
            continue
        design = out.get("execution_shot_design") if isinstance(out.get("execution_shot_design"), dict) else {}
        focus = out.get("visual_focus") if isinstance(out.get("visual_focus"), dict) else {}
        target = out.get("visual_target") if isinstance(out.get("visual_target"), dict) else {}
        action = str(error.get("repair_action") or "")

        if action == "change_shot_size_keep_precision_focus":
            allowed = [x for x in (error.get("allowed_repair_values") or []) if x in SHOT_SIZE_MAP]
            if allowed:
                replacement = allowed[0]
                if design.get("shot_size") != replacement:
                    design["shot_size"] = replacement
                    out["execution_shot_design"] = design
                    changes += 1
                    applied.append("shot_size_for_precision_focus")
            continue

        if action != "preserve_wide_and_relax_precision_focus":
            continue

        body_regions = focus.get("body_regions") if isinstance(focus.get("body_regions"), dict) else {}
        cleaned: dict[str, list[str]] = {}
        for ref, regions in body_regions.items():
            if not isinstance(regions, list):
                continue
            kept = [region for region in regions if region not in PRECISION_BODY_REGIONS]
            if kept:
                cleaned[ref] = kept
        if cleaned != body_regions:
            focus["body_regions"] = cleaned
            changes += 1

        if focus.get("focus_type") == "body_region" and not cleaned:
            target_type = str(target.get("target_type") or "character")
            if target_type in {"character", "reaction"}:
                focus["focus_type"] = "character"
                refs = [ref for ref in (target.get("character_refs") or focus.get("subject_refs") or []) if ref in allowed_chars]
                focus["subject_refs"] = _ordered_unique(refs)
                focus["prop_refs"] = []
                focus["environment_keys"] = []
            elif target_type == "prop":
                focus["focus_type"] = "prop"
                focus["subject_refs"] = []
                focus["prop_refs"] = list(target.get("prop_refs") or [])
                focus["environment_keys"] = []
            elif target_type == "environment":
                focus["focus_type"] = "environment"
                focus["subject_refs"] = []
                focus["prop_refs"] = []
                focus["environment_keys"] = list(target.get("environment_keys") or [])
            else:
                focus["focus_type"] = "spatial_relation"
                focus["subject_refs"] = [ref for ref in (target.get("character_refs") or []) if ref in allowed_chars]
                focus["prop_refs"] = list(target.get("prop_refs") or [])
                focus["environment_keys"] = list(target.get("environment_keys") or [])
            changes += 1
        out["visual_focus"] = focus
        if "establish_space_focus_relaxed" not in applied:
            applied.append("establish_space_focus_relaxed")

    # 2) Legacy reaction_target_without_performance errors are obsolete in Runtime
    # v17.9+.  A reaction target is a visual target, not an objective action claim.
    # Never synthesize or delete performance_actions merely to satisfy an old
    # reaction/performance coupling.  Fresh validation will simply omit this error.

    if out.get("shot_purpose") == "reaction" and out.get("reaction_target_refs"):
        design = out.get("execution_shot_design") if isinstance(out.get("execution_shot_design"), dict) else {}
        if design.get("shot_size") not in {"medium_close", "close", "extreme_close"}:
            design["shot_size"] = "medium_close"
            out["execution_shot_design"] = design
            changes += 1
            applied.append("reaction_readable_scale")

    # v17 camera_execution is the grouped camera authority. Deterministic
    # stabilizers above intentionally operate on the legacy execution fields
    # because all existing contract checks target those precise paths. Mirror the
    # stabilized result back into camera_execution before recanonicalization so
    # canonicalization cannot restore the invalid pre-stabilization camera values.
    camera_execution = out.get("camera_execution") if isinstance(out.get("camera_execution"), dict) else None
    if camera_execution is not None:
        design = out.get("execution_shot_design") if isinstance(out.get("execution_shot_design"), dict) else {}
        framing = out.get("execution_framing") if isinstance(out.get("execution_framing"), dict) else {}
        synced = copy.deepcopy(camera_execution)
        for key in ("shot_size", "camera", "movement"):
            value = str(design.get(key) or "")
            if value and synced.get(key) != value:
                synced[key] = value
        framing_type = str(framing.get("framing_type") or "")
        if framing_type and synced.get("framing_type") != framing_type:
            synced["framing_type"] = framing_type
        foreground = list(framing.get("foreground_character_refs") or [])
        if synced.get("foreground_character_refs") != foreground:
            synced["foreground_character_refs"] = foreground
        if synced != camera_execution:
            out["camera_execution"] = synced
            changes += 1
            applied.append("camera_execution_synced_after_stabilization")

    return out, changes, applied



def _v17_director_quality_errors(director: dict[str, Any], context: dict[str, Any]) -> list[dict[str, Any]]:
    """v17 quality/ownership checks.

    Hard errors protect type ownership and camera purity. Interpretation density,
    grounding quality and transition completeness stay soft during the learning
    cycle so they cannot consume the single semantic Repair budget alone.
    """
    errors: list[dict[str, Any]] = []
    program = context.get("program_owned") if isinstance(context.get("program_owned"), dict) else {}
    allowed_chars = set(program.get("allowed_character_refs") or [])

    # performance_logic may interpret only current authority. Ungrounded logic is
    # retained for debug/audit but Compiler must not render it.
    for index, item in enumerate(director.get("performance_logic") or []):
        if not isinstance(item, dict):
            continue
        ref = str(item.get("character_ref") or "")
        if ref not in allowed_chars:
            errors.append(_err(
                "director_invalid_performance_logic_character_ref",
                f"performance_logic character_ref is not visible in current Shot: {ref}",
                path=f"director.performance_logic[{index}].character_ref",
            ))
            continue
        nonempty_logic = any(str(item.get(field) or "").strip() for field in (
            "base_emotion", "emotion_delta", "trigger", "behavior_goal", "behavior_tendency"
        ))
        if nonempty_logic and not _logic_item_grounded(item, context):
            warning = _err(
                "director_performance_logic_ungrounded",
                "performance logic lacks exact current authority evidence; keep for debug only and do not render it into the final Prompt",
                path=f"director.performance_logic[{index}].evidence_source",
            )
            warning["code"] = "W012_PERFORMANCE_TOO_ABSTRACT"
            errors.append(warning)
        elif nonempty_logic:
            authorities = _performance_logic_authorities(context)
            unsupported = unsupported_story_claim_terms(item, authorities)
            unsupported_fields = unsupported_logic_fields(item, authorities)
            if unsupported_fields:
                warning = _err(
                    "director_performance_logic_unsupported_inference",
                    "performance logic contains fields that are not authorized by current evidence; unsupported fields stay debug-only and cannot seed baseline or final Prompt",
                    path=f"director.performance_logic[{index}]",
                )
                warning["code"] = "W012_PERFORMANCE_TOO_ABSTRACT"
                warning["unsupported_terms"] = unsupported
                warning["unsupported_fields"] = unsupported_fields
                errors.append(warning)

    for index, item in enumerate(director.get("performance_execution") or []):
        if not isinstance(item, dict):
            continue
        ref = str(item.get("character_ref") or "")
        if ref not in allowed_chars:
            errors.append(_err(
                "director_invalid_performance_execution_character_ref",
                f"performance_execution character_ref is not visible in current Shot: {ref}",
                path=f"director.performance_execution[{index}].character_ref",
            ))
        execution_text = " ".join(str(item.get(field) or "") for field in _VISIBLE_EXECUTION_FIELDS)
        visible_fields = [field for field in _VISIBLE_EXECUTION_FIELDS if str(item.get(field) or "").strip()]
        execution_authorities = _performance_execution_authorities(context)
        allowed_entities = _allowed_director_entity_terms(context)
        for field in _VISIBLE_EXECUTION_FIELDS:
            value = str(item.get(field) or "").strip()
            if not value:
                continue
            violations = performance_execution_field_violations(
                field, value, execution_authorities, allowed_entity_terms=allowed_entities
            )
            hard_violations = performance_execution_hard_violations(
                field, value, execution_authorities, allowed_entity_terms=allowed_entities
            )
            if hard_violations:
                # v17.8: performance_execution is optional, non-authoritative
                # rendering enrichment. A leaking modifier is diagnosable, but it
                # must not consume semantic Repair. The compiler uses the same
                # authority predicate and drops only the unsafe field.
                warning = _err(
                    "director_performance_execution_unsafe",
                    f"performance_execution.{field} introduces objective action/fact outside current Shot authority; this non-authoritative field will be omitted from final rendering",
                    path=f"director.performance_execution[{index}].{field}",
                )
                warning["code"] = "W024_PERFORMANCE_EXECUTION_DROPPED_UNSAFE"
                warning["authority_violations"] = hard_violations
                errors.append(warning)
            elif violations:
                warning = _err(
                    "director_performance_execution_grammar_unrecognized",
                    f"performance_execution.{field} uses natural acting wording outside the current positive modulation grammar; no objective story/authority leakage was detected",
                    path=f"director.performance_execution[{index}].{field}",
                )
                warning["code"] = "W022_PERFORMANCE_EXECUTION_GRAMMAR_UNRECOGNIZED"
                warning["execution_violations"] = violations
                errors.append(warning)
        if execution_text and _ABSTRACT_PERFORMANCE_TERMS_RE.search(execution_text) and len(visible_fields) <= 1:
            warning = _err(
                "director_performance_too_abstract",
                "performance_execution is mostly abstract emotion language without enough visible/audible execution signals",
                path=f"director.performance_execution[{index}]",
            )
            warning["code"] = "W012_PERFORMANCE_TOO_ABSTRACT"
            errors.append(warning)

    # Dialogue delivery references frozen units only; there is intentionally no
    # free-text dialogue field in Director v17.
    targets = _dialogue_delivery_targets(context)
    target_by_id = {str(x.get("frozen_text_unit_id")): x for x in targets}
    seen_units: set[str] = set()
    for index, item in enumerate(director.get("dialogue_delivery") or []):
        if not isinstance(item, dict):
            continue
        unit_id = str(item.get("frozen_text_unit_id") or "")
        speaker_ref = str(item.get("speaker_ref") or "")
        target = target_by_id.get(unit_id)
        if target is None:
            errors.append(_err(
                "director_dialogue_delivery_unknown_frozen_unit",
                f"dialogue_delivery must reference an existing current-Shot FrozenTextUnit: {unit_id}",
                path=f"director.dialogue_delivery[{index}].frozen_text_unit_id",
            ))
        elif speaker_ref != str(target.get("speaker_ref") or ""):
            errors.append(_err(
                "director_dialogue_delivery_speaker_mismatch",
                "dialogue_delivery speaker_ref must match the frozen dialogue owner",
                path=f"director.dialogue_delivery[{index}].speaker_ref",
            ))
        if unit_id in seen_units and unit_id:
            errors.append(_err(
                "director_dialogue_delivery_duplicate",
                f"FrozenTextUnit may have at most one Director delivery instruction: {unit_id}",
                path=f"director.dialogue_delivery[{index}].frozen_text_unit_id",
            ))
        seen_units.add(unit_id)
        frozen_line = str((target or {}).get("line") or (target or {}).get("text") or "")
        allowed_entities = _allowed_director_entity_terms(context)
        for field in ("emotion", "volume", "pace", "pause", "delivery", "gaze_during_line"):
            value = str(item.get(field) or "").strip()
            if not value:
                continue
            violations = dialogue_delivery_field_violations(field, value, frozen_line=frozen_line, allowed_entity_terms=allowed_entities)
            hard_violations = dialogue_delivery_hard_violations(
                field, value, frozen_line=frozen_line, allowed_entity_terms=allowed_entities
            )
            if hard_violations:
                # v17.8: delivery metadata may shape performance but never owns
                # dialogue or plot facts. Unsafe optional prose is soft-dropped at
                # render time; frozen text/unit identity remains hard-validated.
                warning = _err(
                    "director_dialogue_delivery_unsafe",
                    f"dialogue_delivery.{field} introduces story facts or an unauthorized gaze target; this non-authoritative field will be omitted from final rendering",
                    path=f"director.dialogue_delivery[{index}].{field}",
                )
                warning["code"] = "W025_DIALOGUE_DELIVERY_DROPPED_UNSAFE"
                warning["delivery_violations"] = hard_violations
                errors.append(warning)
            elif violations:
                warning = _err(
                    "director_dialogue_delivery_grammar_unrecognized",
                    f"dialogue_delivery.{field} uses natural delivery wording outside the current positive grammar; no story/authority leakage was detected",
                    path=f"director.dialogue_delivery[{index}].{field}",
                )
                warning["code"] = "W020_DIALOGUE_DELIVERY_GRAMMAR_UNRECOGNIZED"
                warning["delivery_violations"] = violations
                errors.append(warning)

    camera_execution = director.get("camera_execution") if isinstance(director.get("camera_execution"), dict) else {}
    framing_note = str(camera_execution.get("framing_note") or "").strip()
    if framing_note:
        dialogue_lines = [
            str(item.get("line") or item.get("text") or "").strip()
            for item in ((context.get("shot") or {}).get("dialogue") or [])
            if isinstance(item, dict) and str(item.get("line") or item.get("text") or "").strip()
        ]
        leaked_dialogue = any(line and line in framing_note for line in dialogue_lines)
        grammar_violations = framing_note_violations(framing_note)
        unrecognized_camera_clauses = framing_note_unrecognized_clauses(framing_note)
        authority_violations = framing_note_authority_violations(
            framing_note,
            authority_texts=_camera_framing_authorities(context),
            allowed_entity_terms=_allowed_director_entity_terms(context),
        )
        if leaked_dialogue or grammar_violations:
            # v17.7: framing_note is explicitly non-authoritative optional prose.
            # It must never consume the single semantic Repair budget. Any
            # deterministic ownership leakage is surfaced as a quality warning
            # and the compiler drops the whole note before final rendering.
            warning = _err(
                "director_camera_note_unsafe",
                "camera_execution.framing_note contains non-camera or dialogue semantics; framing_note is non-authoritative and will be omitted from the final camera prompt",
                path="director.camera_execution.framing_note",
            )
            warning["code"] = "W023_CAMERA_NOTE_DROPPED_UNSAFE"
            warning["camera_grammar_violations"] = grammar_violations
            warning["camera_authority_violations"] = authority_violations
            warning["leaked_dialogue"] = bool(leaked_dialogue)
            errors.append(warning)
        else:
            if authority_violations:
                warning = _err(
                    "director_camera_authority_unresolved",
                    "framing_note contains a free-text entity/fact phrase that cannot be proven from structured current-shot authority; the note is non-authoritative and will be omitted from the final camera prompt",
                    path="director.camera_execution.framing_note",
                )
                warning["code"] = "W021_CAMERA_NOTE_AUTHORITY_UNRESOLVED"
                warning["camera_authority_violations"] = authority_violations
                errors.append(warning)
            if unrecognized_camera_clauses:
                warning = _err(
                    "director_camera_grammar_unrecognized",
                    "camera_execution.framing_note uses natural camera wording not recognized by the current positive grammar; no deterministic ownership leakage was detected",
                    path="director.camera_execution.framing_note",
                )
                warning["code"] = "W016_CAMERA_GRAMMAR_UNRECOGNIZED"
                warning["unrecognized_camera_clauses"] = unrecognized_camera_clauses
                errors.append(warning)

    density_rank = {"low": 0, "medium": 1, "high": 2}
    program_density = str(program.get("performance_density_target") or "low")
    actual_density = _performance_density_target(context, director)
    density = max((program_density, actual_density), key=lambda x: density_rank.get(x, 0))
    signal_count = _performance_signal_count(director)
    visible_count = len(allowed_chars)
    ranges = {"low": (0, 3), "medium": (1, 5), "high": (3, 9)}
    low, high = ranges.get(density, (0, 5))
    should_check_density = bool(visible_count) and (density in {"medium", "high"} or bool(director.get("performance_execution")))
    if should_check_density and not (low <= signal_count <= high):
        warning = _err(
            "director_performance_density_mismatch",
            f"performance density target={density}, visible execution signals={signal_count}, expected range={low}..{high}",
            path="director.performance_execution",
        )
        warning["code"] = "W014_PERFORMANCE_DENSITY_MISMATCH"
        errors.append(warning)

    # Transition warning only when the objective Director event itself is clearly
    # multi-step. No NLP attempt is made to infer a transition from psychology.
    has_transition = any(
        isinstance(item, dict) and str(item.get("action_transition") or "").strip()
        for item in director.get("performance_execution") or []
    )
    multi_step = any(
        isinstance(item, dict)
        and len(_SUBJECT_ACTION_VERB_RE.findall(str(item.get("action") or ""))) >= 2
        and (_ACTION_TRANSITION_HINT_RE.search(str(item.get("action") or "")) is not None or "；" in str(item.get("action") or ""))
        for item in director.get("performance_actions") or []
    )
    if multi_step and not has_transition:
        warning = _err(
            "director_action_transition_missing",
            "current Shot contains a clear multi-step action state change but performance_execution.action_transition is empty",
            path="director.performance_execution",
        )
        warning["code"] = "W013_ACTION_TRANSITION_MISSING"
        errors.append(warning)

    chars = _performance_payload_chars(director)
    limits = {"low": 90, "medium": 160, "high": 260}
    limit = limits.get(density, 160)
    if chars > limit:
        warning = _err(
            "director_performance_budget_high",
            f"Director v17 performance payload is {chars} chars, above {density} budget {limit}; remove repeated or non-executable prose",
            path="director.performance_execution",
        )
        warning["code"] = "W015_PERFORMANCE_BUDGET_HIGH"
        warning["budget"] = {"performance_chars": chars, "limit": limit, "density": density}
        errors.append(warning)

    return errors


def validate_director_fragment(
    director: Any,
    context: dict[str, Any],
    *,
    is_first_global_shot: bool,
) -> list[dict[str, Any]]:
    errors = _shape_errors(director)
    if errors or not isinstance(director, dict):
        return _annotate_director_repair_errors(errors, context)

    program = context.get("program_owned") or {}
    allowed_chars = set(program.get("allowed_character_refs") or [])
    allowed_props = set(program.get("allowed_prop_refs") or [])
    expected_speakers = _speaker_refs(context)

    if director.get("speaker_target_refs") != expected_speakers:
        errors.append(_err("speaker_target_mismatch", f"expected speakers {expected_speakers}, got {director.get('speaker_target_refs')}"))
    if is_first_global_shot and director.get("continuity_scope") != {"mode": "reset"}:
        errors.append(_err("first_shot_requires_reset", "first storyboard shot must use reset continuity"))

    for index, ref in enumerate(director.get("primary_subject_refs") or []):
        if ref not in allowed_chars:
            error = _err(
                "invalid_primary_subject_ref",
                f"{ref} is not in shot.character_refs",
                path=f"director.primary_subject_refs[{index}]",
            )
            error.update({
                "invalid_ref": ref,
                "allowed_character_refs": sorted(allowed_chars),
                "allowed_prop_refs": sorted(allowed_props),
                "repair_targets": [f"director.primary_subject_refs[{index}]"],
                "repair_action": (
                    "remove_prop_from_primary_subject_refs"
                    if ref in allowed_props
                    else "replace_or_remove_unknown_primary_subject_ref_without_guessing"
                ),
                "repair_instruction": (
                    "primary_subject_refs is character-only; remove this ref from primary_subject_refs and preserve any already-valid prop visual_target/visual_focus fields"
                    if ref in allowed_props
                    else "primary_subject_refs is character-only; do not guess a replacement ref that is not supported by current shot authority"
                ),
            })
            errors.append(error)
    perf_refs: set[str] = set()
    anchors = (context.get("program_owned") or {}).get("current_shot_action_evidence") or _collect_current_shot_action_evidence(context)
    dialogue_by_ref: dict[str, list[str]] = {}
    for item in ((context.get("shot") or {}).get("dialogue") or []):
        if isinstance(item, dict) and isinstance(item.get("character_id"), str):
            line = item.get("line") or item.get("text")
            if isinstance(line, str) and line.strip():
                dialogue_by_ref.setdefault(item["character_id"], []).append(line)

    for i, action in enumerate(director.get("performance_actions") or []):
        ref = action.get("character_ref")
        if ref not in allowed_chars:
            errors.append(_err("invalid_performance_character_ref", f"{ref} is not in shot.character_refs"))
        else:
            perf_refs.add(ref)
            if _speech_action_restates_dialogue(str(action.get("action") or ""), dialogue_by_ref.get(str(ref), [])):
                errors.append(_err(
                    "director_speech_action_restates_dialogue",
                    "performance action restates dialogue semantics; keep only visible speaking cue and let shot.dialogue carry the spoken content once.",
                    path=f"director.performance_actions[{i}].action",
                ))
        action_text = action.get("action")
        if action.get("transformation_type") not in TRANSFORMATION_TYPES:
            errors.append(_err("invalid_transformation_type", f"unsupported transformation_type: {action.get('transformation_type')}"))
        for tag in action.get("dependency_tags") or []:
            if tag not in DEPENDENCY_TAGS:
                errors.append(_err("invalid_dependency_tag", f"unsupported dependency_tag: {tag}"))
        for evidence in action.get("source_evidence") or []:
            quote = evidence.get("quote") if isinstance(evidence, dict) else None
            if isinstance(quote, str) and quote.strip() and not any(quote in text for text in anchors):
                errors.append(_err("unanchored_performance_evidence", f"performance evidence is not present in current authoritative context: {quote}", path=f"director.performance_actions[{i}].source_evidence"))

    # reaction_target_refs are visual/camera ownership only.  They do not imply an
    # objective action fact and therefore must not require a same-character
    # performance_action.  Invalid refs remain hard errors above; absence of a
    # performance action is valid and must never trigger model Repair.
    for ref in director.get("reaction_target_refs") or []:
        if ref not in allowed_chars:
            errors.append(_err("invalid_reaction_target_ref", f"{ref} is not in shot.character_refs"))

    purpose = str(director.get("shot_purpose") or "")
    if purpose not in SHOT_PURPOSES:
        errors.append(_err("director_invalid_shot_purpose", f"unsupported shot_purpose: {purpose}", path="director.shot_purpose"))

    scene_position = str(director.get("scene_position") or "")
    if scene_position not in SCENE_POSITIONS:
        errors.append(_err("director_invalid_scene_position", f"unsupported scene_position: {scene_position}", path="director.scene_position"))
    scene_context_usage = list(director.get("scene_context_usage") or [])
    for index, usage in enumerate(scene_context_usage):
        if usage not in SCENE_CONTEXT_USAGE_VALUES:
            errors.append(_err("director_invalid_scene_context_usage", f"unsupported scene_context_usage: {usage}", path=f"director.scene_context_usage[{index}]"))
    scene_status = str(program.get("scene_context_status") or "")
    scene_context = program.get("scene_director_context") if isinstance(program.get("scene_director_context"), dict) else {}
    if scene_status not in {"available", "repaired"}:
        if scene_context_usage:
            errors.append(_err("director_scene_context_usage_without_context", "scene_context_usage must be empty when Scene Context is unavailable", path="director.scene_context_usage"))
    else:
        # scene_position is runtime-derived creative context in v18.0_1. The
        # canonicalizer already overwrites any conflicting model value, so this
        # validator only observes usage and never spends Repair on a duplicate
        # creative decision.
        if not scene_context_usage:
            errors.append(_err(
                "W018_SCENE_CONTEXT_UNUSED",
                "Scene Context is available but this Shot reports no consumed context category",
                path="director.scene_context_usage",
            ))

    framing = director.get("execution_framing") or {}
    framing_type = framing.get("framing_type")
    if framing_type not in FRAMING_TYPES:
        errors.append(_err("director_invalid_framing_type", f"unsupported framing_type: {framing_type}", path="director.execution_framing.framing_type"))
    foreground_refs = list(framing.get("foreground_character_refs") or [])
    for ref in foreground_refs:
        if ref not in allowed_chars:
            errors.append(_err("director_invalid_framing_character_ref", f"{ref} is not in shot.character_refs", path="director.execution_framing.foreground_character_refs"))

    target = director.get("visual_target") or {}
    target_type = target.get("target_type")
    if target_type not in VISUAL_TARGET_TYPES:
        errors.append(_err("invalid_visual_target_type", f"unsupported target_type: {target_type}", path="director.visual_target.target_type"))
    for ref in target.get("character_refs") or []:
        if ref not in allowed_chars:
            errors.append(_err("invalid_visual_target_character_ref", f"{ref} is not in shot.character_refs", path="director.visual_target.character_refs"))
    for ref in target.get("prop_refs") or []:
        if ref not in allowed_props:
            errors.append(_err("invalid_visual_target_prop_ref", f"{ref} is not in shot.prop_refs", path="director.visual_target.prop_refs"))
    environment_focus_authority = _collect_environment_focus_authority(context)
    for index, environment_key in enumerate(target.get("environment_keys") or []):
        if isinstance(environment_key, str) and not _environment_focus_is_anchored(environment_key, environment_focus_authority):
            errors.append(_err("director_unanchored_visual_target_environment", "visual target environment key is not supported by current authority", path=f"director.visual_target.environment_keys[{index}]"))

    design = director.get("execution_shot_design") or {}
    if design.get("shot_size") not in SHOT_SIZE_MAP:
        errors.append(_err("director_invalid_execution_shot_size", f"unsupported shot_size: {design.get('shot_size')}", path="director.execution_shot_design.shot_size"))
    if design.get("camera") not in CAMERA_MAP:
        errors.append(_err("director_invalid_execution_camera", f"unsupported camera: {design.get('camera')}", path="director.execution_shot_design.camera"))
    if design.get("movement") not in MOVEMENT_MAP:
        errors.append(_err("director_invalid_execution_movement", f"unsupported movement: {design.get('movement')}", path="director.execution_shot_design.movement"))

    focus = director.get("visual_focus") or {}
    if focus.get("focus_type") not in FOCUS_TYPES:
        errors.append(_err("invalid_visual_focus_type", f"unsupported focus_type: {focus.get('focus_type')}"))
    for ref in focus.get("subject_refs") or []:
        if ref not in allowed_chars:
            errors.append(_err("invalid_visual_focus_subject_ref", f"{ref} is not in shot.character_refs"))
    for ref in focus.get("prop_refs") or []:
        if ref not in allowed_props:
            errors.append(_err("invalid_visual_focus_prop_ref", f"{ref} is not in shot.prop_refs"))
    for ref, regions in (focus.get("body_regions") or {}).items():
        if ref not in allowed_chars:
            errors.append(_err("invalid_visual_focus_subject_ref", f"{ref} body_regions target is not in shot.character_refs"))
        for region in regions:
            if region not in BODY_REGIONS:
                errors.append(_err("invalid_visual_focus_body_region", f"unsupported body region: {region}"))
    environment_focus_authority = _collect_environment_focus_authority(context)
    for index, environment_key in enumerate(focus.get("environment_keys") or []):
        if isinstance(environment_key, str) and not _environment_focus_is_anchored(environment_key, environment_focus_authority):
            errors.append(_err(
                "director_unanchored_environment_focus",
                "environment focus is not supported by current Shot/Scene/Production Semantics authority",
                path=f"director.visual_focus.environment_keys[{index}]",
            ))

    target_chars = set(target.get("character_refs") or [])
    target_props = set(target.get("prop_refs") or [])
    focus_chars = set(focus.get("subject_refs") or []) | set((focus.get("body_regions") or {}).keys())
    focus_props = set(focus.get("prop_refs") or [])
    if target_type in {"character", "reaction"} and focus_chars and not focus_chars.issubset(target_chars):
        invalid_subject_refs = [ref for ref in (focus.get("subject_refs") or []) if ref not in target_chars]
        invalid_body_refs = [ref for ref in (focus.get("body_regions") or {}).keys() if ref not in target_chars]
        repair_targets: list[str] = []
        if invalid_subject_refs:
            repair_targets.append("director.visual_focus.subject_refs")
        if invalid_body_refs:
            repair_targets.append("director.visual_focus.body_regions")
        err = _err(
            "director_visual_target_focus_mismatch",
            "visual_focus character refs must stay inside visual_target.character_refs",
            path=repair_targets[0] if repair_targets else "director.visual_focus",
        )
        err.update({
            "repair_targets": repair_targets or ["director.visual_focus"],
            "allowed_character_refs": sorted(target_chars),
            "invalid_subject_refs": invalid_subject_refs,
            "invalid_body_region_refs": invalid_body_refs,
            "preserve_visual_target": copy.deepcopy(target),
            "repair_instruction": (
                "preserve visual_target, shot purpose, execution design and unrelated valid Director fields; "
                "remove or retarget only visual_focus character refs that are outside visual_target.character_refs; "
                "visual_focus.subject_refs and body_regions keys must be subsets of allowed_character_refs"
            ),
        })
        errors.append(err)
    if target_type == "prop" and focus_props and not focus_props.issubset(target_props):
        invalid_prop_refs = [ref for ref in (focus.get("prop_refs") or []) if ref not in target_props]
        err = _err(
            "director_visual_target_focus_mismatch",
            "visual_focus prop refs must stay inside visual_target.prop_refs",
            path="director.visual_focus.prop_refs",
        )
        err.update({
            "repair_targets": ["director.visual_focus.prop_refs"],
            "allowed_prop_refs": sorted(target_props),
            "invalid_prop_refs": invalid_prop_refs,
            "preserve_visual_target": copy.deepcopy(target),
            "repair_instruction": (
                "preserve visual_target, shot purpose, execution design and unrelated valid Director fields; "
                "repair only visual_focus.prop_refs so every ref stays inside allowed_prop_refs"
            ),
        })
        errors.append(err)
    precision_regions = {region for regions in (focus.get("body_regions") or {}).values() for region in (regions or []) if region in PRECISION_BODY_REGIONS}
    if design.get("shot_size") in {"wide", "extreme_wide"} and precision_regions:
        if purpose == "establish_space":
            error = _err(
                "director_shot_size_focus_conflict",
                f"{design.get('shot_size')} cannot carry precision body focus: {sorted(precision_regions)}",
                path="director.visual_focus",
            )
            error.update({
                "repair_action": "preserve_wide_and_relax_precision_focus",
                "preserve_shot_purpose": purpose,
                "preserve_execution_shot_size": design.get("shot_size"),
                "precision_body_regions": sorted(precision_regions),
                "repair_instruction": (
                    "establish_space requires wide/extreme_wide; keep the current execution shot size and remove only the precision body-region emphasis, "
                    "replacing it with a non-precision focus consistent with the existing visual_target"
                ),
            })
        else:
            allowed_sizes = ["medium_close", "close", "extreme_close"]
            if purpose in {"detail", "emotional_peak"}:
                allowed_sizes = ["close", "extreme_close"]
            error = _err(
                "director_shot_size_focus_conflict",
                f"{design.get('shot_size')} cannot carry precision body focus: {sorted(precision_regions)}",
                path="director.execution_shot_design.shot_size",
            )
            error.update({
                "repair_action": "change_shot_size_keep_precision_focus",
                "allowed_repair_values": allowed_sizes,
                "preserve_visual_focus": copy.deepcopy(focus),
                "preserve_shot_purpose": purpose,
                "repair_instruction": (
                    "keep the existing precision visual_focus and all unrelated valid Director fields; change only execution_shot_design.shot_size "
                    "to one allowed_repair_values entry that satisfies the current shot_purpose"
                ),
            })
        errors.append(error)

    shot_size = design.get("shot_size")
    if purpose == "establish_space" and shot_size not in {"extreme_wide", "wide"}:
        errors.append(_err("director_shot_purpose_design_conflict", "establish_space requires wide/extreme_wide so the space is actually readable", path="director.execution_shot_design.shot_size"))
    if purpose == "detail" and shot_size not in {"close", "extreme_close"}:
        errors.append(_err("director_shot_purpose_design_conflict", "detail requires close/extreme_close rather than another generic medium-close shot", path="director.execution_shot_design.shot_size"))
    if purpose == "emotional_peak" and shot_size not in {"close", "extreme_close"}:
        errors.append(_err("director_shot_purpose_design_conflict", "emotional_peak requires close/extreme_close so the emotional turn is visually legible", path="director.execution_shot_design.shot_size"))
    if purpose == "reaction" and shot_size not in {"medium_close", "close", "extreme_close"}:
        error = _err("director_shot_purpose_design_conflict", "reaction requires a readable reaction scale", path="director.execution_shot_design.shot_size")
        error.update({
            "repair_action": "change_shot_size_for_readable_reaction",
            "allowed_repair_values": ["medium_close", "close", "extreme_close"],
            "preserve_shot_purpose": "reaction",
            "repair_instruction": "if reaction purpose remains valid after reaction-target repair, change only execution_shot_design.shot_size to a readable reaction scale",
        })
        errors.append(error)
    if purpose == "relationship" and framing_type not in {"two_shot", "over_shoulder"}:
        errors.append(_err("director_shot_purpose_framing_conflict", "relationship requires two_shot or over_shoulder framing", path="director.execution_framing.framing_type"))
    if framing_type == "over_shoulder":
        if len(allowed_chars) < 2 or len(foreground_refs) != 1:
            errors.append(_err("director_over_shoulder_invalid", "over_shoulder requires exactly one foreground character and at least two current-shot characters", path="director.execution_framing"))
        elif foreground_refs[0] in set(target.get("character_refs") or []):
            errors.append(_err("director_over_shoulder_target_conflict", "over_shoulder foreground character must differ from the visual target character", path="director.execution_framing.foreground_character_refs"))
    if framing_type == "two_shot" and len(allowed_chars) < 2:
        errors.append(_err("director_two_shot_invalid", "two_shot requires at least two current-shot characters", path="director.execution_framing.framing_type"))
    if framing_type == "detail" and shot_size not in {"medium_close", "close", "extreme_close"}:
        errors.append(_err("director_framing_design_conflict", "detail framing requires a close-scale shot", path="director.execution_shot_design.shot_size"))
    if framing_type == "environment" and target_type not in {"environment", "spatial_relation"}:
        errors.append(_err("director_framing_target_conflict", "environment framing requires environment/spatial_relation visual target", path="director.execution_framing.framing_type"))

    recent_designs = [item for item in (program.get("recent_shot_designs") or []) if isinstance(item, dict)]
    current_triplet = (design.get("shot_size"), design.get("camera"), design.get("movement"))
    if len(recent_designs) >= 2:
        previous_two = recent_designs[-2:]
        prior = [(item.get("shot_size"), item.get("camera"), item.get("movement")) for item in previous_two]
        if prior[0] == prior[1] == current_triplet:
            current_target_signature = (target_type, tuple(target.get("character_refs") or []), tuple(target.get("prop_refs") or []), tuple(target.get("environment_keys") or []))
            prior_target_signatures = []
            for item in previous_two:
                vt = item.get("visual_target") if isinstance(item.get("visual_target"), dict) else {}
                prior_target_signatures.append((vt.get("target_type"), tuple(vt.get("character_refs") or []), tuple(vt.get("prop_refs") or []), tuple(vt.get("environment_keys") or [])))
            same_target = prior_target_signatures[0] == prior_target_signatures[1] == current_target_signature
            if purpose == "continuity" and same_target:
                errors.append(_err("director_repeated_continuity_design", "three-shot repetition retained only as explicit continuity; verify the action truly needs the same view", path="director.execution_shot_design"))
            else:
                current_values = {
                    "shot_size": str(design.get("shot_size") or ""),
                    "camera": str(design.get("camera") or ""),
                    "movement": str(design.get("movement") or ""),
                }
                if purpose == "establish_space":
                    allowed_sizes = ["extreme_wide", "wide"]
                elif purpose in {"detail", "emotional_peak"}:
                    allowed_sizes = ["close", "extreme_close"]
                elif purpose == "reaction":
                    allowed_sizes = ["medium_close", "close", "extreme_close"]
                else:
                    allowed_sizes = list(SHOT_SIZE_MAP)
                repair_paths = [
                    "director.execution_shot_design.shot_size",
                    "director.execution_shot_design.camera",
                    "director.execution_shot_design.movement",
                ]
                alternatives = {
                    "director.execution_shot_design.shot_size": [x for x in allowed_sizes if x != current_values["shot_size"]],
                    "director.execution_shot_design.camera": [x for x in CAMERA_MAP if x != current_values["camera"]],
                    "director.execution_shot_design.movement": [x for x in MOVEMENT_MAP if x != current_values["movement"]],
                }
                # A dimension with no legal alternative must not be advertised as a
                # must-change target. At least one remaining dimension must change.
                repair_paths = [path for path in repair_paths if alternatives.get(path)]
                err = _err(
                    "director_repeated_execution_design",
                    "three consecutive shots may not keep the same shot_size/camera/movement when purpose or visual target changes; vary at least one element with narrative intent",
                    path=repair_paths[0] if repair_paths else "director.execution_shot_design",
                )
                err["code"] = "W017_CAMERA_REPETITION"
                err.update({
                    "repair_targets": repair_paths or ["director.execution_shot_design"],
                    "must_change_any_of_paths": repair_paths,
                    "current_values": current_values,
                    "allowed_alternative_values": {path: alternatives[path] for path in repair_paths},
                    "preserve_shot_purpose": purpose,
                    "preserve_visual_target": copy.deepcopy(target),
                    "repair_instruction": (
                        "preserve plot facts, dialogue, shot purpose, visual target and unrelated valid fields; "
                        "change at least one must_change_any_of_paths value to a different allowed alternative that better expresses the current purpose; "
                        "do not return the same shot_size/camera/movement triplet and do not add decorative movement"
                    ),
                })
                errors.append(err)

    scene_summary = program.get("scene_design_summary") if isinstance(program.get("scene_design_summary"), dict) else {}
    prior_count = int(scene_summary.get("prior_shot_count") or 0)
    if prior_count >= 6 and purpose != "continuity":
        framing_type = str((framing or {}).get("framing_type") or "")
        current_dims = {
            "shot_size": str(design.get("shot_size") or ""),
            "camera": str(design.get("camera") or ""),
            "movement": str(design.get("movement") or ""),
            "framing": framing_type,
        }
        count_maps = {
            "shot_size": scene_summary.get("shot_size_counts") or {},
            "camera": scene_summary.get("camera_counts") or {},
            "movement": scene_summary.get("movement_counts") or {},
            "framing": scene_summary.get("framing_counts") or {},
        }
        dominant: list[str] = []
        for dim, value in current_dims.items():
            if not value:
                continue
            count = int((count_maps.get(dim) or {}).get(value) or 0)
            if prior_count and (count / prior_count) >= 0.72:
                dominant.append(dim)
        if len(dominant) >= 3 and purpose in {"speaker", "reaction", "relationship", "detail", "reveal", "emotional_peak", "closing", "transition", "action"}:
            dimension_paths = {
                "shot_size": "director.execution_shot_design.shot_size",
                "camera": "director.execution_shot_design.camera",
                "movement": "director.execution_shot_design.movement",
                "framing": "director.execution_framing.framing_type",
            }
            repair_paths = [dimension_paths[d] for d in dominant if d in dimension_paths]
            alternatives = {
                "director.execution_shot_design.shot_size": [x for x in sorted(SHOT_SIZE_MAP) if x != current_dims.get("shot_size")],
                "director.execution_shot_design.camera": [x for x in sorted(CAMERA_MAP) if x != current_dims.get("camera")],
                "director.execution_shot_design.movement": [x for x in sorted(MOVEMENT_MAP) if x != current_dims.get("movement")],
                "director.execution_framing.framing_type": [x for x in sorted(FRAMING_TYPES) if x != current_dims.get("framing")],
            }
            err = _err(
                "director_scene_design_monoculture",
                "current scene is over-concentrated in the same camera grammar for a new narrative-purpose shot; at least one dominant execution dimension must change with narrative intent",
                path=repair_paths[0] if repair_paths else "director.execution_shot_design",
            )
            err["code"] = "W018_CAMERA_MONOCULTURE"
            err.update({
                "dominant_dimensions": dominant,
                "current_values": copy.deepcopy(current_dims),
                "repair_targets": repair_paths,
                "must_change_any_of_paths": repair_paths,
                "allowed_alternative_values": {path: alternatives.get(path, []) for path in repair_paths},
                "repair_instruction": (
                    "preserve plot facts, dialogue, visual target, shot purpose and unrelated valid fields; "
                    "change at least one must_change_any_of_paths value to a different allowed alternative that better expresses the current purpose; "
                    "returning all listed dimensions unchanged is not a repair; do not add decorative movement"
                ),
            })
            errors.append(err)

        # Specifically prevent the long-dialogue failure mode where shot size or
        # framing changes just enough to look diverse in metadata while the
        # entire scene remains overwhelmingly eye-level + static. This is still
        # narrative-gated: continuity shots are exempt and the repair may only
        # change camera/movement when it serves the current purpose.
        purpose_counts = scene_summary.get("purpose_counts") or {}
        scene_purposes = {str(k) for k, v in purpose_counts.items() if int(v or 0) > 0}
        scene_purposes.add(purpose)
        if prior_count >= 7 and len(scene_purposes - {""}) >= 3:
            camera_value = str(design.get("camera") or "")
            movement_value = str(design.get("movement") or "")
            camera_count = int((count_maps.get("camera") or {}).get(camera_value) or 0)
            movement_count = int((count_maps.get("movement") or {}).get(movement_value) or 0)
            projected = prior_count + 1
            camera_ratio = ((camera_count + 1) / projected) if camera_value else 0.0
            movement_ratio = ((movement_count + 1) / projected) if movement_value else 0.0
            if camera_ratio >= 0.80 and movement_ratio >= 0.80:
                repair_paths = [
                    "director.execution_shot_design.camera",
                    "director.execution_shot_design.movement",
                ]
                err = _err(
                    "director_scene_camera_distribution_pressure",
                    "scene-wide camera and movement remain over-concentrated for a new narrative-purpose shot; vary camera or movement with narrative intent",
                    path=repair_paths[0],
                )
                err["code"] = "W019_CAMERA_DISTRIBUTION_PRESSURE"
                err["dominant_dimensions"] = ["camera", "movement"]
                err["dominant_camera"] = camera_value
                err["dominant_movement"] = movement_value
                err["current_values"] = {"camera": camera_value, "movement": movement_value}
                err["repair_targets"] = repair_paths
                err["must_change_any_of_paths"] = repair_paths
                err["allowed_alternative_values"] = {
                    repair_paths[0]: [x for x in sorted(CAMERA_MAP) if x != camera_value],
                    repair_paths[1]: [x for x in sorted(MOVEMENT_MAP) if x != movement_value],
                }
                err["repair_instruction"] = "preserve plot facts, visual target and shot purpose; change at least one listed camera/movement path to a different allowed value only when the alternative better expresses the current purpose; do not add decorative motion"
                errors.append(err)

    scope = director.get("continuity_scope") or {}
    if scope.get("mode") not in CONTINUITY_MODES:
        errors.append(_err("invalid_continuity_mode", f"unsupported continuity mode: {scope.get('mode')}"))
        return errors
    continuity_errors = _partial_continuity_errors(scope, context.get("previous_state_out") or empty_state())
    if continuity_errors:
        errors.extend(continuity_errors)
        return errors
    try:
        state_in = resolve_state_in(context.get("previous_state_out") or empty_state(), scope)
    except Exception as exc:
        errors.append(_err("state_resolution_failure", str(exc)))
        return errors

    errors.extend(_director_subject_ownership_errors(director, context, state_in))
    errors.extend(_v17_director_quality_errors(director, context))
    errors.extend(_state_policy_errors(director.get("action_delta") or empty_state(), context))
    errors.extend(_phase_e_errors(state_in, director.get("action_delta") or empty_state(), director.get("state_out") or empty_state()))
    return _annotate_director_repair_errors(errors, context)


def _director_model_assets(assets: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"characters": {}, "props": {}, "scene": {}, "context": {}}
    for ref, item in (assets.get("characters") or {}).items():
        if isinstance(item, dict):
            out["characters"][ref] = {
                key: copy.deepcopy(item.get(key))
                for key in ("character_id", "canonical_name", "role_type", "explicit_facts", "identity_lock", "visual_lock")
                if item.get(key) not in (None, "", [], {})
            }
    for ref, item in (assets.get("props") or {}).items():
        if isinstance(item, dict):
            out["props"][ref] = {
                key: copy.deepcopy(item.get(key))
                for key in ("prop_id", "canonical_name", "name", "explicit_facts", "visual_presence")
                if item.get(key) not in (None, "", [], {})
            }
    scene = assets.get("scene") or {}
    if isinstance(scene, dict):
        out["scene"] = {
            key: copy.deepcopy(scene.get(key))
            for key in ("scene_id", "canonical_name", "name", "time", "weather", "explicit_facts", "visual_lock")
            if scene.get(key) not in (None, "", [], {})
        }
    narrative = assets.get("context") or {}
    if isinstance(narrative, dict):
        out["context"] = {
            key: copy.deepcopy(narrative.get(key))
            for key in ("context_id", "reality_status", "temporal_mode", "representation_mode")
            if narrative.get(key) not in (None, "", [], {})
        }
    return out


def _reaction_candidate_refs(program_owned: dict[str, Any]) -> list[str]:
    """Return precision-first reaction candidates without inventing listener roles.

    Reaction opportunity is scene-level creative context, but a multi-character Shot
    does not imply every non-speaker is an equally valid listener. Prefer current-shot
    reaction evidence, then an explicit scene speaker_listener relation, then the
    unambiguous single-non-speaker case. Ambiguous multi-character Shots intentionally
    return no candidate instead of fabricating a semantic listener.
    """
    if not bool(program_owned.get("reaction_opportunity")):
        return []

    allowed = [str(ref) for ref in program_owned.get("allowed_character_refs") or [] if str(ref)]
    speakers = {str(ref) for ref in program_owned.get("speaker_target_refs") or [] if str(ref)}
    base = [ref for ref in allowed if ref not in speakers]
    if not base:
        return []

    evidence_map = program_owned.get("reaction_performance_evidence_by_character")
    evidence_map = evidence_map if isinstance(evidence_map, dict) else {}
    evidence_candidates = [ref for ref in base if bool(evidence_map.get(ref))]
    if evidence_candidates:
        return evidence_candidates

    if speakers:
        scene_context = program_owned.get("scene_director_context")
        scene_context = scene_context if isinstance(scene_context, dict) else {}
        relation_candidates: list[str] = []
        for relation in scene_context.get("relationship_dynamics") or []:
            if not isinstance(relation, dict) or relation.get("relation_mode") != "speaker_listener":
                continue
            refs = [str(ref) for ref in relation.get("character_refs") or [] if str(ref)]
            if not (set(refs) & speakers):
                continue
            for ref in refs:
                if ref in base and ref not in relation_candidates:
                    relation_candidates.append(ref)
        if relation_candidates:
            return relation_candidates

    if len(base) == 1:
        return base
    return []


def build_director_shot_payload(context: dict[str, Any], *, unit_id: str, is_first_global_shot: bool) -> dict[str, Any]:
    beat = context.get("script_beat") or {}
    out = {
        "shot": copy.deepcopy(context.get("shot") or {}),
        "script_beat": {
            key: copy.deepcopy(beat.get(key))
            for key in ("beat_id", "description", "narration", "dialogue")
            if beat.get(key) not in (None, "", [], {})
        } if isinstance(beat, dict) else {},
        "assets": _director_model_assets(context.get("assets") or {}),
        "production_semantics": copy.deepcopy(context.get("production_semantics") or {}),
        "previous_state_out": copy.deepcopy(context.get("previous_state_out") or {}),
        "program_owned": copy.deepcopy(context.get("program_owned") or {}),
    }
    out["unit_id"] = unit_id
    out["contract_version"] = CONTRACT_VERSION
    program_owned = out.setdefault("program_owned", {})
    program_owned["first_global_shot_requires_reset"] = bool(is_first_global_shot)
    program_owned["current_shot_action_evidence"] = _collect_current_shot_action_evidence(context)
    program_owned["reaction_performance_evidence_by_character"] = _collect_reaction_performance_evidence_by_character(context)
    program_owned["environment_focus_authority"] = _collect_environment_focus_authority(context)
    program_owned["performance_logic_evidence"] = _performance_logic_authorities(context)
    program_owned["performance_execution_authority"] = _performance_execution_authorities(context)
    program_owned["camera_framing_authority"] = _camera_framing_authorities(context)
    program_owned["allowed_entity_terms"] = _allowed_director_entity_terms(context)
    program_owned["performance_baseline_in"] = _performance_baseline_in(context)
    program_owned["performance_density_target"] = _performance_density_target(context)
    program_owned["dialogue_delivery_targets"] = _dialogue_delivery_targets(context)
    base_shot = out.get("shot") or {}
    legacy_base = program_owned.pop("base_shot_design", None)
    if not isinstance(program_owned.get("base_execution_fallback"), dict):
        program_owned["base_execution_fallback"] = copy.deepcopy(legacy_base) if isinstance(legacy_base, dict) else {
            "shot_size": base_shot.get("shot_size"),
            "camera": base_shot.get("camera"),
            "movement": base_shot.get("movement"),
        }
    program_owned.setdefault("base_shot_fact_constraints", {
        "scene_id": str(base_shot.get("scene_id") or ""),
        "shot_id": str(base_shot.get("shot_id") or ""),
        "beat_id": str(base_shot.get("beat_id") or ""),
        "required_character_refs": list(base_shot.get("character_refs") or []),
        "required_prop_refs": list(base_shot.get("prop_refs") or []),
        "required_object_refs": list(base_shot.get("object_refs") or []),
        "objective_visible_events": [],
        "required_spatial_relation": str(base_shot.get("spatial_blocking") or ""),
        "dialogue_unit_refs": list(base_shot.get("dialogue_unit_refs") or []),
        "narration_unit_refs": list(base_shot.get("narration_unit_refs") or []),
        "source_evidence": copy.deepcopy(base_shot.get("source_evidence") or []),
    })
    program_owned["reaction_candidate_refs"] = _reaction_candidate_refs(program_owned)
    program_owned.setdefault("recent_shot_designs", [])
    program_owned.setdefault("scene_design_summary", {"prior_shot_count": 0, "shot_size_counts": {}, "framing_counts": {}, "purpose_counts": {}})
    out["performance_action_template"] = {
        "character_ref": "char_001",
        "action": "",
        "transformation_type": "visible_state_expression",
        "dependency_tags": [],
        "source_evidence": [{"quote": ""}],
    }
    allowed_partial = _allowed_partial_inherit_fields(context.get("previous_state_out") or empty_state())
    allowed_partial_paths = _allowed_partial_inherit_paths(context.get("previous_state_out") or empty_state())
    out["output_contract"] = {
        "root": "object{director}",
        "allowed_values": {
            "performance_actions[*].transformation_type": sorted(TRANSFORMATION_TYPES),
            "performance_actions[*].dependency_tags[*]": sorted(DEPENDENCY_TAGS),
            "shot_purpose": sorted(SHOT_PURPOSES),
            "scene_position": sorted(SCENE_POSITIONS),
            "scene_context_usage[*]": sorted(SCENE_CONTEXT_USAGE_VALUES),
            "visual_target.target_type": sorted(VISUAL_TARGET_TYPES),
            "execution_framing.framing_type": sorted(FRAMING_TYPES),
            "visual_focus.focus_type": sorted(FOCUS_TYPES),
            "visual_focus.body_regions.*[*]": sorted(BODY_REGIONS),
            "execution_shot_design.shot_size": sorted(SHOT_SIZE_MAP),
            "execution_shot_design.camera": sorted(CAMERA_MAP),
            "execution_shot_design.movement": sorted(MOVEMENT_MAP),
            "continuity_scope.mode": sorted(CONTINUITY_MODES),
        },
        "model_owned_fields": sorted(DIRECTOR_MODEL_FIELDS),
        "program_owned_fields": [
            "speaker_target_refs", "state_in", "state_out",
            "base_shot_fact_constraints", "base_execution_fallback",
            "scene_position", "reaction_opportunity", "reaction_candidate_refs", "scene_camera_baseline",
            "previous_shot_design", "next_shot_purpose", "scene_distribution_so_far",
            "allowed_refs", "first_global_shot_reset",
        ],
        "reference_rules": "all refs must come from program_owned.allowed_character_refs/allowed_prop_refs",
        "performance_action.source_evidence": "array<object{quote:string}>",
        "performance_actions[*].action": {
            "rule": "current event must be anchored; visible micro-performance may be added without new narrative facts",
            "hard_forbidden": ["new plot event", "new relationship/fact", "dialogue restatement", "persistent psychological/relationship state"],
        },
        "performance_logic": {
            "item_fields": sorted(PERFORMANCE_LOGIC_FIELDS),
            "rule": "field-level authority: emotions need explicit current affect authority; trigger/goal must be directly present in current authority; tendency must be performance-only; unsupported fields are debug-only and never rendered",
            "baseline_in": copy.deepcopy(program_owned.get("performance_baseline_in") or {}),
        },
        "performance_execution": {
            "item_fields": sorted(PERFORMANCE_EXECUTION_FIELDS),
            "rule": "acting modulation only; objective action/state words must be supported by performance_execution_authority; unused optional signals stay empty",
            "density_target": program_owned.get("performance_density_target") or "low",
        },
        "dialogue_delivery": {
            "item_fields": sorted(DIALOGUE_DELIVERY_FIELDS),
            "targets": copy.deepcopy(program_owned.get("dialogue_delivery_targets") or []),
            "rule": "reference FrozenTextUnit only; cues must follow controlled delivery grammar and may not introduce story events",
        },
        "camera_execution": {
            "item_fields": sorted(CAMERA_EXECUTION_FIELDS),
            "rule": "structured camera fields are authoritative; framing_note is optional non-authoritative composition prose. dialogue/performance/psychology/lighting leakage is hard; unresolved free-text entity authority is soft and the note is omitted from final rendering",
        },
        "shot_purpose": "decide narrative function before choosing framing/camera; continuity is allowed only for genuine same-action continuity",
        "scene_position": "runtime-derived creative phase when Scene Context is available; Runtime canonicalizes model disagreement without Fact Gate/Repair",
        "reaction_candidate_refs": "precision-first deterministic reaction candidates when reaction_opportunity=true: prefer shot-local reaction evidence, then explicit scene speaker_listener relation, then the single non-speaker fallback; ambiguous multi-character shots return [] and candidate availability never forces selection",
        "scene_context_usage": "audit-only enum list of Scene Context categories actually consumed by this Shot; unavailable context requires []",
        "visual_target": "camera-visible target is independent from speaker_target_refs; voice source does not force visual target",
        "execution_framing": "relationship grammar for single/two-shot/over-shoulder/reaction/detail/environment; uses only current-shot refs",
        "visual_focus.body_regions": "key must be a character_ref; values must use allowed body-region enums; posture/gaze_direction/action are semantic labels, not body regions",
        "execution_shot_design": "fact-safe execution decision; base_shot_fact_constraints are hard while base_execution_fallback is soft fallback only",
        "recent_design_policy": "compare previous execution and current narrative function; preserve continuity when justified and deviate only when subject/reaction/framing/scale/angle/movement better serves the current turn",
        "scene_distribution_policy": "after enough shots establish a scene grammar, do not keep three or more dimensions (shot size / camera / movement / framing) overwhelmingly dominant for a new non-continuity purpose; vary only a dimension that serves the current narrative function",
        "script_beat_role": "context_only_not_performance_evidence",
        "transient_state_fields": {"characters": ["speaking"]},
        "state": "action_delta contains only persistent end-of-shot changes; state_out is program-owned from state_in + action_delta",
        "state_out.forbidden_static_keys": sorted(STATIC_ASSET_STATE_KEYS),
        "repair_behavior": "when repair_instruction exists, use invalid_output as base and change only validation_errors fields",
        "continuity_scope": {
            "model_shape": {"mode": "reset|inherit|partial", "inherit_paths": []},
            "canonical_shape": "Runtime converts model inherit_paths into canonical inherit object before validation/state resolution",
            "reset": {"model_shape": {"mode": "reset", "inherit_paths": []}, "canonical": {"mode": "reset"}},
            "inherit": {"model_shape": {"mode": "inherit", "inherit_paths": []}, "canonical": {"mode": "inherit"}},
            "partial": {
                "model_shape": {"mode": "partial", "inherit_paths": ["characters.<ref>.<field>"]},
                "allowed_inherit_fields": allowed_partial,
                "allowed_inherit_paths": allowed_partial_paths,
                "canonical_example": _partial_scope_example(allowed_partial),
            },
        },
        "unknown_fields": "forbidden",
        "authority_manifest": authority_manifest("director_shot"),
    }
    model_template = {
        "director": {
            "dramatic_intent": "",
            "shot_purpose": "",
            "scene_position": "",
            "scene_context_usage": [],
            "primary_subject_refs": [],
            "reaction_target_refs": [],
            "performance_actions": [],
            "performance_logic": [],
            "performance_execution": [],
            "dialogue_delivery": [],
            "visual_target": {"target_type": "", "character_refs": [], "prop_refs": [], "environment_keys": []},
            "visual_focus": {"focus_type": "", "subject_refs": [], "body_regions": {}, "prop_refs": [], "environment_keys": []},
            "execution_framing": {"framing_type": "", "foreground_character_refs": []},
            "execution_shot_design": {
                "shot_size": "",
                "camera": "",
                "movement": "",
            },
            "camera_execution": {
                "framing_type": "",
                "foreground_character_refs": [],
                "shot_size": "",
                "camera": "",
                "movement": "",
                "framing_note": "",
            },
            "action_delta": {"characters": {}, "props": {}, "environment": {}},
            "continuity_scope": {
                "mode": "reset" if is_first_global_shot else "inherit",
                "inherit_paths": [],
            },
        }
    }
    out["output_template"] = model_template
    # Provider schema must validate the actual model envelope, not the extracted
    # inner Director object. A nonempty sample constrains inherit_paths items to string;
    # it is transport-only metadata and is removed from the user prompt by ArkClient.
    provider_template = copy.deepcopy(model_template)
    # Transport-only examples expose array item shapes to Structured Outputs. The
    # prompt-facing template remains empty, so this cannot pressure the model to
    # fabricate a performance action when none is warranted.
    provider_template["director"]["performance_actions"] = [{
        "character_ref": "char_001",
        "action": "可见表演动作",
        "transformation_type": "visible_state_expression",
        "dependency_tags": ["upper_body"],
        "source_evidence": [{"quote": "当前镜头权威证据"}],
    }]
    provider_template["director"]["performance_logic"] = [{
        "character_ref": "char_001",
        "base_emotion": "",
        "emotion_delta": "",
        "trigger": "",
        "behavior_goal": "",
        "behavior_tendency": "",
        "evidence_source": [{"quote": "当前镜头权威证据"}],
    }]
    provider_template["director"]["performance_execution"] = [{
        "character_ref": "char_001",
        "expression": "",
        "gaze": "",
        "breathing": "",
        "body": "",
        "hands": "",
        "movement": "",
        "micro_reaction": "",
        "action_transition": "",
        "end_state": "",
    }]
    provider_template["director"]["dialogue_delivery"] = [{
        "frozen_text_unit_id": "FTU_B001_D001",
        "speaker_ref": "char_001",
        "emotion": "",
        "volume": "",
        "pace": "",
        "pause": "",
        "delivery": "",
        "gaze_during_line": "",
    }]
    provider_template["director"]["continuity_scope"]["inherit_paths"] = ["characters.char_001.position"]
    out["provider_output_template"] = provider_template
    return out
