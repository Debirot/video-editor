import { useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StartScreen } from "@/panels/StartScreen";
import { Layout } from "./Layout";
import { ProofPanel } from "./proof/ProofPanel";
import { installWindowHooks, useFile } from "./projectFile";

/**
 * A prova técnica (T1.01) continua acessível em "?prova" até o preview real (T1.07).
 */
const showProof = new URLSearchParams(window.location.search).has("prova");

export function App() {
  const started = useFile((s) => s.started);
  useEffect(() => (showProof ? undefined : installWindowHooks()), []);
  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
      {showProof ? <ProofPanel /> : started ? <Layout /> : <StartScreen />}
    </TooltipProvider>
  );
}
