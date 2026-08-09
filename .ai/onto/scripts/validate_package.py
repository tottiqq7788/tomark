from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    errors: list[str] = []
    for path in sorted((ROOT / "schemas").glob("*.json")):
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            errors.append(f"invalid schema JSON {path.name}: {error}")

    skills = ROOT / "agent-integration/common/skills"
    expected = {"governance-onboarding", "architecture-admission", "governed-implementation", "architecture-review", "evidence-closeout", "legacy-system-discovery"}
    found = {path.name for path in skills.iterdir() if path.is_dir()}
    if found != expected:
        errors.append(f"skill set mismatch: expected {sorted(expected)}, found {sorted(found)}")
    for skill in found:
        content = (skills / skill / "SKILL.md").read_text(encoding="utf-8")
        if f"name: {skill}" not in content or "description:" not in content:
            errors.append(f"invalid SKILL.md frontmatter: {skill}")
        if not (skills / skill / "agents/openai.yaml").is_file():
            errors.append(f"missing agents/openai.yaml: {skill}")

    audit = subprocess.run(
        [sys.executable, str(ROOT / "scripts/audit_project.py"), "--target", str(ROOT / "project-template")],
        capture_output=True,
        text=True,
        check=False,
    )
    if audit.returncode:
        errors.append(f"project-template audit failed: {audit.stdout}{audit.stderr}")

    with tempfile.TemporaryDirectory() as temporary:
        target = Path(temporary) / "sample-project"
        target.mkdir()
        bootstrap = subprocess.run(
            [sys.executable, str(ROOT / "scripts/bootstrap_project.py"), "--target", str(target), "--mode", "new", "--project-id", "sample-project"],
            capture_output=True,
            text=True,
            check=False,
        )
        if bootstrap.returncode:
            errors.append(f"bootstrap smoke test failed: {bootstrap.stdout}{bootstrap.stderr}")
        else:
            initialized_audit = subprocess.run(
                [sys.executable, str(target / "architecture/tools/audit_project.py"), "--target", str(target)],
                capture_output=True,
                text=True,
                check=False,
            )
            if initialized_audit.returncode:
                errors.append(f"initialized project audit failed: {initialized_audit.stdout}{initialized_audit.stderr}")

    if errors:
        print(json.dumps({"status": "failed", "errors": errors}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({"status": "passed", "version": "0.1.0", "skills": len(found)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

