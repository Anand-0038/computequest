import { Composition } from "remotion";
import { MonadPromo } from "./monad-promo";

export const RemotionRoot = () => (
  <Composition component={MonadPromo} durationInFrames={1_200} fps={30} height={720} id="MonadPromo" width={1_280} />
);
