import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App.tsx";
import "./styles.css";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {PUBLISHABLE_KEY ? (
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl={import.meta.env.BASE_URL}>
        <App />
      </ClerkProvider>
    ) : (
      // Lets the app run (showcase + demo) even before Clerk keys are configured,
      // e.g. local dev or first deploy. Auth-gated bits show a setup hint.
      <App />
    )}
  </React.StrictMode>
);
