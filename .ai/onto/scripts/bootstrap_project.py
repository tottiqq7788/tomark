from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]


def git_head(target: Path) -> tuple[str, str]:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=target,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode == 0 and result.stdout.strip():
        return result.stdout.strip(), "frozen"
    return "unversioned", "unversioned"


def copy_without_overwrite(source: Path, destination: Path) -> None:
    for item in source.rglob("*"):
        relative = item.relative_to(source)
        target = destination / relative
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        if target.exists():
            raise FileExistsError(f"Refusing to overwrite existing file: {target}")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, target)


def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap Agent Governance Kit v0.1 into a repository")
    parser.add_argument("--target", required=True, type=Path)
    parser.add_argument("--mode", required=True, choices=("new", "existing"))
    parser.add_argument("--project-id")
    args = parser.parse_args()

    target = args.target.resolve()
    if not target.is_dir():
        raise SystemExit(f"Target directory does not exist: {target}")
    if (target / "architecture").exists() or (target / "AGENTS.md").exists():
        raise SystemExit("Refusing to overwrite existing architecture/ or AGENTS.md; merge manually")

    copy_without_overwrite(PACKAGE_ROOT / "project-template", target)
    shutil.copy2(PACKAGE_ROOT / "agent-integration/common/AGENTS.md.template", target / "AGENTS.md")
    copy_without_overwrite(PACKAGE_ROOT / "agent-integration/common/skills", target / ".agents/skills")
    tools_dir = target / "architecture/tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(PACKAGE_ROOT / "scripts/audit_project.py", tools_dir / "audit_project.py")

    manifest_path = target / "architecture/governance.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    commit, status = git_head(target)
    manifest["project_id"] = args.project_id or target.name
    manifest["mode"] = args.mode
    manifest["baseline"] = {"commit": commit, "status": status}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Initialized governance v0.1 in {target}")
    print(f"Mode: {args.mode}; baseline: {commit} ({status})")
    print("Next: replace the example task envelope and run architecture/tools/audit_project.py --target .")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

