export const STORY_CATEGORIES = ["科技", "财经", "国际", "时事"] as const;

export type StoryCategory = (typeof STORY_CATEGORIES)[number];

export function getStoryCategory(headline: string): StoryCategory {
  if (/人工智能|\bAI\b|芯片|机器人|科技|数字经济/i.test(headline)) {
    return "科技";
  }

  if (/市场|经济|贸易|金融|外汇|货币|央行|原油|投资|股市|价格|汇率/i.test(headline)) {
    return "财经";
  }

  if (/外交|国际|联合国|东盟|中东|美国|欧洲|乌克兰|伊朗|以色列|俄罗斯|全球/i.test(headline)) {
    return "国际";
  }

  return "时事";
}
