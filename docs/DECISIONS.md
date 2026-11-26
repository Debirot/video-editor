# Decisões técnicas

Cada decisão em cinco linhas: data, contexto, decisão, alternativas descartadas, consequências.
As decisões de stack do plano técnico (seção 2) valem como D-001 a D-006.

---

### D-001 · 2026-11-26 · Stack
- Contexto: editor desktop, Windows primeiro, código mantido com ajuda de IA.
- Decisão: Tauri 2 + Rust, React 19 + TypeScript + Vite, WebCodecs + WebGL2, FFmpeg 8 como sidecar, Mediabunny para demux/mux.
- Descartadas: Electron (peso), Qt/C++ (difícil de revisar), bindings do FFmpeg em Rust (crash derruba o app), GStreamer, MLT.
- Consequências: o maior risco é o WebCodecs em cada WebView; a prova técnica (T1.01) mede isso antes da interface.

### D-002 · 2026-11-26 · Versões fixadas
- Contexto: início do repositório.
- Decisão: tauri 2.x (crate) e @tauri-apps/* 2.x, React 19, Vite 8, Tailwind 4, Zustand 5, Immer 11, Mediabunny 1.x, Vitest 5. TypeScript fixo em ~5.9.
- Descartadas: TypeScript 7 (port nativo, recém-lançado; typescript-eslint ainda acompanha a série 5). Tauri 3 (alpha).
- Consequências: reavaliar TypeScript 7 no fim da Fase 1.

### D-003 · 2026-11-26 · Protocolo media:// com Range limitado
- Contexto: o protocolo customizado do Tauri devolve o corpo inteiro em memória; o Mediabunny sempre pede `bytes=N-` (aberto).
- Decisão: respostas limitadas a 2 MB (`MAX_CHUNK`); o Mediabunny continua com novo Range quando a resposta vem curta (comportamento verificado no código do UrlSource).
- Descartadas: servidor HTTP local (porta aberta, mais superfície), `convertFileSrc` com o protocolo asset (sem rota de escrita).
- Consequências: muitas requisições pequenas em arquivos grandes; medir no Windows. Se pesar, subir o limite para 8 MB.

### D-004 · 2026-11-26 · Lista de arquivos autorizados no media://
- Contexto: qualquer código na página poderia pedir qualquer caminho ao protocolo.
- Decisão: o Rust só serve arquivos registrados por `allow_media` (canonicalizados). A interface registra o que o usuário escolhe no diálogo ou o que está no projeto aberto.
- Descartadas: servir qualquer caminho; escopo do plugin fs (não cobre protocolos próprios).
- Consequências: abrir projeto precisa registrar as mídias dele (T1.09).

### D-005 · 2026-11-26 · Exportação grava em `.partial` e renomeia
- Contexto: cancelar ou travar no meio não pode deixar MP4 quebrado com o nome final.
- Decisão: `begin_export` cria `<destino>.partial`; `finish_export` faz `sync_all` e renomeia (substitui); `cancel_export` apaga.
- Descartadas: gravar direto no destino.
- Consequências: precisa de espaço para o arquivo inteiro antes de substituir um existente.

### D-006 · 2026-11-26 · Store em Zustand vanilla dentro de src/project
- Contexto: src/project é TypeScript puro (sem React), mas o plano põe o store lá.
- Decisão: `src/project/store.ts` usa `zustand/vanilla`; o hook React `useProject` fica em `src/app/useProject.ts`.
- Descartadas: store com `create` do Zustand (importa React).
- Consequências: testes do store rodam em Node, sem DOM.

### D-007 · 2026-11-26 · Histórico com transações
- Contexto: arrastos atualizam o projeto a cada movimento, mas devem virar um passo de desfazer.
- Decisão: `beginTransaction` / `commitTransaction` / `cancelTransaction` em history.ts acumulam patches numa entrada pendente. Undo/redo ficam bloqueados com transação aberta.
- Descartadas: debounce de entradas por tempo (imprevisível).
- Consequências: a timeline deve sempre fechar a transação no pointerup e cancelar no Esc.

### D-008 · 2026-11-26 · Timecode sem drop-frame
- Contexto: 29,97 e 59,94 tradicionalmente usam drop-frame.
- Decisão: timecode exibido com FPS nominal e sem drop-frame na Fase 1.
- Descartadas: drop-frame já na Fase 1.
- Consequências: em 29,97 o timecode se afasta do relógio ~3,6 s por hora. Rever na Fase 3.

### D-009 · 2026-11-26 · Codificador da exportação: H.264 com VP9 só como último recurso
- Contexto: Chromium sem codecs proprietários (alguns navegadores de desenvolvimento) não codifica H.264.
- Decisão: `pickEncoder` tenta H.264 (nível conforme resolução e FPS), primeiro com hardware; VP9 em MP4 só se H.264 não existir.
- Descartadas: falhar direto.
- Consequências: no WebView2 o resultado deve ser sempre H.264; a prova técnica mostra o codec escolhido.

### D-010 · 2026-11-26 · Dependências de UI iniciais
- Contexto: o plano define shadcn/ui; os componentes copiados dependem de cva, clsx e tailwind-merge.
- Decisão: instalar `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`. Radix e `react-resizable-panels` entram em T1.02, quando forem usados.
- Descartadas: instalar todos os pacotes do plano de uma vez.
- Consequências: cada componente novo do shadcn traz sua dependência Radix junto.
