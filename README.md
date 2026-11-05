# tutlab

tutlab 的课后 30 秒垂直切片：教师查看今日课次、完成点名与课时扣减，再把一段课堂口述整理成家长草稿、学管关注和教学记录。管理员可以临时切换到同校区教师视角，所有模拟操作保留审计记录。

向上衔接的一步是试听与排课：admin 在 `/students` 管理本人名下的学生，manager 可查看全部学生；admin/manager 可安排试听和正式课。`/schedule` 是所有角色共享的 7 天日历，admin/manager 登录后首先进入日历。试听只加入课次名单且不扣课时，正式课可同时将学生加入班级；教师时间冲突由数据库约束阻止。

## 1. 如何跑起来

### 本地地址

| 服务 | 地址 |
|---|---|
| Web | http://localhost:5173 |
| Worker API | http://127.0.0.1:8787/api |
| Supabase API | http://127.0.0.1:54421 |
| Supabase Studio | http://127.0.0.1:54423 |

本项目使用 544xx 端口，避免与本机其他 Supabase 项目的 543xx 端口冲突。

### 准备环境变量

```bash
cp .env.example .env
corepack pnpm install
```

| 变量 | 获取位置与用途 |
|---|---|
| `APP_NAME` | 固定为 `tutlab`。 |
| `APP_TZ` | 固定为 `Australia/Melbourne`，用于计算“今天”和课次时间。 |
| `SUPABASE_URL` | 本地为 `http://127.0.0.1:54421`；远程在 Supabase Dashboard → Project Settings → API。 |
| `SUPABASE_ANON_KEY` | 同一 API 设置页的 anon public key，只允许前端使用。 |
| `SUPABASE_SERVICE_ROLE_KEY` | 同一 API 设置页的 service role secret，只注入 Worker。 |
| `SUPABASE_JWT_SECRET` | Supabase Dashboard → API → JWT Settings，供 Worker 验证和签发 HS256 令牌。 |
| `SUPABASE_DB_URL` | 本地默认 `postgresql://postgres:postgres@127.0.0.1:54422/postgres`；远程在 Database → Connection string。 |
| `VITE_SUPABASE_URL` | 浏览器访问的 Supabase 地址，与 `SUPABASE_URL` 对应。 |
| `VITE_SUPABASE_ANON_KEY` | 与 `SUPABASE_ANON_KEY` 相同的 anon key。 |
| `VITE_API_BASE_URL` | 本地 `http://127.0.0.1:8787`；生产留空，使用 Pages 同源 `/api`。 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard 右侧的账户 ID，仅部署需要。 |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Tokens；Pages/Workers Edit，绑定自定义域名时再增加 Zone DNS Edit。 |
| `CF_PAGES_PROJECT` | 固定为 `tutlab`。 |
| `CF_WORKER_NAME` | 固定为 `tutlab-api`。 |
| `DEEPSEEK_API_KEY` | https://platform.deepseek.com → API Keys，只注入 Worker。留空可演示 fallback。 |
| `DEEPSEEK_BASE_URL` | 默认 `https://api.deepseek.com`。 |
| `DEEPSEEK_MODEL` | 默认 `deepseek-flash`，可按账户可用模型调整。 |
| `LLM_TIMEOUT_MS` | LLM 请求超时，默认 12000 毫秒。 |
| `LLM_MAX_TOKENS` | LLM 最大输出 token，默认 2000。 |
| `LLM_TEMPERATURE` | 默认 0.2。 |
| `IMPERSONATION_TTL_MIN` | 模拟令牌有效分钟数，默认 30，不能续期。 |
| `WEB_PORT` / `API_PORT` | 本地端口，默认 5173 / 8787。 |
| `DEBUG_LLM` | 调试开关，默认 false；不会把 service role 数据返回客户端。 |
| `SEED_PASSWORD` | 本地演示密码，默认 `Passw0rd!`；生产删除 seed 变量。 |
| `SEED_*_EMAIL` | 本地 seed 登录邮箱，统一使用 `@tutlab.local`。 |

`.env` 已在 `.gitignore` 中。不要把 service role、JWT secret 或 DeepSeek key 写入源码，也不要提交 `.env`。

### Docker 启动

需要 Docker 和启用了 Corepack 的 Node.js；Supabase CLI 已作为项目开发依赖安装。首次运行先启动 Supabase，并把输出中的 `ANON_KEY`、`SERVICE_ROLE_KEY`、`JWT_SECRET` 分别填入 `.env` 的对应变量（两个 VITE 变量只使用 anon key）：

```bash
corepack pnpm supabase start
```

随后 Supabase Postgres/Auth/Studio 与 Web/API 均通过 Docker 运行：

```bash
make dev
```

等价于：

```bash
corepack pnpm supabase start
corepack pnpm supabase db reset
docker compose up
```

单独重建演示数据、停止服务：

```bash
make seed
make down
```

seed 会按 Melbourne 当天生成 Kevin 的 15:00、17:00 两节课和 Lisa 的 19:00 一节课；Amy 当天没有课。重置数据库会清空本地业务数据。

### 演示账号

密码统一为 `Passw0rd!`。

| 角色 | 邮箱 | 演示内容 |
|---|---|---|
| manager | `boss@tutlab.local` | 跨校区教师视角切换、关注列表 |
| admin | `kiki@tutlab.local` | City 校区教师视角切换、关注列表 |
| admin | `jason@tutlab.local` | Mt Waverley 校区权限验证 |
| teacher | `kevin@tutlab.local` | 今日两节课、点名、反馈 |
| teacher | `lisa@tutlab.local` | 今日一节课、跨教师权限验证 |
| teacher | `amy@tutlab.local` | 今日无课空状态 |

### 部署

当前生产地址：Web 为 `https://tutlab.pages.dev`，同源 API 为 `https://tutlab.pages.dev/api`，Supabase 为 `https://humaqrgedzyscdpnayxb.supabase.co`。Pages Function 通过 Service Binding 在 Cloudflare 内部调用 `tutlab-api`，避免公网中转以及部分网络无法访问 `workers.dev` 的问题。重新部署 Web 时将 `VITE_API_BASE_URL` 留空并重新构建。

```bash
# API secrets
cd apps/api
corepack pnpm wrangler secret put SUPABASE_SERVICE_ROLE_KEY
corepack pnpm wrangler secret put SUPABASE_JWT_SECRET
corepack pnpm wrangler secret put DEEPSEEK_API_KEY
corepack pnpm wrangler deploy

# Web（VITE_API_BASE_URL 留空，使用 Pages 同源代理）
cd ../..
corepack pnpm --filter web build
cd apps/web
../api/node_modules/.bin/wrangler pages deploy dist --project-name=tutlab --branch=main
```

生产 Supabase 需先应用 `supabase/migrations`，演示环境才执行 `supabase/seed.sql`。

## 只用 curl 复现破坏测试

以下命令要求本机有 `curl`、`jq`，并已在项目根目录加载环境变量：

```bash
set -a
source .env
set +a

login () {
  curl -sS "$VITE_SUPABASE_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $VITE_SUPABASE_ANON_KEY" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"Passw0rd!\"}" | jq -r '.access_token'
}

KEVIN=$(login kevin@tutlab.local)
LISA=$(login lisa@tutlab.local)
KIKI=$(login kiki@tutlab.local)
TODAY=$(TZ=Australia/Melbourne date +%F)
```

### 1. 教师 A 访问教师 B 的课次：403

```bash
LISA_SESSION=$(curl -sS -H "Authorization: Bearer $LISA" \
  "$VITE_API_BASE_URL/api/today?date=$TODAY" | jq -r '.sessions[0].id')

curl -i -H "Authorization: Bearer $KEVIN" \
  "$VITE_API_BASE_URL/api/sessions/$LISA_SESSION"
# HTTP 403，error.code = FORBIDDEN_NOT_OWNER
```

### 2. 传入别班学生：422 NOT_IN_ROSTER

先从 Lisa 课次取得一个学生，再提交到 Kevin 的课次：

```bash
OTHER_STUDENT=$(curl -sS -H "Authorization: Bearer $LISA" \
  "$VITE_API_BASE_URL/api/sessions/$LISA_SESSION" | jq -r '.roster[0].student_id')
KEVIN_SESSION=$(curl -sS -H "Authorization: Bearer $KEVIN" \
  "$VITE_API_BASE_URL/api/today?date=$TODAY" | jq -r '.sessions[0].id')

curl -i -X PUT -H "Authorization: Bearer $KEVIN" \
  -H 'content-type: application/json' \
  "$VITE_API_BASE_URL/api/sessions/$KEVIN_SESSION/attendance" \
  -d "{\"items\":[{\"student_id\":\"$OTHER_STUDENT\",\"status\":\"present\"}]}"
# HTTP 422，error.code = NOT_IN_ROSTER
```

### 3. 余额不足：422 且余额不变

选择 Kevin 课次中 `balance` 为 0 的学生，先记录 GET 返回值，再执行：

```bash
ZERO_STUDENT=<余额为0的学生UUID>
curl -i -X PUT -H "Authorization: Bearer $KEVIN" \
  -H 'content-type: application/json' \
  "$VITE_API_BASE_URL/api/sessions/$KEVIN_SESSION/attendance" \
  -d "{\"items\":[{\"student_id\":\"$ZERO_STUDENT\",\"status\":\"present\"}]}"
# HTTP 422，error.code = INSUFFICIENT_CREDITS；重新 GET，balance 不变
```

余额 1 首次出席会合法扣到 0；余额 0 才拒绝继续扣减。扣减只由 Postgres `mark_attendance` 函数完成。

### 4. 重复提交：幂等

```bash
STUDENT=$(curl -sS -H "Authorization: Bearer $KEVIN" \
  "$VITE_API_BASE_URL/api/sessions/$KEVIN_SESSION" | jq -r '.roster[0].student_id')
BODY="{\"items\":[{\"student_id\":\"$STUDENT\",\"status\":\"leave\"}]}"

curl -sS -X PUT -H "Authorization: Bearer $KEVIN" -H 'content-type: application/json' \
  "$VITE_API_BASE_URL/api/sessions/$KEVIN_SESSION/attendance" -d "$BODY"
curl -sS -X PUT -H "Authorization: Bearer $KEVIN" -H 'content-type: application/json' \
  "$VITE_API_BASE_URL/api/sessions/$KEVIN_SESSION/attendance" -d "$BODY"
# 两次返回相同 deducted / balance_after，不新增第二次扣费流水
```

### 5. 教师调用视角切换：403

```bash
curl -i -X POST -H "Authorization: Bearer $KEVIN" \
  -H 'content-type: application/json' "$VITE_API_BASE_URL/api/impersonate" \
  -d "{\"teacher_id\":\"$(curl -sS -H "Authorization: Bearer $LISA" "$VITE_API_BASE_URL/api/me" | jq -r .id)\"}"
# HTTP 403
```

### 6. 嵌套模拟：403 NESTED_IMPERSONATION

```bash
KEVIN_ID=$(curl -sS -H "Authorization: Bearer $KEVIN" "$VITE_API_BASE_URL/api/me" | jq -r .id)
IMPERSONATION=$(curl -sS -X POST -H "Authorization: Bearer $KIKI" \
  -H 'content-type: application/json' "$VITE_API_BASE_URL/api/impersonate" \
  -d "{\"teacher_id\":\"$KEVIN_ID\"}")
SIM_TOKEN=$(printf '%s' "$IMPERSONATION" | jq -r .token)

curl -i -X POST -H "Authorization: Bearer $SIM_TOKEN" \
  -H 'content-type: application/json' "$VITE_API_BASE_URL/api/impersonate" \
  -d "{\"teacher_id\":\"$KEVIN_ID\"}"
# HTTP 403，error.code = NESTED_IMPERSONATION
```

### 7. LLM 不可用：HTTP 200 + fallback

临时以空 key 重建 API 容器，不影响数据库：

```bash
DEEPSEEK_API_KEY= docker compose up -d --force-recreate api
curl -sS -X POST -H "Authorization: Bearer $KEVIN" \
  -H 'content-type: application/json' "$VITE_API_BASE_URL/api/sessions/$KEVIN_SESSION/feedback" \
  -d '{"raw_text":"今天复习了三角函数，陈小明周期计算错了三道。"}'
# HTTP 200，status = fallback，parsed = null，raw_id 已保存
# 恢复：docker compose up -d --force-recreate api
```

## 2. AI 工具使用与未采纳建议

- 使用编码 AI 协助整理数据库迁移、RLS、事务函数、Hono API、React 页面、LLM 输出校验、Docker 配置和本文档；实现后通过 TypeScript、ESLint 和 curl 场景检查关键约束。
- DeepSeek 只用于 `POST /api/sessions/:id/feedback`：输入教师原文与必要的学生 ID/姓名，输出结构化课堂反馈。key 永不进入浏览器。
- 未采纳“把余额 1 出席直接判为不足”的建议：它与非负流水约束冲突。正确行为是扣到 0，余额 0 时才拒绝。
- 未采纳“家长草稿直接调用外部发送服务”的建议：本切片只在二次确认后把状态改为 `sent`，实际发送仍由人工完成。

## 3. 已知不足

以下内容对应 `AGENT_DESIGN.md` §8.5：

- 排班没有界面，冲突约束只在数据库层
- 课时的有效期、退费折算没做，只保证“不为负”
- 家长消息不能直接发，要手工复制
- 没有多校区隔离，“跨校区只看占用不看是谁”这条没实现
- 单老师视角没有做“代课”，请假走停课

## 提交前检查

排课专项回归（先启动本地 Supabase 和 API）：

```bash
bash scripts/verify-scheduling.sh
```

完整检查：

```bash
corepack pnpm -r typecheck
corepack pnpm -r lint
cmp theme.css apps/web/src/styles/theme.css
git status --short
```

`.env` 不应出现在 Git 变更中。
