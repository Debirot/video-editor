# Editor

Editor de vídeo desktop em Tauri 2 + React + WebCodecs. Windows primeiro.

Estado atual: **Fase 1, antes do Portão 0.** O app abre na tela da prova técnica,
que mede se o pipeline de vídeo (decodificar 4K com hardware, compor em WebGL2 e
exportar MP4) funciona no WebView2. Ver `docs/ROADMAP.md`.

## Rodar no Windows

Pré-requisitos: [Rust](https://rustup.rs), Node.js 22+, e os
[pré-requisitos do Tauri para Windows](https://tauri.app/start/prerequisites/)
(Microsoft C++ Build Tools; o WebView2 já vem no Windows 10/11).

```bash
npm install
```

```bash
npm run tauri dev
```

Na janela, siga os passos 1 a 3 com um MP4 4K H.264 e anote os números
no checklist de T1.01 em `docs/ROADMAP.md`.

Para gerar vídeos de teste (precisa de um `ffmpeg` com libx264 no PATH):

```bash
npm run fixtures
```

## Rodar só o frontend

```bash
npm run dev
```

Abre em http://localhost:1420. Sem o Tauri, a prova técnica lê o arquivo escolhido
direto no navegador e oferece o MP4 para download. Útil para testar o motor fora do Windows.

## Testes

```bash
npm test
```

```bash
cd src-tauri && cargo test
```

```bash
npm run lint && npm run typecheck
```

## Documentação

- `CLAUDE.md`: mapa e regras para sessões do Claude Code
- `docs/ARCHITECTURE.md`: processos, módulos e mensagens
- `docs/DATA_MODEL.md`: tipos do projeto e regras de tempo
- `docs/UI_GUIDE.md`: tokens, componentes e padrões de tela
- `docs/DECISIONS.md`: registro de decisões técnicas
- `docs/ROADMAP.md`: fases, tarefas e status
