# tutlab

tutlab 是一个从「学管安排试听与课程」到「老师课后 30 秒」的学生管理切片：共享排课日历、学生归属、点名扣课时、AI 课堂反馈和关注处理。

## 技术栈与线上地址

| 部分 | 技术 / 地址 |
|---|---|
| Web | Vite、React 18、strict TypeScript、TanStack Query |
| API | Cloudflare Worker、Hono、Zod |
| 数据与认证 | Supabase Postgres、Auth、RLS |
| AI | DeepSeek `deepseek-flash`，仅在 Worker 调用 |
| 线上 Web | https://tutlab.pages.dev |
| 线上 API | https://tutlab.pages.dev/api（Pages 通过 Service Binding 内部调用 Worker） |
| 线上 Supabase | https://humaqrgedzyscdpnayxb.supabase.co |

项目文档见 [`DESIGN.md`](./DESIGN.md)。

## 功能使用

| 页面 | 角色 | 怎么使用 |
|---|---|---|
| `/schedule` | 全部角色 | 查看共享 7 天日历；学管可点「安排试听 / 安排课程」 |
| `/students` | admin / manager | 查看学生余额、状态和班级，从学生行直接排课 |
| `/today` | teacher | 查看今天的课次、人数和新生，点「开始」进入课次 |
| `/session/:id` | teacher | 同屏完成点名、课时确认、AI 反馈和手工编辑 |
| `/concerns` | admin / manager | 查看未解决风险，处理后点「已处理」 |

### 排课规则

- admin 只能操作本人名下学生，manager 可操作全部学生。
- 新建试听只包含选中的学生；已有课程卡片上的「加入试听」可把学生加入该课次，不新建课程。
- 试听每生只能一次，不创建正式入班记录、不扣课时。
- 正式课选择学生时为单人课次，不选学生时才安排整个班。
- 新入班、课次和名单在同一事务中生成；教师时间冲突会被拒绝。
- 关注列表动态显示低余额：1–3 课时为 `watch`，0 课时为 `risk`，充值后自动消失，无需手动处理。
- 所有角色都能看共享日历，但只有老师能进入自己的课次详情。

### 考勤与反馈规则

- 出席、缺席各扣 1 课时；请假、试听不扣。
- 相同考勤重复提交不会重复扣费，改状态由数据库写补偿流水。
- AI 生成家长版、学管版、教学版；不可用时自动切换到手工表单。
- 家长消息先复制并人工发送，再点「发送」二次确认，系统只把状态改为 `sent`。

## 演示账号

密码统一为 `Passw0rd!`。

| 账号 | 角色 | 适合验证 |
|---|---|---|
| `kiki@tutlab.local` | admin | 本人学生、排课、关注、教师视角切换 |
| `jason@tutlab.local` | admin | 学生归属隔离 |
| `boss@tutlab.local` | manager | 全部学生、跨校区视角切换 |
| `kevin@tutlab.local` | teacher | 今天两节课、点名和 AI 反馈 |
| `lisa@tutlab.local` | teacher | 今天一节课、共享日历 |
| `amy@tutlab.local` | teacher | 今天无课的空状态 |

## 推荐测试流程

### 1. 学管排试听与正式课

1. 用 Kiki 登录，默认进入 `/schedule`。
2. 打开 `/students`，确认只看到本人名下学生；换 Jason 登录可看到不同名单。
3. 选择一名未试听学生，点「安排试听」，选择班级和未来时间并确认。
4. 回到日历查看新课次；再次给该学生安排试听，应提示已有试听记录。
5. 找一节已有的待上课程，点「加入试听」并选择另一名未试听学生；不新建课程，只在该课次名单中增加试听生。
6. 点「安排课程」，选择学生、班级和未来时间，应只生成该学生的课次；不选学生时才生成整班课次。
7. 在同一教师、同一时段再排一节，应提示教师时间冲突。

### 2. 共享日历与空状态

- 分别用 Kevin、Lisa 登录 `/schedule`，看到的共享课次一致；只能进入自己的课次。
- 用 Amy 登录 `/today`，应看到「这一天没有课」及下一步指引。
- 切换上一周、本周、下一周，确认日期范围和周日课次完整显示。

### 3. 点名与课时

1. 用 Kevin 登录 `/today`，进入第一节课。
2. 标记 4 人出席、1 人请假，试听生保持试听：出席各扣 1，其他不扣。
3. 重复提交相同考勤，余额不再次变化。
4. 进入 Y10 数学课，给余额为 0 的李 Amy 标出席，应被拒绝且余额不变；可改请假或联系 admin 充值。

### 4. AI 与手工反馈

1. 在课次下方粘贴课堂口述，点「生成结构化反馈」。
2. 应返回知识点、学生观察、家长草稿和关注项；可编辑后保存。
3. 复制家长消息，确认已人工发送后点「发送」，状态变为 `sent`。
4. 本地测试 fallback 时，将 `DEEPSEEK_API_KEY` 留空并重启 API，应返回原文和手工表单，而不是报错中断。

### 5. 关注与教师视角切换

- 用 Kiki 或 Boss 打开 `/concerns`，可看到 Tom 的风险并标记已处理；余额 1–3 课时显示 `watch`，余额 0 显示 `risk`，纯低余额项没有「已处理」按钮，充值后自动消失。
- 用 Kiki 在右上角切换到 Kevin：出现不可关闭横幅和剩余时间，可正常点名；点「返回我的账号」恢复原视图。
- 用 Boss 切换到 Amy，可验证跨校区空状态。

### 6. 权限与异常回归

重点确认：跨教师访问为 403、别班学生为 422、余额不足为 422、旧课次为 423、重复考勤不新增流水、模拟令牌不能嵌套。

本地排课专项脚本会自动验证学生归属、共享日历、试听仅一次、正式入班和教师冲突：

```bash
make seed
bash scripts/verify-scheduling.sh
```

## 本地运行与检查

需要 Docker 和启用 Corepack 的 Node.js。首次启动：

```bash
cp .env.example .env
corepack pnpm install
corepack pnpm supabase start
```

把启动输出的本地 `ANON_KEY`、`SERVICE_ROLE_KEY`、`JWT_SECRET` 填入 `.env`，然后运行：

```bash
make dev
```

Web 为 http://localhost:5173。`make dev` 会重建本地演示数据；只重置数据用 `make seed`，停止用 `make down`。

提交前检查：

```bash
corepack pnpm -r typecheck
corepack pnpm -r lint
corepack pnpm --filter web build
cmp theme.css apps/web/src/styles/theme.css
```

## 已知限制

- 不支持学生 CRUD、班级 CRUD、月历、课次编辑/取消、代课和停补课。
- 课时有效期与退费折算未实现。
- 家长消息需要人工发送，`sent` 只是确认状态。
- 没有多校区隔离、报表和学情时间线。
