#!/bin/bash
# Generate agent instructions and skills from the canonical .ruler/ source.
#
# This script:
# 1. Runs `npx @intellectronica/ruler apply` to generate AGENTS.md, CLAUDE.md,
#    and agent-specific config from .ruler/
# 2. Overlays the canonical skill tree into each agent's skills directory
#    (Ruler 0.3.x doesn't reliably sync subdirectory resources).
#    Third-party skills listed in skills-lock.json (installed with `npx skills`)
#    are excluded, so the overlay never deletes them.
#
# Usage:
#   scripts/apply-ruler.sh

set -euo pipefail

project_root=$(git rev-parse --show-toplevel)
cd "$project_root"

echo "📐 Applying Ruler configuration..."
npx -y @intellectronica/ruler apply

# Overlay canonical skills to all agent skill directories
canonical_skills_dir=".ruler/skills"
generated_skill_dirs=(
    ".agents/skills"
    ".claude/skills"
    ".kiro/skills"
)

if [ ! -d "$canonical_skills_dir" ]; then
    echo "❌ Canonical skill directory not found: $canonical_skills_dir"
    exit 1
fi

# Skills managed by `npx skills` (skills-lock.json) are protected from --delete
rsync_excludes=(--exclude ".gitkeep")
if [ -f skills-lock.json ]; then
    while IFS= read -r skill; do
        [ -n "$skill" ] && rsync_excludes+=(--exclude "/$skill/")
    done < <(node -e 'console.log(Object.keys(require("./skills-lock.json").skills || {}).join("\n"))')
fi

for target_dir in "${generated_skill_dirs[@]}"; do
    mkdir -p "$target_dir"
    rsync -a --delete "${rsync_excludes[@]}" "$canonical_skills_dir/" "$target_dir/"
done

echo "✅ Agent instructions and skills generated from .ruler/"
echo ""
echo "Updated targets:"
for target_dir in "${generated_skill_dirs[@]}"; do
    echo "  - $target_dir/"
done
echo "  - AGENTS.md"
echo "  - CLAUDE.md"
echo "  - .kiro/steering/"
