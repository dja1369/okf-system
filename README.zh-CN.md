# OKF for Claude Code

**把过去 Claude Code 会话中的决定变成下一次会话真正能使用的、本地且可审查的知识库。**

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · **简体中文** · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md)

OKF 在会话结束时无损捕获对话，把可复用的决定和故障处理提炼为 Markdown，并在下次会话注入紧凑索引。知识库是你可以查看、diff、备份或删除的本地 git 仓库。

## 一分钟快速开始

需要支持插件的 Claude Code、Node.js 和 git；无需 `npm install`。

```sh
claude plugin marketplace add dja1369/okf-system
claude plugin install okf@okf-marketplace
```

重启 Claude Code，正常结束一次会话，然后运行：

```text
/okf:okf-status
/okf:okf-index
```

首次 `SessionStart` 会创建 `~/.claude/okf`（或 `$CLAUDE_CONFIG_DIR/okf`）。此后的收集和机会式 batch ingest 都自动进行；对话会在最后一次活动约 1 小时后被收集，因此无需显式结束会话。

## 连续性流程

```text
会话 1                  ~1 小时空闲               后台 batch                  会话 2
做出决定          ->    sweep 收集 raw   ->      提炼出可复用的 OKF Markdown ->  注入紧凑索引
（无需显式结束             （无损复制；                  |                            |
 会话）                    有增长会重新收集）           +-- 本地 git 历史            +-- Read 相关 concept
```

为什么基于空闲判定？会话很少会显式结束——后台 agent 更是从不会——而过去在 `resume` 时抓取快照的做法会把会话中途冻结为“已处理”，之后说的内容就此丢失。因此 sweep 会在会话安静了 `sweep_min_idle_minutes`（默认 60 分钟）之后才收集它；batch 进程会持续轮询直到待处理会话进入空闲（约每 5 分钟一次，最长 8 小时）；已收集的会话只有在之后又增长时才会被**再次**收集；未变化的会话永远不会被重新收集。会话钩子只是唤醒 batch。

例如，会话 1 确定“按 10% → 50% → 100% 发布，错误率超过 0.5% 时回滚”。capture 和 ingest 后，新会话无需用户再次粘贴即可通过索引找到准确政策。索引只是路由层；Claude 在执行前仍需 `Read` concept 正文。

## 命令

| 命令 | 用途 |
|---|---|
| `/okf:okf-status` | 最近一次 batch、待处理会话和锁状态 |
| `/okf:okf-batch` | 在尊重锁的前提下立即 ingest |
| `/okf:okf-config` | 查看或编辑经过验证的配置 |
| `/okf:okf-index` | 查看分类、concept 标题和最近变更 |
| `/okf:okf-visualize` | 仅显示 OKF concept 与 concept 之间的关系 |
| `/okf:okf-analysis [路径]` | 分析代码库，并只显示相关 OKF concept |
| `/okf:okf-deprecate <目标>` | 退役一个 concept —— 文件和链接保留，gate 不再注入它 |

`visualize` 不扫描代码库。`analysis` 会拒绝不存在或非目录的路径，显示 truncated、被隐藏的无关 concept，以及各语言的文件/声明/internal edge 统计。两者生成的 HTML 均自包含，不使用外部 CDN，也不在运行时联网。

## 可选状态栏

`bin/statusline.mjs` 不联网、不分析完整图，只输出如 `OKF 12 · +3 · 2h ago` 的一行状态。Claude Code 只允许一个 `statusLine`，因此 OKF 不自动安装或覆盖它。可在现有脚本中追加 `node /path/to/okf/bin/statusline.mjs` 的输出。

## OKF 基准测试

<!-- okf-benchmark: 2026-07-26-e3 -->

### 门控 recall@cap — 三轮预注册测量，E1 → E3 (2026-07-26)

三轮的成本都是 **$0.00**，这不是声明而是由运行本身证明的：测量装置会在 `PATH` 最前面放一个桩
`claude`，实测该桩存在，而这个桩从未被执行过（`paidCallTrapInstalled: true`，
`paidCallTrapTripped: false`）。

它测量的是 `recall(N)` —— 当 bundle 中有 N 个 concept 时，20 个冻结问题中，其答案 concept 的那
一行能存活进门控实际注入的 index 的比例。

> **recall 不是正确率。** 它只回答「门控是否载入了相关的行」。模型是否**使用**了那一行，没有付费
> 调用就无法验证。合成干扰项只给出**上界**，因此真实场景中的 recall 更低。

**条件** —— 3 种扰动 × 5 个层级 × 20 个种子 = 300 个样本，28 秒。只在答案 concept 的 frontmatter
**`title`** 前加 4 个字符，正文、文件名、路径都不改动。

| N | `none` | `front` (`!!! `) **已发布版** | `front` **引号安全版** | `back` (`힣힣 `) |
|---|---|---|---|---|
| 24 | 0.400 ± 0.000 | 1.000 ± 0.000 | **0.400** | 0.400 ± 0.000 |
| 50 | 0.277 ± 0.038 | 0.560 ± 0.064 | **0.400** | 0.182 ± 0.044 |
| 100 | 0.247 ± 0.034 | 0.523 ± 0.030 | **0.400** | 0.170 ± 0.025 |
| 200 | 0.250 ± 0.040 | 0.528 ± 0.030 | **0.400** | 0.175 ± 0.026 |
| 400 | 0.262 ± 0.039 | 0.533 ± 0.024 | **0.400** | 0.185 ± 0.024 |

每格 n=20。E1 只跑了 `none`，预算小 11 B，得到 0.400 / 0.277 / 0.245 / 0.248 —— 那是**另一个条件**，
既不比上表好也不比它差。

**已发布版的 `front` 列是被污染的，而抓住它的正是这一列自己的守卫。** `!!!` 是 YAML 的**标签指示符**。
把它加到没有引号的 `title:` 前面，会让整个 frontmatter 解析失败：type 丢失，链接文本回退成文件名，
**description 整个消失**，行长从约 700 B 塌缩到约 30 B。**20 个冻结问题中有 14 个的 title 没有引号。**
也就是说在那 14 个上，这个实验测的不是排序位置而是**解析失败** —— 行短了，同样的预算就能装下多得多
的行，这正是 N=24 时观测到的 `taken` 24 和行平均 263 B。改用引号安全的前缀重测，`front` 塌缩成
**全层级 0.400 的平坦线**。`none` 和 `back` 一位数都没动，这既确认了修正是中性的，也说明 `힣힣 `
从未破坏过任何东西。

**什么留下来，什么倒下。** 排序决定存活这一点没有变。N=400 时引号安全版的 spread 是
0.400 − 0.185 = **0.215**，仍是反驳阈值 0.05 的 **4.3 倍**；`back` 把 recall 从 0.262 压到 0.185，
这是纯粹的顺序效应。**在一个相关性信号为零的系统里，这是预期的结果，而不是发现了 bug** —— 新的是
它的量级。但已发布的三个量级没能留下来：「4 个字符让 recall 翻倍」是 2.03 倍 → **1.53 倍**；
「N=24 从 0.400 到 1.000」变成**没有变化**；E1 的 `cwdIndependent` 从 0.000 → 0.967 变成
**0.000 → 0.333**。取而代之出现了一个新事实：**当 concept 排到前面时，recall 就完全不再依赖 N**
（在 bundle 规模 17 倍的范围内都是 0.400 的平坦线）—— 因为那时决定存活的是 `taken` 而不是 N。

**存活条件精确地就是 `rank < taken`** —— 只有当一个 concept 在其类别内的 title 排序名次小于该类别
实际载入的行数时，它才存活。因此 recall 是 rank 与 `taken` 两个向量的**完全**函数，可以无近似地分解。
在 N=24→50 阶段 rank 分量占主导（−0.15 ~ −0.41）；在 N≥100 时它衰减到 ~0，这是地板效应：答案的
平均 rank（26.9）远超 `taken`（10.5），再加 filler 也改变不了已经出局的 concept。随同发布的保留意见：
这个分解是**会计而非因果**，而且各分量的数值依赖于基准线的选择。

**E3 对 E2 作了两处更正，对自己作了一处。** E2 写道 recall 从 N=100 到 400「单调上升」，并把原因留给
E3。在预注册的 n=20 上，那个上升**根本立不住** —— 12 个相邻层级对中 `rising` 判定为 0 个。E3 最初
发布的标题因此写成上升「不存在」，**那是错的**，被一次对抗性的检验力检查抓住了：在 n=60 时有 3 对是
`rising`（最小 p=0.00027），且这 3 对中 `taken` 分量承担了 100% 的移动量，rank 分量恰好为 0。上升
是真实的，但**并不实质**（中位数 CI = [0.000, 0.000]）。E3 还把 E2 那条把「平坦」和「小而一致的移动」
混为一谈的 `|Δ| ≤ 0.05` 规则，换成了精确配对符号检验加上分布无关的中位数置信区间，把方向和量级作为
两个独立的值分别给出。

**旧的 R3 一直在对噪声发火。** 它的措辞是「违反单调递减 → **测量装置缺陷** → 丢弃全部结果」，但实现
是不处理不确定性的均值比较，于是 ±0.005 的种子噪声在 E1 和 E2 里都触发了它 —— 两轮都以「发火了，但
什么也没丢弃」这种自相矛盾的状态发布。E3 没有放宽阈值，而是把检测目标拉回措辞本身，直接测量完整性。
在同样的 300 个样本上，旧 R3 发火而新的 R3a 不发火。

**在真实 bundle 上，排序偏差还立不住。** 以只读方式测量并且只输出计数 —— title、说明、文件名、链接
都不会离开测量过程，`raw/` 从不打开。排序用 `<` 比较 `title.toLowerCase()`，即 **UTF-16 码元顺序而
非区域设置排序**，所以以 ASCII 开头的 title 永远排在以谚文开头的前面。以 ASCII 开头的 concept 占
bundle 的 65.4%，却拿走门控 70.6% 的位置 —— 但在 26 个 concept 下，针对分层零模型的超几何精确检验
给出 **p = 0.667**。这算不上结果。也不该把小的提升读成「排序是无害的」：门控目前载入了全部候选的
**65.4%**，而在全都能载入的地方排序什么也决定不了（6 个类别中有 2 个自由度为 0）。按类别看已经开始
分化：`decisions`／`projects` 1.000，`patterns` 0.500，`references` **0.429**。初稿曾断言载入率下降
会放大这个效应，**基准自己的数据反驳了它**，因此该断言已撤回。

**决定谁占到位置的是顺序和行长，不是相关性。** 代码中已确认五个因素：type 区块名按区分大小写排序，
所以 `# Subdirectories` 永远排在 `# reference` 之前（`lib/index-gen.mjs:242`），这会把嵌套的 concept
拉到其类别的前面；区块内部按 frontmatter **`title`** 的字典序，而不是文件名 —— 文件名只是解析失败时
的回退（`:315`）；`status: deprecated` 被降到后面（`:245`）；类别遍历按目录名顺序（`:227`）；以及
**行的字节长度**，因为下一行若超出剩余预算，该类别就在那里停止（`lib/gate.mjs:122`）。门控中没有任何
一处引用 cwd、时新性或查询。

**发现的是形状，不是水平。** 20 个问题中，9 个在所有层级都以 0 存活，3 个都以 1.0 存活，其余 8 个落在
中间 —— recall 不是二元的。门控以轮转方式填充直到预算耗尽；一个类别只以 1–3 行收尾，是因为单行很大
（每行 200–1,030 B，而 index 预算约 6,960 B），所以整体载入在 8–11 行就耗尽了。`references` 在每个
层级都恰好只得到一行，因此集中在那里的 8 个答案中最多只有一个能存活。

**嵌套深度（轴 A-2）。** 固定 25 个 concept，内容完全相同，只把路径加深：

| 条件 | 注入的 concept 行数 | 子域链接 |
|---|---:|---:|
| 扁平 | 28 | 0 |
| 2 层 | 27 | 0 |
| 3 层 | 26 | 0 |
| 4 层 | 25 | 0 |

每个条件只测了**一次**（n=1，没有种子重复），在这一次测量中每加深一层就丢失一行。四个点无法判别这个
下降是否线性，超过 4 层的深度没有测量。以植入的 concept 为基准，3 层是 25 → 23，**−8.0%**。原因是
字节压力而非链式遍历失败：每多一个路径片段，所有行都变长，直到有一行被挤出预算。

**R2 在每一轮都发火**（`recall(24)` = 0.400 < 0.60）。按预注册的处理规则，**recall 的绝对值不决定任何
事情** —— 表格发布出来，但不推动任何策略。

**测量纪律，以及改进之处。** 在 E1 中，固件是在**报告**提交里第一次进入 git 的 —— 阈值提前固定了，
但真正决定数字的材料没有。从 E2 起，固件随预注册提交一同入库，冒烟测试通过
`git log --diff-filter=A` 强制一个**严格**不等式；把它对准 E1 的文件集合会产生 3 处违规，所以这条断言
是抓住真实事故而不是批准它。每一轮都会公开撰写预注册书时已经知道的数值，以及测量之后改动过的算术 ——
E3 把 delta 量子化到 1/20 的网格上，因为 `0.25 − 0.20 = 0.04999…` 而 `0.20 − 0.15 = 0.05000…2`，同样
大小的「一道题的移动」会落到等价界限的两侧。这个修正抹掉了本轮唯一一个 `indeterminate` 判定，也就是说
它**不利于报告自己的论点**，这一点同样被公开。随后对抗性审查表明，存活恒等式的守卫几乎是重言式
（它重新调用了自己正在检查的那个函数），而非循环的替代守卫**在第一次运行时就发火了** —— 上面那个
`front` 污染正是这样被发现的。有一个缺陷是被承担而不是被猜测填补的：同一个守卫在 100 个无扰动样本中
也有 8 个发火，原因尚未查明。

```sh
node test/gate-recall.mjs --e3 --perturb all   # 3 条件 × 5 层级 × 20 种子，约 28 秒
node test/gate-recall.mjs --e3 --perturb all --quote-safe-perturb   # 修正后的前缀
node test/gate-title-distribution.mjs          # 真实 bundle 的 title 分布（只读）
node test/gate-recall.mjs --e2 --perturb all   # E2
node test/gate-recall.mjs                      # E1
node test/bench-nesting.mjs                    # 嵌套深度轴
node test/smoke.mjs                            # 回归守卫
```

[E3 报告](docs/benchmarks/gate-recall-2026-07-26-e3.md) ·
[E3 预注册书](docs/benchmarks/pre-registration-2026-07-26-e3.md) ·
[E2 报告](docs/benchmarks/gate-recall-2026-07-26-e2.md) ·
[E2 预注册书](docs/benchmarks/pre-registration-2026-07-26-e2.md) ·
[E1 报告](docs/benchmarks/gate-recall-2026-07-26-e1.md) ·
[E1 预注册书](docs/benchmarks/pre-registration-2026-07-26-e1.md)

<!-- okf-benchmark: 2026-07-27-efficiency -->

### 注入门效率 —— 索引格式对得起它占的字节吗（轴 E，2026-07-27）

E1–E3 都只扰动 OKF 自己的输入，因此"这个格式值不值"根本无法提问——没有比较对象。轴 E 立起了这个
对象：**同一个知识库、同一个字节预算，只把索引策略换成 6 种。** 花费 **$0.00**，同样不是声明，
而是用 PATH 陷阱在运行中证明。

问题不再由人手写。20 个答案 concept 各自的查询，都是从它**正文**的 tf-idf 前 8 个词机械生成的——
正文正是索引从不装载的部分。检索器是测量前就固定标准参数的 BM25，它的长度归一化会惩罚长行，
也就是说这个选择是**不利于** OKF 的。种子数 40 来自运行前的功效计算，而不是从上一轮沿用。

**五个预注册假设中，两个成立，三个被反驳。**

| 假设 | 判定 | 证据 |
|---|---|---|
| 标题+说明优于只有分类链接 | **支持** | okf 在 12/12 单元格胜出，全部 p<1e-4 |
| 说明对得起它占的字节 | **反驳** | 顺序对齐后，去掉说明的一方在 12/12 单元格胜出 |
| round-robin 对得起它的开销 | **有条件反驳** | 预算 2048 为 −0.050；预算 9000 为 +0.017…+0.218 |
| 排序索引优于随机索引 | 勉强支持 | okf 在 7/12 胜出——但 N=26 的三个单元格全输 |
| 只有路径是不够的 | **反驳** | 只装路径的一方在 8/12 单元格胜出 |

第一行了结了一件从未被测量过的事。知识库自身的架构文档，把 2026-07-17 从"只有分类计数"改为
"标题+说明"的依据写成**一个个案**，并把成本估成 **n=3**。现在它有了数字。

**这个格式买的是精度，卖的是容量。** OKF 的行一旦被装进去，几乎必定排第一（精度 0.93–1.00）；
瓶颈在于默认的 9,000 字节里只装得下 12–14 条 concept 行。只装标题的格式在 N=26 时能装满 26 条
（精度 0.649）；只装路径的也能装满 26 条（精度 0.350）。**说明占一行字节的约 82%**——每行 733 B，
去掉说明后 133 B。

**round-robin 的符号随预算翻转。** 六个分类各自要预扣一个标题行和一个省略标记，所以在预算 2048
下这笔固定成本在四个规模上都吃掉了收益（均为 −0.050）；在出厂默认的 9,000 下它是划算的，而且
知识库越大收益越大（N=200 时 +0.218）。**出厂默认值在它自己的工作点上是对的**——而代码不管预算
多少都一律使用 round-robin。

> **这不等于"删掉说明"。** 本轮测的是**找到**，不是**回答**。注入门规则 1 承诺"如果标题和说明
> 已经包含答案，就直接引用该行而不必 Read"，去掉说明这条路径就整个断了。说明能否赚回那 82%，
> 属于**付费轴，而付费轴一次都没有跑过。** 本轮给出的是价签，不是判决。

**真实知识库，只读，只输出计数与字节。** 26 个 concept / 108,431 B。注入门花掉 **8,885 B——预算
的 98.7%——只展示了 26 个中的 14 个（53.8%）。** 压缩比 12.2×；注入字节中 71.6% 是知识，28.4%
是结构，而结构里仅 `log.md` 尾部就占 1,341 B，是注入量的 15.1%，等于标题行加省略标记之和的 2.6 倍。
合成知识库对这个 53.8% 覆盖率的预测误差在 **2.3 个百分点以内**——这是对合成设计的一次外部检验。

**本轮在发布前抓到了自己的一个缺陷。** 第一次注册运行中，只装路径策略的到达率在 12 个单元格全是
0.000。照字面读像是一个发现，实际是 bug——评分器只从 markdown 链接语法里提取路径。修复之后，那个
假设从支持翻转为反驳。新增的 9 条冒烟断言逐条做了变异测试，6 种变异全部杀死了各自的守卫。

**没有测到的部分，照实发布**：BM25 是词汇重叠，不是模型判断；知识库是合成的，所以这只是上界；
答案 concept 的清单仍然由我挑选（机械生成的只有查询）；`paths` 的成绩依赖于本知识库是韩文正文 +
英文 slug 这一事实；n=40 对"在 80% 种子上一致"的效应功效为 0.981，但在 70% 时只有 0.703，因此这里
的"没有差异"意思是"没能建立"；真实样本只有一位作者的一个知识库；因为没有离线分词器，token 数没有
测量；而且没有独立的对抗性视角运行——验证是自查。

```sh
node test/gate-efficiency.mjs                    # 4 个规模 × 3 个预算 × 40 个种子，约 30 秒
node test/gate-efficiency.mjs --determinism-check
node test/gate-live-efficiency.mjs               # 真实知识库，只读
```

[轴 E 报告](docs/benchmarks/gate-efficiency-2026-07-27.md) ·
[轴 E 预注册](docs/benchmarks/pre-registration-2026-07-27-efficiency.md)

### 全流程付费实测（v3，2026-07-16）

<!-- okf-benchmark: 2026-07-16-v3 -->

**几乎所有代码能回答的问题，OKF 都只是额外开销；而在代码根本无从作答的地方，一个朴素的 CLAUDE.md 同样胜过它——OKF 唯一的优势，只是把这件事做得更省。它的核心承诺（积累的知识会随时间带来回报）经过了一次直接检验，结果被证伪。**

上面这段话中的每一项论断，都在下面用真实的开源仓库测量过，每个对比格 n=15。其中不利于 OKF 的部分先公布。

### 测量方法

两个固定版本的公开仓库——不用合成 fixture，这样探索的成本就是探索的真实成本，无记忆基线也就真有可能赢：

| 角色 | 仓库 | commit |
|---|---|---|
| 代码库 | [slimphp/Slim](https://github.com/slimphp/Slim) | `80900fb3`（125 个 PHP 文件） |
| 文档堆 | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | `f635361c`（651 个 Markdown 文件） |

每个 bundle 里的每一个 concept 都由真实流水线产出——真实的 `claude -p` 会话探索固定版本的仓库、真实的 Claude Code transcript、真实的 batch ingest、真实的 gate。**没有任何 concept 是手写的。** 这些 bundle 已提交到本仓库（[docs/benchmarks/bundles/](docs/benchmarks/bundles/)），因此你可以读到下面每个数字所依据的确切 gate 文本和 concept 正文，并像 v2 被证伪的方式那样证伪本次运行——从仓库出发，无需信任作者。

五个条件。全部拿到完全相同的工具（`Read`、`Glob`、`Grep`、`Bash(git log/show/diff/blame/grep)`）和完全相同、对条件中立的指令——没有任何条件被告知要去查 gate。gate 通过**真实的 `SessionStart` 钩子**（`additionalContext`）投递，而不是前置到 prompt 里；每次运行都会核验投递的字节数。

- **zero-base** — 什么都没有。OKF 声称要替换掉的就是它。
- **answer key（答案纸）** — 答案直接贴进去。要产出那段字符串，你必须已经知道答案，所以没有用户能处在这个条件里。它是一条底线，不是竞争者。
- **OKF** — 真实的 gate 文本。
- **wrong knowledge（错误知识）** — 尺寸匹配的 gate，装的是关于*另一个*仓库的真实 concept。用来区分「是知识帮了忙」和「是 gate 帮了忙」。
- **CLAUDE.md** — 同样的累积知识，粘贴进一个扁平文件。真正的现任者。

`total_cost_usd` 是头条指标；仅 sonnet 的成本列在总成本旁边，这样 CLI 为内部工作解析出的 `claude-haiku`（占开销的 2.3%）就能被扣除，也无法藏起某个结论。效率只在回答正确的运行之间比较。每个回答按 **atom** 评分——ground truth 被拆成可独立核验的事实，并在测量前冻结——而 v2 风格的二元评分（所有 atom 全对）列在它旁边。每次运行的 nonce 使 prompt 缓存失效。**没有任何数字在场景之间取平均。**

设计、预测和证伪标准 R1–R5 都已[预注册](docs/benchmarks/pre-registration-2026-07-16-v3.md)，并在**第一次付费调用之前**提交。那份文档还详细记录了本基准测试上一版（v2）公布时所做的六条虚假或缺乏支撑的陈述，以及每一条是如何从它自己的原始数据中被查出来的。

### OKF 输在哪：任何代码能回答的问题

五个场景，答案都在源码、git 历史或 bundle 里，每一个都从固定版本的 checkout 验证过。成本取回答正确的运行的中位数，并附上其分布范围。

| 场景 | zero-base | OKF | 结论 |
|---|---:|---:|---|
| `rfcs_cheap` — 一次 grep | **$0.062** · 13/15 | $0.077 · 14/15 | OKF 贵 1.2× |
| `slim_cheap` — 一次 grep | **$0.067** · 14/15 | $0.114 · 15/15 | OKF 贵 1.7× |
| `rfcs_buried` — 在 651 篇文档里找出理由 | **$0.097** · 12/15 | $0.112 · 13/15 | OKF 贵 1.2× |
| `slim_buried` — 跟踪一条五文件调用链 | $0.277 · 13/15 · **10 次工具调用** | **$0.232** · 9/15 · **8 次工具调用** | OKF 更便宜、工具调用更少 |
| `slim_stale` — bundle 里的知识被后续 commit 弄过时了 | 关键 **15/15** | 关键 **15/15** | 打平——见下文 |

**在便宜的 grep 上 OKF 是纯粹的开销**——同样的答案要贵 1.2–1.7×，因为 gate 是一项 `grep` 并不需要的固定成本。它只在探索确实昂贵的地方才划算：`slim_buried` 要跟踪一条五文件调用链，在那里 OKF 更便宜、工具调用更少。这不是缺陷，这是算术——如果一次 grep 就能回答你的问题，别为 gate 付费。

`slim_stale` 正是按 atom 评分体现价值的地方。bundle 携带了一条被后续 commit 弄过时的断言，而二元评分在**每个条件下都读作 0/15**——看起来像是全盘覆没。其实不是。*关键* atom（问题真正问的东西——HTML 渲染器会转义、用的是哪个函数和哪些 flag）是 **15/15**：模型读了代码，把核心事实答对了。它唯一漏掉的 atom 是问题从未问及的出处（引入转义的那个 commit SHA）。过时的知识**并没有**让它自信地答错——预注册里「它会」的那条预测是错的，而单看二元评分会把这一点藏起来。

### 探索帮不上忙的地方：代码里不包含的知识

团队政策在对话里定下来，从未写进仓库。RFC 堆里甚至藏着一个陷阱：在里面搜 MSRV 政策，文档提议的是 `N-2`——而团队的实际规则并非如此。

| 场景 | zero-base | OKF | 错误知识 | CLAUDE.md |
|---|---:|---:|---:|---:|
| `rfcs_policy` — 团队的「解冻规则」：等待期、MSRV 节奏、两条例外 | **0/15** | **11/15** · $0.075 | — | 15/15 · $0.144 |

**zero-base 15 战 0 胜。** 它花了钱，什么也没得到，因为答案不在仓库里——这一点由一位对手验证过，他搜索了工作树、git 历史、commit message、文档和配置，零命中。陷阱也没有抓住它；它只是根本无法作答。

OKF 答对了 **15 题中的 11 题**，成本约为携带同样事实的 CLAUDE.md 的一半。这正是探索做不到、而一条存下来的决定能做到的事。**CLAUDE.md 也答得出来**（15/15）——OKF 在这里并不独一无二，它只是同一个现任者的一种更便宜、注入量有上限的形式。本场景的 `wrong knowledge` 对照被排除：一个测量污染 bug（见下）让它读到了答案，因此本次运行它无法充当「光有 gate 帮不上忙」的那个对照。

这是一个干净的政策场景，不是三个。另外两个（`slim_policy`、`slim_domain`）测量过，随后被**排除**——见下文。

### 这次运行无法告诉你的事

- **两个政策场景因污染被排除。** Claude Code 会把按目录划分的项目记忆（`~/.claude/projects/<cwd>/memory/`）自动注入每次会话。在构建知识时，一个探索目标仓库的 `claude -p` 会话把团队决定存进了那份记忆，而由于测量在同一个工作目录里进行，那份记忆甚至到达了**本不应有任何知识的 zero-base** 条件。在 `slim_domain` 上，zero-base 于是「答出了」一个代码里根本不存在的团队决定，15/15。任何 zero-base 运行读到了项目记忆的场景都被排除在发布之外（`slim_domain`、`slim_policy`）；测试框架现在会在测量前清除那份记忆，报告也会机械地检测并排除这类场景。上面那些干净的场景没有任何一次读取记忆。
- **对比条件 n=15，对照条件 n=5。** 很小。只有分布之间完全分离才被称作赢。
- **两个仓库，两种生态（PHP + Markdown）。** 不主张跨规模或跨语言的普适性。第三个仓库设计过，随后在花钱之前因每份可信度的成本不划算而被否决。
- **单问题会话。** OKF 的固定 gate 成本是每个问题付一次，而不是分摊到真实的多问题会话里，所以本次运行*低估*了 OKF。
- **裁判是单一的 LLM 家族**，按 atom 对照从源码验证过的 ground truth 评分。

证伪标准 **R1–R5 全部经机械评估，无一触发**（在排除被污染的格之后）——本次运行没有证伪该主张。这与 n=15 下的有力确认不是一回事；它只是没有出现证伪。

### 链式后续：真实累积有帮助吗？（v4，已证伪）

<!-- okf-benchmark-chain: 2026-07-16-v4 -->

一次独立的、预注册的运行直接测试了 OKF 的机制：针对 `kubernetes/kubernetes` 的 `pkg/scheduler`（v1.30.0，178 个 Go 文件）提出一条由 4 个相关但不同的问题组成的链，其中每个会话的结论都会在下一个会话开始前经过一次**真实的 batch**，并与从不做任何累积、同样提出这 4 个问题的情形做对比。这正是 v3 的预注册标记为「有利于 OKF 且可以调参来讨好它」并拒绝运行的那种形态。v4 还是运行了它，但这次带上了防护措施：这 4 个问题在花钱之前就被冻结并从源码验证过，污染防护会在**每一个**会话之前清除 Claude Code 的项目记忆（而不是只清一次），而证伪标准在测量之前就已确定——见[预注册](docs/benchmarks/pre-registration-2026-07-16-v4.md)。

真实的累积确实发生了：gate 字节数在各步之间单调增长（1835 → 2613 → 3675 → 4950，n=15 条链），背后是真实、可测量的 batch 花费（共 $25.81）。**核心预测——成本会随着链推进而下降——被证伪了。** OKF 的成本在这四个问题上依次为 $0.231 → $0.216 → $0.258 → **$0.447**；无记忆对照也是同样的走向（$0.255 → $0.256 → $0.272 → $0.411）。最可能的解释是，第四个问题对两组来说都单纯更难——它一次问了两个机制——而不是累积帮了忙或帮了倒忙。OKF 的 atom 级准确率在任何一步都没有超过基线，并且在第一个和最后一个问题上都低于基线。二元（所有 atom 全对）评分对两组都是 0/106——这组问题难到只有 atom 级分数才可用。[完整报告](docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md)。

### 本地开销（不是效果基准结果）

2026-07-16 测量，macOS arm64，Node `v26.4.0`，中位数附最小/最大值。

| 本地操作 | 中位数 | 范围 |
|---|---:|---:|
| SessionStart gate 进程 | 57.3 ms | 56.1–60.0 ms |
| SessionEnd batch 触发进程 | 40.1 ms | 39.3–40.8 ms |
| statusline 进程 | 35.8 ms | 34.6–36.3 ms |

用 `node test/bench.mjs [仓库]` 复现。只测本地进程成本；它不证明关于 token 或模型延迟的任何事。

### 成本、复现与链接

这 440 次测量运行花了 **$66.26**，外加 **$14.74** 的评分费用；知识和 bundle 构建又加了约 $3.2。本次运行总计 ≈ **$84**。付费、需认证，并且刻意排除在冒烟测试和 CI 之外。

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-knowledge.mjs --target slim --dir <repo>   # real sessions → transcripts
OKF_RUN_LIVE_BENCH=1 node test/bench-bundles.mjs --target slim --levels 20      # real batch → bundle
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                                    # measure
```

v4 链式运行（120 个会话，各步之间有真实 batch）花费 **$31.95** 测量 + **$9.20** 评分 + **$25.81** 真实 ingest ≈ **$67**：

```sh
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_CHAINS=15 node test/bench-chain.mjs   # chained sessions, real batch, measure
```

[完整报告](docs/benchmarks/okf-benchmark-2026-07-16-v3.md) ·
[链式后续报告](docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md) ·
[raw JSON](docs/benchmarks/raw/) ·
[已提交的 bundle](docs/benchmarks/bundles/) ·
[预注册](docs/benchmarks/pre-registration-2026-07-16-v3.md) ·
[链式预注册](docs/benchmarks/pre-registration-2026-07-16-v4.md) ·
[使用指南](docs/USAGE.md)。

## 语言支持

fallback analyzer 是确定性的、零依赖并采取保守连接；“发现文件”和“分析结构”会分别报告。

| 语言 | 关系与声明 | 主要限制 |
|---|---|---|
| JavaScript / TypeScript | 相对 import/export/require，function/class | bare package 保持外部 |
| Python | dotted module，function/class | 不解析动态 import |
| Go | 基于 `go.mod` 的内部 package node，function/struct | 不伪造 file edge |
| Rust | `mod`/`use`，function/struct/enum/trait | 省略 macro 生成结构 |
| Java / Kotlin | package/class path，type/Kotlin function | 省略 reflection |
| Ruby | `require_relative`，class/method | gem 保持外部 |
| PHP | namespace/use/alias/grouped use、require/include、主要 type/function | 省略动态 autoload |
| C / C++ | quoted include、带明确路径的唯一 local angle include、主要 type/namespace/function definition | regex 可能漏掉 macro 和复杂多行语法 |
| C# | 仓库声明的 namespace node、主要 type | 外部 namespace 不连接 |
| Swift | 明确 inheritance/conformance/extension、主要 type/function | 为防名称冲突省略 nested cross-file target |

达到 2,000 个文件时标记 `truncated`；超过 512 KiB 的文件保留节点但标记为未分析。

## 真实开源验证

使用固定 commit clone，并把代表性 edge 与源代码逐项核对。时间仅用于运行安全性，不是模型速度基准。

| 仓库 | Commit | 语言文件 | 声明 | Internal edges | Truncated |
|---|---|---:|---:|---:|---:|
| [Slim](https://github.com/slimphp/Slim) | `80900fb` | 125 | 127 | 305 | 否 |
| [Redis](https://github.com/redis/redis) | `f76dff7` | 784 | 5,796 | 990 | 否 |
| [fmt](https://github.com/fmtlib/fmt) | `a79df45` | 46 | 283 | 121 | 否 |
| [Alamofire](https://github.com/Alamofire/Alamofire) | `903c53c` | 98 | 2,052 | 215 | 否 |

验证时发现并修复了 Swift 标准 `Error` 错连到同名 nested type，以及 C 标准 header 错连到 vendored compatibility header。详见[验证报告](docs/benchmarks/oss-analysis-2026-07-15.md)。

## 数据和隐私

- 空闲 sweep 会把完整 transcript 复制到 `raw/`，收集过程中不做解析或截断。会话钩子只是唤醒 batch。
- batch 生成有上限的 digest，并通过额外的 `claude -p` 发送给 Anthropic；这是 OKF 新增的唯一模型/API 传输。
- batch 使用 `--safe-mode`、受限工具、stdin prompt、lint/rollback，且没有 Bash。
- 分析器只在临时工作区里操作知识文件的一份副本，物理上无法访问 `raw/`、`.okf/` 或 `.git`；driver 只会把常规 `.md` 文件写回（脚本和 symlink 永远不会进入 bundle）。
- raw transcript 被 git-ignore；只在本地 commit 提取出的 Markdown。插件不会 push 或添加 remote。
- POSIX 目录权限为 `0700`，raw/state/log 为 `0600`。持久日志不含 transcript、Claude stdout/stderr、credential 或完整 raw 路径。
- live fixture 是无个人信息和 credential 的合成数据。

## 配置和删除

使用 `~/.claude/okf/.okf/config.md` 或 `/okf:okf-config`。主要默认值：`enabled: true`（收集、gate 和 batch 的总开关）、`batch_interval_hours: 1`、`batch_max_digest_kb: 600`、`batch_digest_cap_kb: 150`、`sweep_min_idle_minutes: 60`（最后一次活动后需空闲这么久才会被收集，`0` 表示立即收集）、`remove_candidate_ttl_days: 30`、`inject_max_lines` / `inject_max_bytes` 为 `120` / `9000`、`sweep_backfill_days: 0`（sweep 可以回溯到安装标记**之前**多少天；默认 `0` 表示只收集安装之后的对话；硬性的 7 天窗口仍是上限）、`batch_max_usd_per_day: 0`（每日 LLM 支出上限，单位 USD；`0` 表示不限，且为默认值 —— 无论是否设上限，费用始终会被记录并展示；这是 best-effort 的护栏，累计值存放在 `.okf/last-batch.json`）。未知或无效值回退到安全默认值。

```sh
claude plugin uninstall okf
```

数据仍保留在 `~/.claude/okf`，可检查、备份后手动删除。

## 开发验证

```sh
node test/smoke.mjs
node test/bench.mjs
for file in $(rg --files -g '*.mjs'); do node --check "$file"; done
claude plugin validate .claude-plugin/plugin.json
claude plugin validate .claude-plugin/marketplace.json
git diff --check
```

live：`OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs`。

## 参考与许可证

README 结构参考了 [uv](https://github.com/astral-sh/uv)、[Ruff](https://github.com/astral-sh/ruff)、[Playwright](https://github.com/microsoft/playwright)、[fmt](https://github.com/fmtlib/fmt)、[Slim](https://github.com/slimphp/Slim) 的简洁安装和可复现表达，但没有复制文字或 benchmark 声明。[OKF specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)。许可证：[MIT](LICENSE)。
