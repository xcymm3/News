# Design — News

这是一套面向“每日热点理解”的统一设计系统。首页、事件详情与 Agent 运行面板
共享同一组颜色、字体、间距与交互语言；页面的角色不同，但不能像三个独立产品。

## Genre

modern-minimal。内容阅读页允许使用更强的编辑式排版节奏，Agent 面板使用更紧凑的
技术工作台表达，但不切换全局主题。

## Macrostructure family

- 首页：Signal Index —— 简洁刊头 + 单列热点目录。
- 事件详情：Briefing Reader —— 工具栏 + 大标题 + 连续阅读正文 + 来源。
- Admin：Run Workbench —— 状态概览 + 分阶段运行记录 + 质量与决策证据。

## Theme

- 纸面：暖白至浅棕，不使用厚重纹理或大面积渐变。
- 墨色：深棕黑；正文使用较柔和的棕灰。
- 强调：单一赭棕，仅用于关键动作、状态与焦点。
- 边框：可感知的细线，不用装饰性双线或玻璃拟态。

## Typography

- Display：Geist，600–760，紧凑字距，用于标题与数据值。
- Body：Geist，400–650，用于界面文本。
- Reading：Newsreader 与中文衬线后备，仅用于新闻摘要正文。
- Mono：Geist Mono，用于日期、编号、运行数据和来源标签。

## Spacing and motion

- 使用 `tokens.css` 中的 4pt 命名间距，不在页面内写裸值。
- 动效只使用透明度、背景色与 `transform`；默认克制。
- 减少动态效果时退化为即时状态变化或不超过 150ms 的淡入。

## Microinteractions stance

- 点击项上移不超过 1px；按下回落 1px。
- 成功状态静默呈现，不使用庆祝式提示。
- 键盘焦点始终有高对比描边。

## Per-page allowances

- 首页：高密度但每个标题保有清晰点击区域；分类色块是导航线索，不是装饰图片。
- 详情页：摘要优先于卡片装饰；来源链接保持短小、可扫描。
- Admin：以指标、阶段和失败信息为主，不引入营销式视觉或额外插图。

## What pages must share

- 暖棕纸面、赭棕强调色、Geist 为主字体。
- 可见焦点、细边框、圆角控制件与克制阴影。
- 所有颜色、字体、间距、圆角和动效均引用 `tokens.css` 中的 token。
