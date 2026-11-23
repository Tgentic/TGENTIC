import { createRoot } from "react-dom/client";
import "../base.css";
import "./app.css";
import App from "./App.jsx";
import { HAS_PRIVY, privyConfig, privyChain } from "./privy.js";
import { PrivyProvider } from "@privy-io/react-auth";

function MaybePrivy({ children }) {
  if (!HAS_PRIVY) return children;
  return (
    <PrivyProvider appId={import.meta.env.VITE_PRIVY_APP_ID} config={{ ...privyConfig, supportedChains: [privyChain] }}>
      {children}
    </PrivyProvider>
  );
}

createRoot(document.getElementById("root")).render(
  <MaybePrivy><App /></MaybePrivy>
);
