# DESIGN.md

> TutLab · 学生管理系统
> 垂直切片：**学管安排试听与课程 → 老师课后的 30 秒**

## 1. 业务目标

信息在一个人手里产生后，下一个人需要时仍能看见：

- 学管安排试听和正式课，老师马上能在共享日历中看到。
- 老师完成点名，课时流水和余额同步更新。
- 老师留下课堂口述，家长、学管和下一位老师分别得到可读的信息。

| 角色 | 核心任务 |
|---|---|
| admin（学管） | 管理本人学生、安排试听和课程、处理风险 |
| teacher（老师） | 看共享日历和今日课次、点名、写课堂反馈 |
| manager（主管） | 查看全部学生和课次、处理风险、切换教师视角 |
| 家长（不登录） | 收到一句课堂事实和一个明确动作 |

时区固定为 `Australia/Melbourne`。

## 2. 垂直切片

本版从原“课后 30 秒”向上扩展一步，但不扩展成笨重的教务系统：

1. 学管在学生列表选择学生，安排试听或正式课。
2. 所有人通过 7 天共享日历看到结果。
3. 老师进入自己的课次，点名并扣课时。
4. 老师粘贴一段课堂口述，生成家长草稿、学管关注和教学记录。

原则：**做了简化排课，但不被琐碎排课逻辑绊脚。** 只保留学生归属、试听、入班、名单和教师冲突这几条关键规则。

## 3. 做与不做

### 这一版做

- admin 只管理 `service_owner_id` 属于自己的学生，manager 查看全部学生。
- 学生列表显示年级、状态、课时余额和有效班级。
- 7 天共享日历展示全部班级、教师、校区和课次。
- admin/manager 安排试听和正式课：
  - 试听必须选学生，不创建正式入班记录，不扣课时，每生仅一次。
  - 正式课可指定学生入班，也可直接安排整个班。
  - 新入班、课次和名单由 `schedule_session` 在一个数据库事务中完成。
- 教师只能进入自己的课次详情；共享日历不包含学生隐私。
- 出席/缺席各扣 1 课时，请假/试听不扣；重复考勤幂等，改状态写补偿流水。
- 一处 LLM：课堂口述生成结构化反馈、家长草稿和关注信号。
- 家长消息支持 `draft / sent`，`sent` 前二次确认，不调用外部发送服务。
- admin/manager 可切换到教师视角，使用短时令牌并保留审计。
- 加载骨架、空状态指引、可重试错误、移动端布局和明暗主题。

### 明确不做

- 学生新增、编辑、删除和批量导入。
- 班级新增、编辑、删除及复杂排班规则。
- 月历、课次编辑/取消、代课、停补课和复杂冲突协商。
- 续费单、退费折算、课时有效期和完整财务流程。
- 家长消息真实发送、第三方 IM 集成。
- 多校区数据隔离、报表、图表和学情时间线。

这些功能当前不会帮助验证核心闭环，因此不增加页面或接口。

## 4. 数据模型与关键规则

沿用既有表，不为简化排课新增业务表：

- `students / parents / profiles`：学生、家长和学管归属。
- `courses / classes / class_slots`：课程、班级和固定时段。
- `enrollments`：学生与班级的一段有效关系。
- `sessions / session_students`：具体课次与本节名单。
- `attendance / credit_ledger`：考勤凭据和课时流水。
- `feedback_raw / student_feedback / student_notes / parent_messages / concerns`：课堂反馈的三种用途。
- `impersonation_log`：教师视角切换审计。

关键规则：

| 规则 | 执行位置 |
|---|---|
| 老师只能读写自己的课次详情 | API + RLS |
| 共享日历所有登录角色可读，但不返回学生名单 | API |
| admin 只能操作本人学生，manager 可操作全部 | API + RLS |
| 同一学生同一班级只有一条有效入班记录 | partial unique index |
| 每名学生只能有一次试听 | `session_students` partial unique index |
| 教师同刻不能有两节课 | `sessions` EXCLUDE 约束 |
| 排课、入班和名单原子完成 | `schedule_session` 事务函数，仅 service_role 执行 |
| 扣课时唯一入口 | `mark_attendance` 事务函数，仅 service_role 执行 |
| 余额不能为负 | 事务锁 + `balance_after >= 0` |
| 相同考勤重复提交不新增流水 | 数据库幂等判断 |
| 出席改请假等状态变化 | 数据库写入 `adjust` 补偿流水 |
| 课次结束 48 小时后不可改考勤 | `SESSION_LOCKED` |
| 模拟令牌不可嵌套、不可续期 | Worker + `impersonation_log` |
| 家长消息真实发送不在系统内完成 | 前端确认后只修改 `state` |

排课时间还必须晚于当前时间，时长为 15 分钟至 4 小时。所有写操作都在服务端校验，不能依赖前端隐藏按钮。

## 5. 页面与使用方式

| 页面 | 角色 | 用途 |
|---|---|---|
| `/login` | 全部 | Supabase 邮箱登录，按角色进入首页 |
| `/schedule` | 全部 | 共享 7 天日历；admin/manager 首页，可安排试听/课程 |
| `/students` | admin / manager | 查看本人或全部学生，并发起排课 |
| `/today` | teacher | 查看今天的人数、新生和课次 |
| `/session/:id` | teacher | 同屏完成点名、课时确认和反馈 |
| `/concerns` | admin / manager | 查看并处理未解决风险 |

排课弹窗只有类型、学生、班级、开始时间和结束时间。日历不做复杂筛选；教师只可从自己的课次进入详情。

## 6. LLM 设计

- 仅在 `POST /api/sessions/:id/feedback` 内调用 DeepSeek。
- 当前模型为 `deepseek-flash`，key 只存在 Worker。
- 输入只有老师原文、学生 ID 和姓名，不包含家长联系方式。
- 输出包括 `covered / per_student / homework / class_note / parent_messages / concerns`。
- 服务端验证学生名单、枚举、数组长度、文本长度和商业承诺词。
- 名单外记录丢弃并返回 `unmatched`；不合规家长话术用固定模板兜底。
- 超时、非 200、JSON 不完整时保存原文并返回 `fallback`，前端显示手工表单。
- 当前请求参数：12 秒超时、2000 max tokens、temperature 0.2。

## 7. 技术结构与性能

- Web：Vite、React 18、strict TypeScript、React Router、TanStack Query。
- API：Cloudflare Worker、Hono、Zod。
- 数据与认证：Supabase Postgres、Auth、RLS。
- 部署：Cloudflare Pages + Workers；Pages Function 通过 Service Binding 内部调用 API。
- 普通请求跳过模拟签名自检；鉴权资料缓存 60 秒且不晚于令牌过期。
- Supabase 单次请求有 10 秒超时，避免异常网络下无限等待。

## 8. 演示数据与验收

Seed 包含 6 个账号、36 名学生、6 个班和 14 个课次，邮箱统一为 `@tutlab.local`，密码统一为 `Passw0rd!`。

重点演示：

- Kevin 今天两节课，Lisa 一节，Amy 没有课。
- 陈小明是新生，林试听是试听生，李 Amy 余额为 0，Tom 有 `risk` 关注。
- admin 学生归属隔离、共享日历、试听仅一次、正式入班和教师冲突。
- 重复考勤幂等、余额不足、48 小时锁定、跨教师 403、别班学生 422。
- DeepSeek 成功生成结构化反馈；关闭 key 时进入手工 fallback。
- 教师视角切换、审计、返回原账号和令牌过期处理。

本地专项回归：`bash scripts/verify-scheduling.sh`。

## 9. 已知不足

- 排课只有创建和共享查看，没有课次编辑、取消、代课和停补课。
- 学生列表只有查看与排课，没有学生 CRUD。
- 课时有效期和退费折算未实现，只保证流水不为负。
- 家长消息需要人工复制发送，`sent` 只是人工确认状态。
- 没有多校区隔离和报表分析。
