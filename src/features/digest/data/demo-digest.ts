import type { DailyDigest } from "../types";

type DemoStoryInput = Omit<DailyDigest["stories"][number], "citations">;

/**
 * 仅用于开发与界面演示的虚构数据，不能作为真实新闻展示或对外发布。
 * 第 16 步接入真实新闻来源后，将由采集和日报生成流程替代。
 */
function withExampleCitation(story: DemoStoryInput) {
  return {
    ...story,
    citations: [
      {
        id: `demo-citation-${story.id}`,
        sourceName: "示例资料条目（虚构）",
        sourceUrl: `https://example.com/demo/${story.id}`,
        publishedAt: story.updatedAt,
        supportingExcerpt: "该条目仅用于演示详情页的出处呈现，不代表真实报道或真实来源。",
      },
    ],
  };
}

export const demoDigest: DailyDigest = {
  id: "demo-digest-2026-07-22-r2",
  digestDate: "2026-07-22",
  revision: 2,
  publishedAt: "2026-07-22T08:00:00.000Z",
  isDemoData: true,
  notice: "当前为虚构演示数据，不代表真实新闻或真实来源。",
  stories: [
    withExampleCitation({
      id: "demo-story-maritime-coordination",
      position: 1,
      headline: "多国启动关键航道安全协调机制",
      summary: "参与方宣布建立信息互通和应急联络机制，以降低商业航运在高风险水域面临的不确定性。",
      whyItMatters: "关键航道的安全预期会影响运费、交付周期和能源价格，协调机制能否持续运行比声明本身更值得观察。",
      importanceScore: 92,
      updatedAt: "2026-07-22T07:30:00.000Z",
    }),
    withExampleCitation({
      id: "demo-story-ceasefire-framework",
      position: 2,
      headline: "多边会谈推进停火监督框架磋商",
      summary: "代表就监督人员权限、信息核验和争端上报程序交换了方案，但尚未形成正式文本。",
      whyItMatters: "停火安排的稳定性通常取决于监督、核验和问责机制是否可执行；程序细节往往决定协议能否落地。",
      importanceScore: 88,
      updatedAt: "2026-07-22T07:05:00.000Z",
    }),
    withExampleCitation({
      id: "demo-story-critical-minerals",
      position: 3,
      headline: "主要经济体讨论关键矿产供应链透明度原则",
      summary: "政策文件提出共享产能、库存和加工环节的部分信息，以帮助企业识别单一环节中断带来的风险。",
      whyItMatters: "关键矿产影响新能源、芯片和国防等产业。透明度提升未必消除竞争，但能让供应链调整更早发生。",
      importanceScore: 81,
      updatedAt: "2026-07-22T06:40:00.000Z",
    }),
    withExampleCitation({
      id: "demo-story-energy-grid",
      position: 4,
      headline: "区域电网互联项目进入融资协调阶段",
      summary: "参与方开始讨论分期投资、跨境输电规则和风险分担，目标是提升跨区域电力调度能力。",
      whyItMatters: "跨境电网可增强能源韧性，但融资安排、监管协调和长期电价机制决定项目能否真正建设。",
      importanceScore: 74,
      updatedAt: "2026-07-22T05:50:00.000Z",
    }),
    withExampleCitation({
      id: "demo-story-rescue-notification",
      position: 5,
      headline: "沿岸国家交换跨境救援通报规则文本",
      summary: "有关方面围绕事故通报时限、联络窗口和救援资源调用顺序讨论了共同程序。",
      whyItMatters: "跨境救援的响应速度取决于信息能否在最初数小时内准确流转。",
      importanceScore: 70,
      updatedAt: "2026-07-22T05:15:00.000Z",
    }),
    withExampleCitation({
      id: "demo-story-grain-transport",
      position: 6,
      headline: "国际组织发布粮食运输风险协调草案",
      summary: "草案提出以航线、仓储和边境通关三个环节评估运输延误风险。",
      whyItMatters: "粮食运输的不确定性会先传导至进口成本与地区库存安排。",
      importanceScore: 68,
      updatedAt: "2026-07-22T04:55:00.000Z",
    }),
    withExampleCitation({
      id: "demo-story-payment-network",
      position: 7,
      headline: "多地央行讨论跨境支付网络压力测试安排",
      summary: "讨论聚焦支付中断、流动性紧张和异常交易识别等假设情景。",
      whyItMatters: "支付网络承压时，企业结算和金融市场的短期风险会同时上升。",
      importanceScore: 65,
      updatedAt: "2026-07-22T04:30:00.000Z",
    }),
    withExampleCitation({
      id: "demo-story-digital-infrastructure",
      position: 8,
      headline: "区域峰会将数字基础设施互联列入议程",
      summary: "议程涉及数据中心互联、海缆维护协调和跨境服务规则的初步讨论。",
      whyItMatters: "数字基础设施的连通性会影响跨境服务、通信韧性和投资预期。",
      importanceScore: 62,
      updatedAt: "2026-07-22T04:05:00.000Z",
    }),
    withExampleCitation({
      id: "demo-story-port-warning-data",
      position: 9,
      headline: "主要港口试行集装箱异常预警数据共享",
      summary: "试点计划在不公开商业敏感信息的前提下共享异常滞留与调度预警信号。",
      whyItMatters: "港口拥堵的早期预警有助于货主调整运输路线和库存节奏。",
      importanceScore: 58,
      updatedAt: "2026-07-22T03:40:00.000Z",
    }),
    withExampleCitation({
      id: "demo-story-medicine-supply",
      position: 10,
      headline: "多边机制启动关键药品供应情况摸排",
      summary: "参与方计划收集关键药品的产能、库存和物流节点信息，用于识别脆弱环节。",
      whyItMatters: "关键药品供应风险通常跨越生产、运输和采购多个环节，需要提前协调。",
      importanceScore: 55,
      updatedAt: "2026-07-22T03:15:00.000Z",
    }),
    withExampleCitation({
      id: "demo-story-rail-freight",
      position: 11,
      headline: "跨境铁路货运通道协调时刻表调整",
      summary: "运营方讨论通过调整班次衔接与口岸作业窗口缓解部分线路的等候压力。",
      whyItMatters: "铁路货运效率变化会影响区域贸易的交付周期和替代运输成本。",
      importanceScore: 52,
      updatedAt: "2026-07-22T02:50:00.000Z",
    }),
    withExampleCitation({
      id: "demo-story-weather-observation",
      position: 12,
      headline: "海洋观测合作提出极端天气信息互通方案",
      summary: "方案讨论统一预警术语、共享观测节点和加强渔业与航运风险提示。",
      whyItMatters: "极端天气信息越早互通，沿海社区和运输系统越有机会调整安排。",
      importanceScore: 49,
      updatedAt: "2026-07-22T02:20:00.000Z",
    }),
  ],
};
