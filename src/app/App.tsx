import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "./Layout";
import { ProofPanel } from "./proof/ProofPanel";

/**
 * A prova técnica (T1.01) continua acessível em "?prova" até o preview real (T1.07).
 */
const showProof = new URLSearchParams(window.location.search).has("prova");

export function App() {
  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
      {showProof ? <ProofPanel /> : <Layout />}
    </TooltipProvider>
  );
}
