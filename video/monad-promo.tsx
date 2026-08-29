import type { Caption } from "@remotion/captions";
import { loadFont } from "@remotion/google-fonts/Inter";
import { Audio } from "@remotion/media";
import { AbsoluteFill, Easing, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

import captionData from "../public/media/monad-promo-captions.json";

const { fontFamily } = loadFont("normal", { weights: ["400", "600", "700", "800"], subsets: ["latin"] });
const captions: Caption[] = captionData;
const C = { purple: "#6E54FF", lavender: "#DDD7FE", ink: "#0E091C", cyan: "#85E6FF", pink: "#FF8EE4", orange: "#FFAE45" };

const Scene = ({ children, duration }: { children: React.ReactNode; duration: number }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: interpolate(frame, [0, 16, duration - 16, duration], [0, 1, 1, 0], { easing: Easing.bezier(0.16, 1, 0.3, 1), extrapolateLeft: "clamp", extrapolateRight: "clamp" }), padding: "66px 88px 126px" }}>
      {children}
    </AbsoluteFill>
  );
};

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <div style={{ color: C.cyan, fontFamily, fontSize: 21, fontWeight: 700, letterSpacing: 4, marginBottom: 20, textTransform: "uppercase" }}>{children}</div>
);

const MonadMark = ({ size }: { size: number }) => (
  <svg height={size} viewBox="0 0 24 24" width={size}>
    <path d="M11.782 0C8.37963 0 0 8.53443 0 11.9999C0 15.4654 8.37963 24 11.782 24C15.1844 24 23.5642 15.4653 23.5642 11.9999C23.5642 8.53458 15.1845 0 11.782 0ZM9.94598 18.8619C8.51124 18.4637 4.65378 11.5912 5.04481 10.1299C5.43584 8.66856 12.1834 4.73984 13.6181 5.1381C15.0529 5.5363 18.9104 12.4087 18.5194 13.87C18.1283 15.3314 11.3807 19.2602 9.94598 18.8619Z" fill={C.purple} />
  </svg>
);

const MonadLogo = ({ width }: { width: number }) => (
  <svg aria-label="Monad" color="white" height={width * 24 / 126} viewBox="0 0 126 24" width={width}>
    <path d="M11.782 0C8.37963 0 0 8.53443 0 11.9999C0 15.4654 8.37963 24 11.782 24C15.1844 24 23.5642 15.4653 23.5642 11.9999C23.5642 8.53458 15.1845 0 11.782 0ZM9.94598 18.8619C8.51124 18.4637 4.65378 11.5912 5.04481 10.1299C5.43584 8.66856 12.1834 4.73984 13.6181 5.1381C15.0529 5.5363 18.9104 12.4087 18.5194 13.87C18.1283 15.3314 11.3807 19.2602 9.94598 18.8619Z" fill={C.purple} />
    <path d="M40.0336 14.6596V14.6552L33.339 2.07919C33.2072 1.83164 32.843 1.89093 32.7935 2.16797L29.4595 20.8455C29.4268 21.0285 29.5649 21.197 29.7476 21.197H32.3271C32.4686 21.197 32.5899 21.0939 32.6151 20.9521L34.5567 10.0541L39.7754 20.1872C39.8851 20.4001 40.1843 20.4001 40.294 20.1872L45.5127 10.0541L47.4543 20.9521C47.4795 21.0939 47.6008 21.197 47.7423 21.197H50.3218C50.5045 21.197 50.6425 21.0285 50.6099 20.8455L47.2759 2.16797C47.2264 1.89093 46.8622 1.83164 46.7304 2.07919L40.0336 14.6596Z" fill="currentColor" />
    <path d="M61.4561 2.43127C56.1457 2.43127 51.9858 6.63421 51.9858 12.0007C51.9858 17.3673 56.1457 21.5726 61.4561 21.5726C66.7526 21.5726 70.9022 17.3684 70.9022 12.0007C70.9022 6.63304 66.7526 2.43127 61.4561 2.43127ZM61.4561 18.3683C57.9931 18.3683 55.28 15.571 55.28 12.0007C55.28 8.43046 57.9931 5.63551 61.4561 5.63551C64.9052 5.63551 67.608 8.43163 67.608 12.0007C67.608 15.5699 64.9052 18.3683 61.4561 18.3683Z" fill="currentColor" />
    <path d="M85.4983 14.1957L74.394 2.02247C74.2129 1.82394 73.8867 1.95445 73.8867 2.22543V20.8989C73.8867 21.0636 74.0178 21.1971 74.1795 21.1971H76.864C77.0257 21.1971 77.1567 21.0636 77.1567 20.8989V9.78456L88.2365 21.9807C88.4174 22.1799 88.7442 22.0495 88.7442 21.7782V3.10474C88.7442 2.94005 88.6131 2.80655 88.4514 2.80655H85.7911C85.6294 2.80655 85.4983 2.94005 85.4983 3.10474V14.1957Z" fill="currentColor" />
    <path d="M91.5906 21.1971H94.4731C94.5873 21.1971 94.691 21.1295 94.7389 21.024L96.8982 16.261H103.803L105.914 21.0217C105.961 21.1285 106.066 21.1971 106.181 21.1971H109.308C109.524 21.1971 109.666 20.9672 109.572 20.7692L100.713 2.09692C100.607 1.87232 100.292 1.87232 100.186 2.09692L91.327 20.7692C91.2331 20.9672 91.3747 21.1971 91.5906 21.1971ZM98.2519 13.3058L100.398 8.56257L102.504 13.3058H98.2519Z" fill="currentColor" />
    <path d="M116.57 2.80627H112.14C111.978 2.80627 111.847 2.93978 111.847 3.10446V20.8986C111.847 21.0633 111.978 21.1968 112.14 21.1968H116.57C122.061 21.1968 125.474 17.6733 125.474 12.0004C125.474 6.32744 122.061 2.80627 116.57 2.80627ZM116.57 18.0417H115.141V5.93685H116.57C120.135 5.93685 122.18 8.14707 122.18 12.0004C122.18 15.8396 120.135 18.0417 116.57 18.0417Z" fill="currentColor" />
  </svg>
);

const Hero = () => {
  const frame = useCurrentFrame();
  return <Scene duration={120}><div style={{ textAlign: "center", translate: `0 ${interpolate(frame, [0, 26], [42, 0], { extrapolateRight: "clamp" })}px` }}><MonadMark size={88} /><div style={{ color: "white", fontFamily, fontSize: 88, fontWeight: 800, letterSpacing: -2, lineHeight: 0.94, marginTop: 24 }}>THE EVM.<br /><span style={{ color: C.lavender }}>WITHOUT THE WAIT.</span></div></div></Scene>;
};

const PromiseScene = () => (
  <Scene duration={180}><div style={{ textAlign: "center" }}><Eyebrow>Monad</Eyebrow><div style={{ color: "white", fontFamily, fontSize: 78, fontWeight: 800, letterSpacing: -4, lineHeight: 1 }}>HIGH PERFORMANCE.<br /><span style={{ color: C.pink }}>DECENTRALIZATION.</span><br /><span style={{ color: C.cyan }}>EVM COMPATIBILITY.</span></div></div></Scene>
);

const Stat = ({ color, label, unit, value }: { color: string; label: string; unit: string; value: string }) => {
  const frame = useCurrentFrame();
  return <div style={{ background: "rgba(255,255,255,0.06)", border: `2px solid ${color}66`, borderRadius: 24, minHeight: 216, padding: "28px 30px", scale: interpolate(frame, [0, 24], [0.86, 1], { easing: Easing.bezier(0.16, 1, 0.3, 1), extrapolateRight: "clamp" }) }}><div style={{ color, fontFamily, fontSize: 18, fontWeight: 700, letterSpacing: 2.5 }}>{label}</div><div style={{ color: "white", fontFamily, fontSize: 70, fontWeight: 800, letterSpacing: -4, marginTop: 24 }}>{value}</div><div style={{ color, fontFamily, fontSize: 26, fontWeight: 700 }}>{unit}</div></div>;
};

const Performance = () => (
  <Scene duration={210}><div style={{ width: "100%" }}><Eyebrow>A new performance baseline</Eyebrow><div style={{ display: "grid", gap: 20, gridTemplateColumns: "1.3fr 1fr 1fr" }}><Stat color={C.lavender} label="THROUGHPUT" value="10,000" unit="TPS" /><Stat color={C.cyan} label="BLOCKS" value="300" unit="MS" /><Stat color={C.pink} label="FINALITY" value="600" unit="MS" /></div></div></Scene>
);

const Parallel = () => {
  const frame = useCurrentFrame();
  return <Scene duration={210}><div style={{ alignItems: "center", display: "grid", gap: 58, gridTemplateColumns: "1fr 1.12fr", width: "100%" }}><div><Eyebrow>Optimistic parallel execution</Eyebrow><div style={{ color: "white", fontFamily, fontSize: 70, fontWeight: 800, letterSpacing: -4, lineHeight: 0.98 }}>EXECUTE<br /><span style={{ color: C.cyan }}>TOGETHER.</span></div><div style={{ color: C.lavender, fontFamily, fontSize: 31, fontWeight: 600, marginTop: 22 }}>Commit in original order.</div></div><div style={{ display: "flex", flexDirection: "column", gap: 17 }}>{[C.cyan, C.pink, C.orange, C.lavender].map((color, i) => <div key={color} style={{ alignItems: "center", display: "flex", gap: 14 }}><div style={{ background: color, borderRadius: 13, color: C.ink, fontFamily, fontSize: 22, fontWeight: 800, padding: "16px 24px", translate: `${interpolate(frame, [0, 65], [-245 + i * 22, 0], { easing: Easing.bezier(0.16, 1, 0.3, 1), extrapolateRight: "clamp" })}px 0` }}>TX {String.fromCharCode(65 + i)}</div><div style={{ background: `${color}99`, flex: 1, height: 5 }} /><div style={{ border: `4px solid ${color}`, borderRadius: "50%", height: 26, width: 26 }} /></div>)}</div></div></Scene>;
};

const Compatibility = () => {
  const frame = useCurrentFrame();
  const tools = ["SOLIDITY", "EVM ADDRESSES", "ETHEREUM RPC", "WALLETS", "FOUNDRY", "VIEM"];
  return <Scene duration={210}><div style={{ textAlign: "center", width: "100%" }}><Eyebrow>Bytecode-compatible with Ethereum</Eyebrow><div style={{ color: "white", fontFamily, fontSize: 70, fontWeight: 800, letterSpacing: -2 }}>YOUR STACK. <span style={{ color: C.pink }}>STILL YOUR STACK.</span></div><div style={{ display: "flex", flexWrap: "wrap", gap: 15, justifyContent: "center", marginTop: 38 }}>{tools.map((tool, i) => <div key={tool} style={{ background: i % 2 ? "white" : C.lavender, borderRadius: 999, color: C.ink, fontFamily, fontSize: 22, fontWeight: 800, opacity: interpolate(frame, [i * 7, i * 7 + 15], [0, 1], { extrapolateRight: "clamp" }), padding: "16px 24px", translate: `0 ${interpolate(frame, [i * 7, i * 7 + 15], [22, 0], { extrapolateRight: "clamp" })}px` }}>{tool}</div>)}</div></div></Scene>;
};

const Decentralized = () => {
  const frame = useCurrentFrame();
  return <Scene duration={150}><div style={{ alignItems: "center", display: "grid", gap: 66, gridTemplateColumns: "1.2fr 0.8fr", width: "100%" }}><div><Eyebrow>Performance through architecture</Eyebrow><div style={{ color: "white", fontFamily, fontSize: 66, fontWeight: 800, letterSpacing: -4, lineHeight: 1 }}>SOFTWARE DOES<br /><span style={{ color: C.orange }}>THE HEAVY LIFTING.</span></div><div style={{ color: C.lavender, fontFamily, fontSize: 29, lineHeight: 1.35, marginTop: 24 }}>High performance while preserving decentralization.</div></div><div style={{ height: 300, position: "relative" }}>{[0,1,2,3,4,5,6,7].map((node) => { const a = node / 8 * Math.PI * 2 + frame / 130; const color = [C.cyan,C.pink,C.orange][node % 3]; return <div key={node} style={{ background: color, border: `7px solid ${C.ink}`, borderRadius: "50%", boxShadow: `0 0 28px ${color}66`, height: 42, left: 135 + Math.cos(a) * 112, position: "absolute", top: 130 + Math.sin(a) * 105, width: 42 }} />; })}<div style={{ left: 88, position: "absolute", top: 76 }}><MonadMark size={112} /></div></div></div></Scene>;
};

const Outro = () => {
  const frame = useCurrentFrame();
  return <Scene duration={120}><div style={{ alignItems: "center", display: "flex", flexDirection: "column", textAlign: "center" }}><MonadLogo width={420} /><div style={{ color: "white", fontFamily, fontSize: 66, fontWeight: 800, letterSpacing: -4, marginTop: 38, scale: interpolate(frame, [0, 24], [0.86, 1], { easing: Easing.bezier(0.34, 1.3, 0.64, 1), extrapolateRight: "clamp" }) }}>BUILD BEYOND LIMITS.</div><div style={{ color: C.cyan, fontFamily, fontSize: 29, fontWeight: 700, letterSpacing: 2, marginTop: 18 }}>DOCS.MONAD.XYZ</div></div></Scene>;
};

const Captions = () => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const time = frame / fps * 1_000; const active = captions.find((c) => c.startMs <= time && c.endMs > time); if (!active) return null; const local = time - active.startMs; const length = active.endMs - active.startMs;
  return <div style={{ alignItems: "center", background: "rgba(14,9,28,0.9)", border: `1px solid ${C.lavender}44`, borderRadius: 17, bottom: 30, color: "white", display: "flex", fontFamily, fontSize: 27, fontWeight: 600, justifyContent: "center", left: 88, lineHeight: 1.25, minHeight: 70, opacity: interpolate(local, [0, 180, length - 180, length], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), padding: "10px 26px", position: "absolute", right: 88, textAlign: "center" }}>{active.text}</div>;
};

const Background = () => { const frame = useCurrentFrame(); return <AbsoluteFill style={{ backgroundColor: C.ink, backgroundImage: `radial-gradient(circle at ${28 + frame / 60}% 28%, ${C.purple}58 0, transparent 33%), radial-gradient(circle at 78% ${72 - frame / 90}%, ${C.pink}25 0, transparent 28%), linear-gradient(rgba(221,215,254,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(221,215,254,0.05) 1px, transparent 1px)`, backgroundSize: "auto, auto, 72px 72px, 72px 72px" }} />; };

export const MonadPromo = () => <AbsoluteFill style={{ backgroundColor: C.ink }}><Background /><Audio src={staticFile("media/.generated/monad-promo-bed.wav")} /><Sequence durationInFrames={120} premountFor={30}><Hero /></Sequence><Sequence from={120} durationInFrames={180} premountFor={30}><PromiseScene /></Sequence><Sequence from={300} durationInFrames={210} premountFor={30}><Performance /></Sequence><Sequence from={510} durationInFrames={210} premountFor={30}><Parallel /></Sequence><Sequence from={720} durationInFrames={210} premountFor={30}><Compatibility /></Sequence><Sequence from={930} durationInFrames={150} premountFor={30}><Decentralized /></Sequence><Sequence from={1080} durationInFrames={120} premountFor={30}><Outro /></Sequence><Captions /></AbsoluteFill>;
