# Roadmap

Três fases e quatro portões. Cada fase só começa quando o portão anterior é cumprido.

| Portão | Critério | Estado |
|---|---|---|
| 0 | Pipeline validado (T1.01 no Windows) | **cumprido em 2026-11-26** (GPU integrada pendente, não bloqueia) |
| 1 | MP4 correto, UI fluida (fim da Fase 1) | — |
| 2 | Preview igual à exportação (fim da Fase 2) | — |
| 3 | Metas de desempenho da seção 1 do plano | — |

Estados de tarefa: `próxima`, `em andamento`, `bloqueada`, `concluída`.

---

## Fase 1: MVP funcional

### T1.01 Prova técnica do pipeline · concluída (resultados em DECISIONS.md, D-011)
Objetivo: app Tauri mínimo em que um Worker lê um MP4 4K pelo protocolo media://,
decodifica com WebCodecs, desenha em WebGL2 e grava 10 s de MP4 com VideoEncoder e Mediabunny.
Arquivos: src-tauri/src/{main,commands,protocol}.rs, src/engine/{worker,messages,frames,proof,export}.ts,
src/engine/decode/*, src/engine/compositor/*, src/lib/ipc.ts, src/app/proof/ProofPanel.tsx
Pronto quando:
- [x] cargo test cobre Range (tabela de casos), rotas, autorização, escrita fora de ordem, finish e cancel
- [x] No Chromium (navegador, sem GPU): 4K H.264, vertical 29,97, VFR, 23,976 e VP9 abrem,
      reproduzem e exportam; ffprobe confirma 1920×1080, 30 fps, 300 quadros, 10,000 s, keyframe a cada 2 s
- [x] Contador de VideoFrames volta a zero depois de reproduzir e exportar
- [x] No Windows (WebView2), via `npm run tauri dev`, com MP4 4K H.264 (3840×2160, 25 fps):
  - [x] "Aceleração: hardware" ao abrir; tempo real 249 de 250 quadros (o descarte é o primeiro
        quadro, defeito da tela de teste: o relógio começa antes do primeiro quadro decodificado)
  - [x] Velocidade máxima 228 a 259 qps (GPU dedicada)
  - [x] Exportação com "Codificação: hardware" (90 qps); MP4 abre no VLC e no player do Windows
  - [x] Cancelar a exportação não deixa arquivo `.partial`
  - [x] Exportar com a janela minimizada termina no mesmo tempo (2,98 s contra 3,34 s)
  - [ ] Testado num notebook com GPU integrada (pendente, não bloqueia o Portão 0)
- [x] Números anotados em DECISIONS.md (D-011) e Portão 0 marcado aqui
Fora do escopo: áudio, várias trilhas, UI definitiva.
Se algo falhar: a stack é revista antes de seguir (plano, seção 11).

### T1.02 Esqueleto da interface · concluída
Objetivo: as cinco regiões com painéis redimensionáveis, tokens, componentes base e barra superior.
Arquivos: src/app/{App,Layout}.tsx, src/panels/TopBar.tsx, src/panels/{library,preview,inspector,timeline}/,
src/components/ui/{resizable,tooltip}.tsx, src/project/commands/project.ts, src/project/queries.ts (aspectLabel),
src/main.tsx, src/styles/tokens.css, docs/UI_GUIDE.md
Pronto quando:
- [x] Painéis redimensionam e recolhem; largura mínima 1100 px respeitada; tamanhos salvos entre aberturas
- [x] Nenhuma cor fixa fora de tokens.css (grep por hex em src/panels, src/components e src/app dá vazio)
- [x] Estados vazios com o texto do próximo passo
- [x] Fonte Inter empacotada no app (sem rede)
- [x] Renomear o projeto e ocultar/travar trilhas passam por applyCommand e desfazem
- [x] Prova técnica continua acessível em `?prova`
Fora do escopo: atalhos de teclado (T1.06), inspetor como gaveta abaixo de 1400 px.

### T1.03 Modelo e histórico · concluída
Objetivo: types.ts, store, applyCommand, desfazer e refazer, time.ts, todos com testes.
Arquivos: src/project/{types,normalize,history,store,queries,fixtures}.ts, src/project/commands/tracks.ts,
src/lib/{time,ids}.ts, src/app/useProject.ts
Pronto quando:
- [x] time.ts: ida e volta quadro ↔ µs exata em 23,976 / 24 / 25 / 29,97 / 30 / 59,94 / 60 até 10 h
- [x] Timecode format/parse inversos; entradas inválidas recusadas
- [x] Um teste aplica 50 comandos e desfaz todos, voltando a um projeto idêntico ao inicial
- [x] Transações: arrasto vira uma entrada; cancelar restaura; transação vazia não cria entrada
- [x] normalizeProject preenche padrões, ordena clipes, recusa tempos não inteiros e schema mais novo
- [x] Partes não alteradas do projeto mantêm a referência (seletores não re-renderizam)

### T1.04 Importação · concluída
Objetivo: diálogo e arrastar arquivos, ffprobe no Rust, biblioteca com pôster.
Arquivos: src-tauri/src/{ffmpeg,media,jobs,cache,time,commands,protocol,main}.rs, scripts/ensure-ffmpeg.mjs,
src/project/commands/media.ts, src/app/{importMedia,mediaRuntime,engine}.ts, src/engine/{messages,worker}.ts,
src/panels/library/{LibraryPanel,MediaLibrary}.tsx, src/panels/TopBar.tsx, src/app/Layout.tsx, src/lib/ipc.ts
Pronto quando:
- [x] ffmpeg.rs tem testes de montagem de argumentos (probe, pôster) e de leitura do JSON do ffprobe
      (celular com rotação e VFR, 29,97, música com capa, PNG, arquivo inválido)
- [x] fingerprint (tamanho, mtime, hash parcial) testado; fila testada (deduplicação e concorrência)
- [x] Teste de integração com o ffmpeg de verdade: probe e pôster de um vídeo gerado
- [x] Mídias importadas são registradas com allow_media; pôsteres servidos por media://.../cache/
- [x] No navegador com Tauri simulado: importar mostra pôsteres, selo "Proxy" no HEVC (Chromium
      sem HEVC), selo "VFR", erros por arquivo, sem duplicar, busca, desfazer, "Solte para importar"
- [ ] No Windows: importar 3 vídeos reais (4K H.264, vertical de celular, HEVC) pelo diálogo e arrastando
Fora do escopo: miniaturas da timeline, waveforms, proxies, conversão de VFR, bins.

### T1.05 Timeline · próxima
Canvas com régua, trilhas, clipes, playhead e zoom. Desenha só o visível, em requestAnimationFrame.

### T1.06 Edição
Arrastar da biblioteca, mover entre trilhas, aparar bordas, snap (8 px), seleção múltipla,
copiar e colar, dividir (splitClip, trimClip, moveClips com testes), apagar. Atalhos em shortcuts.ts.

### T1.07 Preview
Reprodução de várias trilhas de vídeo, seek, quadro a quadro, J/K/L, qualidade (1, 1/2, 1/4)
e proporção. Pool de decodificadores (6, LRU) e cache de quadros (48, LRU). Substitui proof.ts.

### T1.08 Áudio
Mixer em Web Audio, volume e mudo por trilha, áudio ligado ao vídeo, relógio do áudio como mestre.

### T1.09 Salvar e abrir
JSON simples (project_io.rs com escrita atômica), sem autosave. Registrar mídias com allow_media ao abrir.

### T1.10 Exportação
MP4 H.264, H.265 quando disponível, resolução, FPS, bitrate, progresso e cancelamento.
Áudio com OfflineAudioContext + AudioEncoder. Reaproveita export.ts.

### Critérios de conclusão da Fase 1 (Portão 1)
- [ ] A prova técnica roda num notebook com GPU integrada e num PC com GPU dedicada
- [ ] Importar três vídeos (4K H.264, vertical de celular, 1080p HEVC) e montar 2 min com 2 trilhas de vídeo e 2 de áudio
- [ ] Cortar, dividir, mover e encaixar funcionam por mouse e por atalho
- [x] Um teste aplica 50 comandos e desfaz todos, voltando a um projeto idêntico ao inicial
- [ ] Preview 1080p de uma trilha sem queda perceptível; áudio a menos de um quadro do vídeo após 2 min
- [ ] MP4 exportado abre no VLC e no player do Windows; duração igual à timeline (±1 quadro); resolução e FPS confirmados pelo ffprobe
- [ ] A interface responde durante a exportação; cancelar apaga o arquivo parcial
- [ ] O contador de VideoFrames abertos volta a zero ao parar a reprodução
- [ ] npm test, cargo test e typecheck passando

---

## Fase 2: edição completa
1. Inspetor com seções por tipo de seleção.
2. Transformação (posição, escala, rotação, recorte, opacidade) com alças no preview.
3. Imagens e logotipos, depois formas.
4. Textos e títulos, com fontes do sistema.
5. Ajustes de cor, desfoque e nitidez.
6. Transições: dissolve, fade para preto, deslizar, zoom.
7. Keyframes: motor de interpolação primeiro (com testes), depois a interface no inspetor.
8. Volume, fades de áudio, velocidade e congelar quadro.
9. Marcadores.
10. Autosave, versões, bins, mídias usadas e religar arquivos ausentes.
11. Waveforms (antecipadas da Fase 3).

## Fase 3: recursos avançados
1. Proxies automáticos e manuais, com alternância proxy/original.
2. Legendas: trilha própria, estilo, importação e exportação de SRT.
3. Presets de animação e LUTs.
4. Presets de exportação e exportador alternativo via FFmpeg com encoders de hardware.
5. Atalhos configuráveis.
6. Rodada de desempenho: medir as metas da seção 1 e atacar os piores pontos.
7. Extras de edição: ripple, roll, slip, áudio acelerado preservando tom.
8. Instalador do Windows assinado e atualização automática.
