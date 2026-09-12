from __future__ import annotations

import argparse
import json
from pathlib import Path

from lakejob.orchestration import AutomationMode, BusinessDomain, SerialOrchestrationEngine, TaskRequest


DEFAULT_OBJECTIVES = {
    "double_end_visual_agent": "完成双端视觉招聘智能体的五角色串行闭环本地验证",
    "visual_runtime_demo": "验证视觉识别、鼠标键盘动作、前后证据和结果校验闭环",
    "jobseeker_demo": "验证求职端岗位匹配、排序和个性化沟通草稿闭环",
    "recruiter_demo": "验证招聘端候选人匹配、排序和沟通草稿闭环",
    "generic": "执行一个具备证据、审计、返工和结果锁定的结构化任务",
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run LakeJob five-role serial closed-loop task")
    parser.add_argument(
        "--task-type",
        choices=sorted(DEFAULT_OBJECTIVES),
        default="double_end_visual_agent",
    )
    parser.add_argument("--objective", default="")
    parser.add_argument("--domain", choices=[item.value for item in BusinessDomain], default="shared")
    parser.add_argument("--automation-mode", choices=[item.value for item in AutomationMode], default="supervised")
    parser.add_argument("--keyword", default="AI视频设计师")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    request = TaskRequest(
        objective=args.objective or DEFAULT_OBJECTIVES[args.task_type],
        task_type=args.task_type,
        business_domain=BusinessDomain(args.domain),
        automation_mode=AutomationMode(args.automation_mode),
        payload={"keyword": args.keyword},
    )
    engine = SerialOrchestrationEngine()
    record = engine.create_and_run(request)
    payload = record.model_dump(mode="json")
    text = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
    print(f"TASK_ID={record.task_id}")
    print(f"STATUS={record.status.value}")
    print(f"RETRY_COUNT={record.retry_count}")
    if record.final_result:
        print(f"OVERALL_SCORE={record.final_result.scores.get('overall', 0)}")
        if record.final_result.lock:
            print(f"CONTENT_HASH={record.final_result.lock.content_hash}")
            print(f"LOCK_VERIFIED={engine.store.verify_lock(record.task_id)}")
    if args.output:
        print(f"OUTPUT={args.output}")
    return 0 if record.status.value == "LOCKED" else 2


if __name__ == "__main__":
    raise SystemExit(main())
