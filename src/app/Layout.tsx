/**
 * Janela com cinco regiões fixas: barra superior, biblioteca (esquerda),
 * preview (centro), inspetor (direita) e timeline (embaixo).
 * O usuário redimensiona e recolhe painéis, mas não os reorganiza.
 * Os tamanhos ficam salvos no navegador (localStorage) entre aberturas.
 */
import { useEffect, useState } from "react";
import { FileDown } from "lucide-react";
import { useDefaultLayout, usePanelRef, type PanelSize } from "react-resizable-panels";
import { ResizableGroup, ResizableHandle, ResizablePanel } from "@/components/ui/resizable";
import { TopBar } from "@/panels/TopBar";
import { LibraryPanel, LibraryRail, type LibraryTab } from "@/panels/library/LibraryPanel";
import { PreviewPanel } from "@/panels/preview/PreviewPanel";
import { InspectorPanel } from "@/panels/inspector/InspectorPanel";
import { TimelinePanel } from "@/panels/timeline/TimelinePanel";
import { isTauri, onFileDrop } from "@/lib/ipc";
import { importPaths, listenForJobs } from "./importMedia";
import { runtimeStore, useRuntime } from "./mediaRuntime";
import { actionFor, isTypingTarget } from "./shortcuts";
import { runAction } from "./editActions";

/** Abaixo de 1400 px os painéis laterais começam mais estreitos. */
const SIDE_DEFAULT = typeof window !== "undefined" && window.innerWidth < 1400 ? 240 : 300;

const isOpen = (size: PanelSize) => size.inPixels > 0;

export function Layout() {
  const [tab, setTab] = useState<LibraryTab>("media");
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const libraryRef = usePanelRef();
  const inspectorRef = usePanelRef();
  const horizontal = useDefaultLayout({ id: "layout-horizontal" });
  const vertical = useDefaultLayout({ id: "layout-vertical" });
  const dragging = useRuntime((s) => s.dragging);

  // Fila do Rust (pôsteres) e arquivos soltos na janela. Só existem no app.
  useEffect(() => {
    if (!isTauri()) return;
    const stops = [
      listenForJobs(),
      onFileDrop((e) => {
        if (e.type === "enter" || e.type === "over") runtimeStore.setState({ dragging: true });
        else runtimeStore.setState({ dragging: false });
        if (e.type === "drop" && e.paths.length > 0) {
          setTab("media");
          libraryRef.current?.expand();
          void importPaths(e.paths);
        }
      }),
    ];
    return () => stops.forEach((p) => void p.then((stop) => stop()).catch(() => {}));
  }, [libraryRef]);

  // Atalhos de teclado (mapa em shortcuts.ts). Não valem enquanto se digita num campo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      const action = actionFor(e);
      if (!action) return;
      e.preventDefault();
      runAction(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selectTab = (next: LibraryTab) => {
    const panel = libraryRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      setTab(next);
      panel.expand();
    } else if (next === tab) {
      panel.collapse();
    } else {
      setTab(next);
    }
  };

  const toggleInspector = () => {
    const panel = inspectorRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  };

  return (
    <div className="relative flex h-full min-w-[1100px] flex-col">
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-bg-0/70">
          <div className="flex flex-col items-center gap-2 rounded-panel border-2 border-dashed border-accent bg-bg-1 px-10 py-8">
            <FileDown className="size-8 text-accent" strokeWidth={1.5} />
            <p className="text-title font-semibold">Solte para importar</p>
          </div>
        </div>
      )}
      <TopBar inspectorOpen={inspectorOpen} onToggleInspector={toggleInspector} />

      <ResizableGroup orientation="vertical" className="min-h-0 flex-1" {...vertical}>
        <ResizablePanel id="workspace" minSize={240}>
          <div className="flex h-full">
            <LibraryRail active={tab} open={libraryOpen} onSelect={selectTab} />
            <ResizableGroup orientation="horizontal" className="min-w-0 flex-1" {...horizontal}>
              <ResizablePanel
                id="library"
                panelRef={libraryRef}
                defaultSize={SIDE_DEFAULT}
                minSize={200}
                maxSize={480}
                collapsible
                collapsedSize={0}
                onResize={(size) => setLibraryOpen(isOpen(size))}
              >
                <LibraryPanel tab={tab} />
              </ResizablePanel>
              <ResizableHandle direction="horizontal" />
              <ResizablePanel id="preview" minSize={360}>
                <PreviewPanel />
              </ResizablePanel>
              <ResizableHandle direction="horizontal" />
              <ResizablePanel
                id="inspector"
                panelRef={inspectorRef}
                defaultSize={SIDE_DEFAULT}
                minSize={220}
                maxSize={480}
                collapsible
                collapsedSize={0}
                onResize={(size) => setInspectorOpen(isOpen(size))}
              >
                <InspectorPanel />
              </ResizablePanel>
            </ResizableGroup>
          </div>
        </ResizablePanel>
        <ResizableHandle direction="vertical" />
        <ResizablePanel id="timeline" defaultSize="38%" minSize={140} maxSize="70%">
          <TimelinePanel />
        </ResizablePanel>
      </ResizableGroup>
    </div>
  );
}
