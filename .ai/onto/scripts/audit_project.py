from __future__ import annotations

import argparse
import json
from pathlib import Path


def read_json(path: Path, errors: list[str]) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        errors.append(f"missing file: {path}")
        return {}
    except json.JSONDecodeError as error:
        errors.append(f"invalid JSON: {path}: {error}")
        return {}
    if not isinstance(value, dict):
        errors.append(f"expected object: {path}")
        return {}
    return value


def unique_ids(items: object, label: str, errors: list[str]) -> set[str]:
    if not isinstance(items, list):
        errors.append(f"{label} must be an array")
        return set()
    ids: list[str] = []
    for index, item in enumerate(items):
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"]:
            errors.append(f"{label}[{index}] has no stable id")
            continue
        ids.append(item["id"])
    duplicates = sorted({item for item in ids if ids.count(item) > 1})
    if duplicates:
        errors.append(f"duplicate {label} ids: {', '.join(duplicates)}")
    return set(ids)


def audit(target: Path) -> list[str]:
    errors: list[str] = []
    architecture = target / "architecture"
    manifest = read_json(architecture / "governance.json", errors)
    if manifest.get("schema_version") != "governance-manifest:v0.1":
        errors.append("unsupported or missing governance manifest schema_version")
    if manifest.get("mode") not in {"new", "existing"}:
        errors.append("governance mode must be new or existing")
    baseline = manifest.get("baseline")
    if not isinstance(baseline, dict) or baseline.get("status") not in {"frozen", "unversioned", "candidate"}:
        errors.append("invalid baseline declaration")

    paths = manifest.get("paths") if isinstance(manifest.get("paths"), dict) else {}
    for name in ("semantic_map", "contracts", "inventories", "work_packages", "evidence"):
        value = paths.get(name)
        if not isinstance(value, str) or not (target / value).exists():
            errors.append(f"manifest path is missing or unresolved: {name}")

    semantic_path = target / paths.get("semantic_map", "architecture/traceability/semantic-map.json")
    semantic = read_json(semantic_path, errors)
    if semantic.get("schema_version") != "semantic-map:v0.1":
        errors.append("unsupported or missing semantic map schema_version")
    l0_ids = unique_ids(semantic.get("l0_rules"), "l0_rules", errors)
    l1_ids = unique_ids(semantic.get("l1_responsibilities"), "l1_responsibilities", errors)
    unique_ids(semantic.get("l2_components"), "l2_components", errors)

    for item in semantic.get("l1_responsibilities", []) if isinstance(semantic.get("l1_responsibilities"), list) else []:
        for reference in item.get("l0_refs", []):
            if reference not in l0_ids:
                errors.append(f"L1 {item.get('id')} references unknown L0 {reference}")
    for item in semantic.get("l2_components", []) if isinstance(semantic.get("l2_components"), list) else []:
        for reference in item.get("l1_refs", []):
            if reference not in l1_ids:
                errors.append(f"L2 {item.get('id')} references unknown L1 {reference}")

    envelopes = architecture / "task-envelopes"
    for path in sorted(envelopes.glob("*.json")) if envelopes.exists() else []:
        envelope = read_json(path, errors)
        required = ("schema_version", "task_id", "role", "baseline_commit", "allowed_scope", "l0_impact", "required_evidence", "stop_conditions")
        for field in required:
            if field not in envelope:
                errors.append(f"task envelope {path.name} missing {field}")
        if envelope.get("l0_impact") in {"modify_existing", "add_new"} and not envelope.get("l0_rule_ids"):
            errors.append(f"task envelope {path.name} changes L0 without l0_rule_ids")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit a v0.1 governance project")
    parser.add_argument("--target", type=Path, default=Path.cwd())
    args = parser.parse_args()
    errors = audit(args.target.resolve())
    if errors:
        print(json.dumps({"status": "failed", "errors": errors}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({"status": "passed", "scope": "structure_and_references_only", "runtime_evidence": "not_evaluated"}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

