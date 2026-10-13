#!/usr/bin/env bash
# =============================================================================
# 一键把「霓虹跑酷」发布到 GitHub，并开启 GitHub Pages 拿到可分享的网址
#
# 用法：
#   1) 先登录 GitHub CLI（只需一次）：   gh auth login
#   2) 运行本脚本：                      bash tools/deploy-github.sh [仓库名]
#
# 脚本会：创建/复用仓库 → 推送 main → 开启 Pages → 轮询直到网址可访问
# =============================================================================
set -euo pipefail

REPO_NAME="${1:-neon-parkour}"
BRANCH="main"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf '\033[36m%s\033[0m\n' "$*"; }
ok()  { printf '\033[32m✓ %s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 前置检查
command -v git >/dev/null || die "没找到 git"

# 找到可用的 gh（Windows 上是 gh.exe，Git Bash 里 command -v gh 匹配不到）
GH_BIN="${GH_BIN:-}"
if [ -z "$GH_BIN" ]; then
  for c in gh gh.exe; do
    if command -v "$c" >/dev/null 2>&1; then GH_BIN="$c"; break; fi
  done
fi
if [ -z "$GH_BIN" ]; then
  cat <<'EOF' >&2
没找到 GitHub CLI（gh）。先装一个，任选一种：
  winget install --id GitHub.cli -e
  scoop install gh
  choco install gh
安装后重开终端，再执行： gh auth login
（也可以把 gh 可执行文件放在 PATH 里，或用 GH_BIN=/路径/gh 指定）
EOF
  exit 1
fi
gh() { "$GH_BIN" "$@"; }        # 统一入口，兼容 gh / gh.exe

gh auth status >/dev/null 2>&1 || die "还没登录 GitHub，请先执行： gh auth login"

OWNER="$(gh api user --jq .login)"
say "GitHub 账号: $OWNER"

# ---------------------------------------------------------------- 本地提交
[ -d .git ] || { say "初始化本地仓库…"; git init -q -b "$BRANCH"; }
if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  git add -A
  git -c user.name="${GIT_AUTHOR_NAME:-$(git config user.name || echo runner)}" \
      -c user.email="${GIT_AUTHOR_EMAIL:-$(git config user.email || echo runner@example.com)}" \
      commit -q -m "feat: 霓虹跑酷 NEON PARKOUR —— 3D 霓虹卡通跑酷" || die "提交失败"
  ok "已创建首个提交"
else
  say "已有提交历史，跳过初始提交"
fi

# ---------------------------------------------------------------- 创建 / 关联远端
if gh repo view "$OWNER/$REPO_NAME" >/dev/null 2>&1; then
  say "远端仓库已存在：$OWNER/$REPO_NAME"
  git remote get-url origin >/dev/null 2>&1 || \
    git remote add origin "https://github.com/$OWNER/$REPO_NAME.git"
else
  say "创建公开仓库 $OWNER/$REPO_NAME …"
  gh repo create "$REPO_NAME" --public --source=. --remote=origin \
    --description "3D 霓虹卡通跑酷小游戏：浅色小清新画面 + 赛博朋克霓虹，纯前端无外部资源，双击即玩"
fi

say "推送代码到 $BRANCH …"
git push -u origin "$BRANCH"

# ---------------------------------------------------------------- 开启 Pages
say "开启 GitHub Pages …"
if gh api "repos/$OWNER/$REPO_NAME/pages" >/dev/null 2>&1; then
  say "Pages 已开启，直接重新触发构建"
  gh api -X POST "repos/$OWNER/$REPO_NAME/pages/builds" >/dev/null 2>&1 || true
else
  gh api -X POST "repos/$OWNER/$REPO_NAME/pages" \
    -f "source[branch]=$BRANCH" -f "source[path]=/" >/dev/null \
    || die "开启 Pages 失败（可能需要在仓库 Settings → Pages 手动选择 main 分支）"
fi
ok "Pages 已配置为 $BRANCH 分支根目录"

# ---------------------------------------------------------------- 等待上线
URL="https://$OWNER.github.io/$REPO_NAME/"
say "等待站点上线：$URL（最多约 3 分钟）"
for i in $(seq 1 36); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -L --max-time 15 "$URL" || true)"
  if [ "$CODE" = "200" ]; then
    ok "已上线！把这个网址发给朋友即可开玩："
    echo
    echo "    $URL"
    echo
    echo "  仓库地址: https://github.com/$OWNER/$REPO_NAME"
    exit 0
  fi
  printf '  第 %2d 次探测: HTTP %s\n' "$i" "${CODE:-000}"
  sleep 5
done

printf '\033[33m! 还没探测到 200。GitHub Pages 首次部署偶尔要几分钟，稍后再打开上面的网址看看。\033[0m\n'
exit 0
