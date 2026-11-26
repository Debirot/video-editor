/**
 * Tela inicial: novo projeto, abrir e projetos recentes.
 */
import { useEffect, useState } from "react";
import { FilePlus2, FolderOpen, Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ipc, isTauri, type RecentProject } from "@/lib/ipc";
import { newProject, openProjectAt, openProjectDialog } from "@/app/projectFile";

function when(seconds: number): string {
  const d = new Date(seconds * 1000);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" }) + " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function StartScreen() {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const tauri = isTauri();

  useEffect(() => {
    if (tauri) void ipc.recentProjects().then(setRecent).catch(() => setRecent([]));
  }, [tauri]);

  return (
    <div className="flex h-full items-center justify-center bg-bg-0 p-6">
      <div className="flex w-full max-w-[720px] gap-6">
        <section className="flex w-64 shrink-0 flex-col gap-3">
          <div className="mb-4 flex items-center gap-2">
            <Clapperboard className="size-6 text-accent" strokeWidth={1.5} />
            <h1 className="text-title font-semibold">Editor</h1>
          </div>
          <Button variant="accent" className="justify-start" onClick={() => void newProject()}>
            <FilePlus2 /> Novo projeto
          </Button>
          <Button className="justify-start" disabled={!tauri} onClick={() => void openProjectDialog()}>
            <FolderOpen /> Abrir projeto…
          </Button>
          <p className="mt-2 text-label text-text-2">Ctrl+N novo · Ctrl+O abrir · Ctrl+S salvar</p>
        </section>

        <section className="flex min-w-0 flex-1 flex-col rounded-panel border border-border bg-bg-1">
          <h2 className="border-b border-border px-4 py-3 text-title font-semibold">Recentes</h2>
          {recent.length === 0 ? (
            <p className="px-4 py-8 text-center text-body text-text-2">
              {tauri ? "Os projetos que você salvar ou abrir aparecem aqui." : "Abrir e salvar só funcionam no app."}
            </p>
          ) : (
            <ul className="max-h-[420px] overflow-y-auto py-1">
              {recent.map((r) => (
                <li key={r.path}>
                  <button
                    type="button"
                    className="flex w-full flex-col px-4 py-2 text-left hover:bg-bg-2 focus-visible:bg-bg-2"
                    onClick={() => void openProjectAt(r.path)}
                    title={r.path}
                  >
                    <span className="truncate text-body text-text-1">{r.name}</span>
                    <span className="truncate text-label text-text-2">
                      {when(r.openedAt)} · {r.path}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
