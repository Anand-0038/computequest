import { Composition } from "remotion";
import { MonadPromo } from "./monad-promo";
import { PayZollPromo } from "./payzoll-promo";

export const RemotionRoot = () => (
  <>
    <Composition component={MonadPromo} durationInFrames={1_200} fps={30} height={720} id="MonadPromo" width={1_280} />
    <Composition component={PayZollPromo} durationInFrames={540} fps={30} height={720} id="PayZollPromo" width={1_280} />
  </>
);
