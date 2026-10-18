import type { AnalystAgent } from "../types";
import { TrendAnalyst } from "./trend";
import { MomentumAnalyst } from "./momentum";
import { VolatilityAnalyst } from "./volatility";
import { RiskOfRuinAnalyst } from "./risk-of-ruin";
import { NewsSentimentAnalyst } from "./news-sentiment";

/** The full analyst panel. 4 initiating + 1 non-initiating (news). */
export function createAnalystPanel(): AnalystAgent[] {
  return [
    new TrendAnalyst(),
    new MomentumAnalyst(),
    new VolatilityAnalyst(),
    new RiskOfRuinAnalyst(),
    new NewsSentimentAnalyst(),
  ];
}

export { TrendAnalyst } from "./trend";
export { MomentumAnalyst } from "./momentum";
export { VolatilityAnalyst } from "./volatility";
export { RiskOfRuinAnalyst } from "./risk-of-ruin";
export { NewsSentimentAnalyst, tallySentiment } from "./news-sentiment";
