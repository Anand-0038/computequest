import type { Caption } from "@remotion/captions";
import { loadFont } from "@remotion/google-fonts/Inter";
import { Audio } from "@remotion/media";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import captionData from "../public/media/payzoll-promo-captions.json";

const captions: Caption[] = captionData;
const { fontFamily } = loadFont("normal", {
  weights: ["400", "600", "700", "800"],
  subsets: ["latin"],
});
const C = {
  ink: "#071A19",
  green: "#42F5B6",
  mint: "#B9FFE7",
  white: "#F7FFFC",
  blue: "#60A5FA",
  amber: "#FFC857",
};

function Scene({ children, duration }: { children: React.ReactNode; duration: number }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10, duration - 10, duration], [0, 1, 1, 0], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const lift = interpolate(frame, [0, 18], [34, 0], {
    easing: Easing.out(Easing.cubic),
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        opacity,
        padding: "64px 90px 126px",
        transform: `translateY(${lift}px)`,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

function Wordmark() {
  return (
    <div style={{ alignItems: "center", display: "flex", gap: 18 }}>
      <div
        style={{
          alignItems: "center",
          background: C.green,
          borderRadius: 18,
          color: C.ink,
          display: "flex",
          fontFamily,
          fontSize: 44,
          fontWeight: 800,
          height: 72,
          justifyContent: "center",
          width: 72,
        }}
      >
        P
      </div>
      <div style={{ color: C.white, fontFamily, fontSize: 54, fontWeight: 800, letterSpacing: -3 }}>
        PayZoll
      </div>
    </div>
  );
}

function Hero() {
  return (
    <Scene duration={105}>
      <div style={{ alignItems: "center", display: "flex", flexDirection: "column", textAlign: "center" }}>
        <Wordmark />
        <div style={{ color: C.white, fontFamily, fontSize: 82, fontWeight: 800, letterSpacing: -5, lineHeight: 1, marginTop: 54 }}>
          USDC IN.<br /><span style={{ color: C.green }}>INR OUT.</span>
        </div>
      </div>
    </Scene>
  );
}

function GlobalPayments() {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [10, 90], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Scene duration={120}>
      <div style={{ display: "grid", gap: 70, gridTemplateColumns: "1fr 1fr", width: "100%" }}>
        <div>
          <div style={{ color: C.green, fontFamily, fontSize: 20, fontWeight: 800, letterSpacing: 4 }}>GLOBAL PAYMENTS</div>
          <div style={{ color: C.white, fontFamily, fontSize: 62, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05, marginTop: 22 }}>
            RECEIVE<br />STABLECOINS.<br /><span style={{ color: C.mint }}>SETTLE LOCALLY.</span>
          </div>
        </div>
        <div style={{ alignItems: "center", display: "flex", justifyContent: "center", position: "relative" }}>
          <div style={{ background: "#102C29", border: `2px solid ${C.green}55`, borderRadius: 28, padding: "30px 34px", width: 390 }}>
            <div style={{ color: C.mint, fontFamily, fontSize: 18 }}>PAYMENT RECEIVED</div>
            <div style={{ color: C.white, fontFamily, fontSize: 58, fontWeight: 800, marginTop: 10 }}>1,000 USDC</div>
            <div style={{ background: "#284A43", borderRadius: 999, height: 12, marginTop: 28, overflow: "hidden" }}>
              <div style={{ background: C.green, height: "100%", width: `${progress * 100}%` }} />
            </div>
          </div>
        </div>
      </div>
    </Scene>
  );
}

function Remittance() {
  return (
    <Scene duration={120}>
      <div style={{ alignItems: "center", display: "flex", flexDirection: "column", textAlign: "center" }}>
        <div style={{ color: C.blue, fontFamily, fontSize: 21, fontWeight: 800, letterSpacing: 4 }}>INWARD REMITTANCE</div>
        <div style={{ color: C.white, fontFamily, fontSize: 72, fontWeight: 800, letterSpacing: -4, lineHeight: 1.05, marginTop: 22 }}>
          CRYPTO SALARY<br /><span style={{ color: C.green }}>TO YOUR BANK.</span>
        </div>
        <div style={{ color: C.mint, fontFamily, fontSize: 28, marginTop: 28 }}>USDC / USDT → INR</div>
      </div>
    </Scene>
  );
}

function Documentation() {
  return (
    <Scene duration={105}>
      <div style={{ display: "grid", gap: 70, gridTemplateColumns: "0.85fr 1.15fr", width: "100%" }}>
        <div style={{ background: C.white, borderRadius: 24, color: C.ink, padding: 34 }}>
          <div style={{ fontFamily, fontSize: 19, fontWeight: 800, letterSpacing: 2 }}>FIRC CERTIFICATE</div>
          <div style={{ borderBottom: "2px solid #DDE9E5", margin: "26px 0" }} />
          <div style={{ fontFamily, fontSize: 26, fontWeight: 800 }}>Generated for eligible remittance</div>
          <div style={{ color: "#377565", fontFamily, fontSize: 18, marginTop: 22 }}>STATUS · COMPLETED</div>
        </div>
        <div>
          <div style={{ color: C.amber, fontFamily, fontSize: 20, fontWeight: 800, letterSpacing: 4 }}>DOCUMENTED SETTLEMENT</div>
          <div style={{ color: C.white, fontFamily, fontSize: 62, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05, marginTop: 22 }}>
            REMITTANCE<br />RECORDS THAT<br /><span style={{ color: C.green }}>TRAVEL WITH YOU.</span>
          </div>
        </div>
      </div>
    </Scene>
  );
}

function Outro() {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 24], [0.88, 1], {
    easing: Easing.bezier(0.34, 1.3, 0.64, 1),
    extrapolateRight: "clamp",
  });
  return (
    <Scene duration={90}>
      <div style={{ alignItems: "center", display: "flex", flexDirection: "column", scale, textAlign: "center" }}>
        <Wordmark />
        <div style={{ color: C.green, fontFamily, fontSize: 34, fontWeight: 800, letterSpacing: 2, marginTop: 42 }}>
          PAYZOLL.FINANCE
        </div>
        <div style={{ color: C.mint, fontFamily, fontSize: 23, marginTop: 14 }}>Move money globally. Settle locally.</div>
      </div>
    </Scene>
  );
}

function Captions() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = (frame / fps) * 1_000;
  const active = captions.find((caption) => caption.startMs <= time && caption.endMs > time);
  if (!active) return null;
  return (
    <div style={{ background: "rgba(7,26,25,0.92)", border: `1px solid ${C.green}55`, borderRadius: 15, bottom: 28, color: C.white, fontFamily, fontSize: 25, fontWeight: 600, left: 90, lineHeight: 1.25, padding: "14px 24px", position: "absolute", right: 90, textAlign: "center" }}>
      {active.text}
    </div>
  );
}

function Background() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.ink,
        backgroundImage: `radial-gradient(circle at ${20 + frame / 45}% 20%, #1E876B55 0, transparent 35%), radial-gradient(circle at 78% ${78 - frame / 70}%, #2563EB22 0, transparent 30%), linear-gradient(rgba(185,255,231,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(185,255,231,0.05) 1px, transparent 1px)`,
        backgroundSize: "auto, auto, 64px 64px, 64px 64px",
      }}
    />
  );
}

export function PayZollPromo() {
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink }}>
      <Background />
      <Audio src={staticFile("media/.generated/payzoll-promo-bed.wav")} />
      <Sequence durationInFrames={105} premountFor={30}><Hero /></Sequence>
      <Sequence from={105} durationInFrames={120} premountFor={30}><GlobalPayments /></Sequence>
      <Sequence from={225} durationInFrames={120} premountFor={30}><Remittance /></Sequence>
      <Sequence from={345} durationInFrames={105} premountFor={30}><Documentation /></Sequence>
      <Sequence from={450} durationInFrames={90} premountFor={30}><Outro /></Sequence>
      <Captions />
    </AbsoluteFill>
  );
}
