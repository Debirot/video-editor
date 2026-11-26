# Editor de vídeo (Tauri 2 + React + WebCodecs)

Editor de vídeo desktop, Windows primeiro. O projeto é um JSON; o motor é uma
função (projeto, tempo) → quadro. Originais nunca são modificados.

## Mapa
- src/project/    modelo, store, comandos, undo. TypeScript puro. Ver docs/DATA_MODEL.md
- src/engine/     Web Worker: decodificação, compositor WebGL2, áudio, exportação
- src/timeline/   desenho e interação da timeline em canvas
- src/panels/     componentes React dos painéis
- src/app/        App.tsx, layout, atalhos, hooks que ligam React ao store
- src/lib/        time.ts (µs, quadros, timecode), ipc.ts (invoke do Tauri), ids.ts
- src-tauri/src/  Rust: arquivos, FFmpeg, fila de tarefas, protocolo media://
- Arquitetura: docs/ARCHITECTURE.md | Interface: docs/UI_GUIDE.md
- Tarefas: docs/ROADMAP.md | Decisões: docs/DECISIONS.md

## Comandos
- npm run tauri dev     app em desenvolvimento
- npm run dev           só o frontend no navegador (a prova técnica funciona com arquivo local)
- npm test              Vitest
- cargo test            (dentro de src-tauri)
- npm run lint && npm run typecheck
- npm run fixtures      gera vídeos de teste em tests/fixtures/ (precisa de ffmpeg com libx264)
- npm run ffmpeg        baixa/liga o FFmpeg em src-tauri/binaries (roda sozinho no npm install)

## Regras invariáveis
- Tempos são inteiros em microssegundos. Nunca segundos em float no modelo.
  Conversões só em src/lib/time.ts (secondsToUs, frameToUs, usToFrame, snapToFrame).
- O projeto só muda por applyCommand() (src/project/store.ts → history.ts).
- src/engine não importa React nem nada de src/panels. A única porta é src/engine/messages.ts.
- src/project não importa React, Tauri nem src/engine.
- Todo VideoFrame passa por adopt()/release() de src/engine/frames.ts.
- Comandos do FFmpeg só em src-tauri/src/ffmpeg.rs.
- Só o Rust lê e grava arquivos. O Worker lê e grava mídia pelo protocolo media://.
- Nomes de comandos do Rust só em src/lib/ipc.ts (lado TS) e src-tauri/src/commands.rs.
- Cores, espaçamentos e fontes só via tokens (src/styles/tokens.css). Nada de hex em componentes.
- Componentes novos partem de src/components/ui. Não instalar outra biblioteca de UI.

## Forma de trabalhar
- Uma tarefa por vez, a do topo de docs/ROADMAP.md marcada como "próxima".
- Antes de codar: listar arquivos que serão alterados e esperar aprovação.
- Não alterar arquivos fora dessa lista. Não refatorar código que a tarefa não pede.
- Testes primeiro nas partes puras (src/project, src/lib, ffmpeg.rs), depois a implementação.
- Ao terminar: npm test, cargo test, lint e typecheck passando; ROADMAP.md atualizado;
  resumo do que mudou. Commit com o id da tarefa: "T1.07: dividir clipe no playhead".
- Nova dependência só com justificativa e registro em docs/DECISIONS.md.
- Tarefa que muda contrato (tipo, mensagem, comando do Rust) atualiza o doc no mesmo commit.

## Módulos estáveis (mudar só se a tarefa pedir explicitamente)
- src/project/history.ts
- src/lib/time.ts
- src/engine/compositor/ (shaders existentes)
- src-tauri/src/protocol.rs (rotas e limites de Range)

## Checklist de revisão
- O diff mexe só nos arquivos combinados?
- Os tempos continuam inteiros em µs, sem parseFloat ou divisões soltas no modelo?
- Toda alteração do projeto passa por applyCommand?
- Todo VideoFrame, decodificador e encoder tem fechamento garantido, inclusive em erro?
- Chamadas ao Rust e ao FFmpeg tratam erro e cancelamento?
- Nenhuma dependência nova sem registro em DECISIONS.md?
- Nenhuma cor, fonte ou espaçamento fixo fora dos tokens?
- Os testes cobrem o caso de borda, e não só o caminho feliz?
- Existe código morto, comentário desatualizado ou função duplicada?
