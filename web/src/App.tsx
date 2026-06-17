import { useState, type ReactNode } from "react";
import {
  SignedIn, SignedOut, SignInButton, UserButton, useUser,
} from "@clerk/clerk-react";
import { Showcase } from "./components/Showcase.tsx";
import { DemoApp } from "./components/DemoApp.tsx";
import { RealFlowWip } from "./components/RealFlowWip.tsx";

const hasClerk = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function TopBar({ right }: { right?: ReactNode }) {
  return (
    <div className="topbar">
      <span className="brand">Context<span className="dot">·</span>Fabric</span>
      <span className="tag">the secure context layer for enterprise AI</span>
      <span className="spacer" />
      {right}
    </div>
  );
}

/** Signed-in experience: tier decides whether the (WIP) real flow is offered. */
function AuthedApp() {
  const { user } = useUser();
  const tier = String((user?.publicMetadata as any)?.tier ?? "guest");
  const isFriend = ["personal_friend", "friend", "admin", "owner"].includes(tier);
  const [flow, setFlow] = useState<"pick" | "demo" | "real">("pick");

  if (flow === "demo") return <DemoApp tier={tier} onBack={() => setFlow("pick")} />;
  if (flow === "real") return <RealFlowWip onUseDemo={() => setFlow("demo")} onBack={() => setFlow("pick")} />;

  return (
    <>
      <TopBar right={<UserButton />} />
      <div className="container appwrap">
        <div className="hero" style={{ paddingTop: 40 }}>
          <h1>Welcome{user?.firstName ? `, ${user.firstName}` : ""}.</h1>
          <p>
            You're signed in as <span className="badge tier">{tier}</span>. Choose how you want to explore Context Fabric.
          </p>
          <div className="cta-row">
            <button className="primary" onClick={() => setFlow("demo")}>Enter demo flow →</button>
            {isFriend ? (
              <button onClick={() => setFlow("real")}>Real flow (live services)</button>
            ) : (
              <button className="ghost" disabled title="Available to personal-friend tier">Real flow — restricted</button>
            )}
          </div>
          <p className="hint" style={{ marginTop: 18 }}>
            Demo flow runs entirely in your browser on deterministic mock data — no servers, no API
            keys, nothing leaves the page. {isFriend ? "Real flow is a work in progress." : "Ask Hunter for the personal-friend tier to preview the real flow."}
          </p>
        </div>
      </div>
    </>
  );
}

export default function App() {
  // No Clerk key configured yet: still let visitors see the showcase + demo.
  const [openDemo, setOpenDemo] = useState(false);

  if (!hasClerk) {
    if (openDemo) return <DemoApp tier="guest" onBack={() => setOpenDemo(false)} />;
    return (
      <>
        <TopBar right={<button className="primary" onClick={() => setOpenDemo(true)}>Open demo</button>} />
        <Showcase
          authSlot={<button className="primary" onClick={() => setOpenDemo(true)}>Open the demo</button>}
          note="Auth isn't configured on this build yet — the demo is open to everyone."
        />
      </>
    );
  }

  return (
    <>
      <SignedOut>
        <TopBar right={<SignInButton mode="modal"><button className="primary">Sign in</button></SignInButton>} />
        <Showcase
          authSlot={
            <SignInButton mode="modal">
              <button className="primary">Sign in to try it →</button>
            </SignInButton>
          }
        />
      </SignedOut>
      <SignedIn>
        <AuthedApp />
      </SignedIn>
    </>
  );
}
