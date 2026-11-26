/**
 * Abrir, salvar, novo projeto e a pergunta ao fechar a janela.
 *
 * O projeto mora numa pasta `<nome>.vproj/` com `project.json` (o Rust grava de forma
 * atômica). "Não salvo" = revisão do store diferente da última salva.
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { message, open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ipc, isTauri } from "@/lib/ipc";
import { resolvePath } from "@/lib/paths";
import { projectStore } from "@/project/store";
import { createProject, normalizeProject, ProjectFormatError, serializeProject } from "@/project/normalize";
import type { Project } from "@/project/types";
import { restoreMedia } from "./importMedia";
import { runtimeStore } from "./mediaRuntime";
import { setSelection } from "./selectionStore";
import { viewStore } from "./viewStore";
import { pause } from "./engine";
import { DEFAULT_PX_PER_SECOND } from "@/timeline/viewport";

interface FileState {
  /** Pasta .vproj do projeto aberto; null = nunca salvo. */
  dir: string | null;
  /** Saiu da tela inicial. */
  started: boolean;
}

export const fileStore = createStore<FileState>()(() => ({ dir: null, started: false }));

export function useFile<T>(selector: (s: FileState) => T): T {
  return useStore(fileStore, selector);
}

export function isDirty(): boolean {
  const s = projectStore.getState();
  return s.revision !== s.savedRevision;
}

async function showError(text: string): Promise<void> {
  if (isTauri()) await message(text, { title: "Editor", kind: "error" });
  else console.error(text);
}

// ─── Salvar ──────────────────────────────────────────────────────────────────

async function writeTo(path: string): Promise<boolean> {
  const { project } = projectStore.getState();
  const revision = projectStore.getState().revision;
  try {
    // O relPath é calculado em relação à pasta final (o Rust acrescenta .vproj se faltar).
    const dir = /\.vproj$/i.test(path) ? path : `${path}.vproj`;
    const saved = await ipc.saveProject(path, serializeProject(project, dir), project.name);
    fileStore.setState({ dir: saved });
    // Marca como salva a revisão que foi gravada (não alterações feitas durante a gravação).
    if (projectStore.getState().revision === revision) projectStore.getState().markSaved();
    return true;
  } catch (e) {
    await showError(`Não foi possível salvar o projeto.\n\n${e}`);
    return false;
  }
}

export async function saveProject(): Promise<boolean> {
  const { dir } = fileStore.getState();
  return dir ? writeTo(dir) : saveProjectAs();
}

export async function saveProjectAs(): Promise<boolean> {
  if (!isTauri()) return false;
  const name = projectStore.getState().project.name || "Sem título";
  const path = await save({
    title: "Salvar projeto",
    defaultPath: `${name}.vproj`,
    filters: [{ name: "Projeto do editor", extensions: ["vproj"] }],
  });
  return path ? writeTo(path) : false;
}

// ─── Descartar alterações ────────────────────────────────────────────────────

/** Pergunta se salva as alterações. true = pode seguir (salvou ou descartou). */
export async function confirmDiscard(action: string): Promise<boolean> {
  if (!isDirty() || !isTauri()) return true;
  const name = projectStore.getState().project.name;
  const answer = await message(`Salvar as alterações em “${name}” antes de ${action}?`, {
    title: "Alterações não salvas",
    kind: "warning",
    buttons: { yes: "Salvar", no: "Não salvar", cancel: "Cancelar" },
  });
  if (answer === "Salvar" || answer === "Yes") return saveProject();
  return answer === "Não salvar" || answer === "No";
}

// ─── Abrir e novo ────────────────────────────────────────────────────────────

function resetView(): void {
  pause();
  setSelection([]);
  runtimeStore.setState({ errors: [] });
  viewStore.setState({ playhead: 0, scrollX: 0, scrollY: 0, pxPerSecond: DEFAULT_PX_PER_SECOND });
}

export async function newProject(): Promise<void> {
  if (!(await confirmDiscard("criar um projeto novo"))) return;
  resetView();
  projectStore.getState().load(createProject("Sem título"));
  fileStore.setState({ dir: null, started: true });
}

export async function openProjectDialog(): Promise<void> {
  if (!isTauri()) return;
  const picked = await open({ title: "Abrir projeto (pasta .vproj)", directory: true });
  if (typeof picked === "string") await openProjectAt(picked);
}

/**
 * Abre o projeto da pasta. Mídias que não estão no caminho gravado são procuradas pelo
 * caminho relativo à pasta do projeto (pasta movida junto com os vídeos); as que não
 * aparecem ficam marcadas como ausentes.
 */
export async function openProjectAt(path: string): Promise<void> {
  if (!(await confirmDiscard("abrir outro projeto"))) return;
  let dir: string;
  let project: Project;
  try {
    const opened = await ipc.openProject(path);
    dir = opened.dir;
    project = normalizeProject(JSON.parse(opened.json));
  } catch (e) {
    const detail = e instanceof ProjectFormatError || e instanceof SyntaxError ? `O arquivo está danificado: ${e.message}` : String(e);
    await showError(`Não foi possível abrir o projeto.\n\n${detail}`);
    return;
  }

  const found = await ipc.attachMedia(project.media.map((m) => m.path));
  const retry = project.media.flatMap((m, i) => (!found[i] && m.relPath ? [{ i, path: resolvePath(dir, m.relPath) }] : []));
  const foundRel = retry.length > 0 ? await ipc.attachMedia(retry.map((r) => r.path)) : [];
  retry.forEach((r, k) => {
    if (foundRel[k]) {
      project.media[r.i]!.path = r.path;
      found[r.i] = true;
    }
  });
  project.media.forEach((m, i) => {
    m.missing = !found[i];
  });

  resetView();
  projectStore.getState().load(project);
  fileStore.setState({ dir, started: true });
  void restoreMedia(project.media);
  const missing = project.media.filter((m) => m.missing).length;
  if (missing > 0) {
    await showError(
      `${missing} ${missing === 1 ? "mídia não foi encontrada" : "mídias não foram encontradas"}. ` +
        "Elas aparecem marcadas no projeto; religar arquivos chega numa próxima versão.",
    );
  }
}

// ─── Título da janela e pergunta ao fechar ───────────────────────────────────

/** Mantém o título da janela ("• Viagem — Editor") e pergunta antes de fechar com alterações. */
export function installWindowHooks(): () => void {
  if (!isTauri()) return () => {};
  const win = getCurrentWindow();
  let lastTitle = "";
  const updateTitle = () => {
    const { project } = projectStore.getState();
    const title = `${isDirty() ? "• " : ""}${project.name} — Editor`;
    if (title !== lastTitle) {
      lastTitle = title;
      void win.setTitle(title).catch(() => {});
    }
  };
  updateTitle();
  const unsub = projectStore.subscribe(updateTitle);
  const unlisten = win.onCloseRequested(async (event) => {
    event.preventDefault();
    let close = true;
    try {
      close = await confirmDiscard("fechar");
    } finally {
      // Se algo falhar ao perguntar, a janela fecha mesmo assim: nunca prender o usuário.
      if (close) await win.destroy();
    }
  });
  return () => {
    unsub();
    void unlisten.then((f) => f());
  };
}
