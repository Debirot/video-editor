import { ProofPanel } from "./proof/ProofPanel";

/**
 * Fase 1, antes do Portão 0: o app abre direto na prova técnica.
 * O layout de cinco regiões (T1.02) entra depois que o pipeline for validado.
 */
export function App() {
  return <ProofPanel />;
}
