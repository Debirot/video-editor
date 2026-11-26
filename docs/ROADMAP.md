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
- [x] No Windows: importar pelo botão e arrastando do Explorador funciona (validado em 2026-11-26).
      Observação: arrastar não funciona se o app rodar como administrador (o Windows bloqueia).
Fora do escopo: miniaturas da timeline, waveforms, proxies, conversão de VFR, bins.

### T1.05 Timeline · concluída
Objetivo: canvas com régua, trilhas, clipes, playhead e zoom, desenhando só o visível.
Arquivos: src/timeline/{viewport,draw}.ts, src/timeline/TimelineCanvas.tsx, src/app/viewStore.ts,
src/project/commands/clips.ts, src/panels/timeline/TimelinePanel.tsx, src/panels/library/MediaLibrary.tsx,
src/panels/preview/PreviewPanel.tsx
Pronto quando:
- [x] viewport.ts testado: conversões, zoom ancorado, limites, rolagem, linhas das trilhas, régua
      (intervalo mínimo de 80 px, quadros exatos em 29,97)
- [x] appendMediaClip testado: vídeo + áudio ligados, sem sobreposição, duração no quadro,
      imagem 5 s, trilha travada, desfazer/refazer com os mesmos ids
- [x] No navegador: dois cliques põem clipes na timeline; régua move o playhead e o timecode;
      quadro a quadro; Ctrl + roda, botões de zoom e "Mostrar tudo"; rolagem; desfazer
- [ ] No Windows: conferir fluidez do zoom e da rolagem com vários clipes
Fora do escopo: arrastar e mover clipes, seleção, cortar, dividir, encaixe, atalhos (T1.06);
miniaturas ao longo do clipe e waveforms.

### T1.06a Edição por comandos e teclado · concluída
Objetivo: seleção, dividir, apagar, apagar fechando o espaço, copiar, colar, duplicar e atalhos.
Arquivos: src/project/commands/clips.ts, src/project/queries.ts (withLinked, nextCut),
src/app/{selectionStore,shortcuts,editActions,Layout}.ts(x), src/timeline/{hitTest,draw}.ts,
src/timeline/TimelineCanvas.tsx, src/panels/timeline/TimelinePanel.tsx, src/panels/preview/PreviewPanel.tsx
Pronto quando:
- [x] splitClips testado: meio do clipe, borda (não faz nada), speed 2, freeze, keyframes, fades,
      clipe ligado (divide os dois e mantém as metades ligadas), trilha travada, desfazer em um passo
- [x] deleteClips (com e sem ripple), clearRange (dentro, pontas, atravessando), copiar/colar/duplicar
      com novos ids e grupos, trilha travada ou removida; invariantes das trilhas conferidas
- [x] Mapa único de atalhos testado (normalização, Cmd = Ctrl, símbolos sem Shift)
- [x] No navegador: clique seleciona (com o ligado), Ctrl+clique soma, Esc limpa; S, Delete,
      Shift+Delete, Ctrl+C/V/D, Ctrl+Z/Ctrl+Shift+Z, ←/→, Shift+←/→, ↑/↓, Home/End, +/−, Shift+Z;
      atalhos não disparam no campo de nome
- [ ] No Windows: conferir os atalhos e a seleção
Fora do escopo: arrastar, aparar com o mouse, encaixe, seleção por retângulo (T1.06b).

### T1.06b Edição com o mouse · concluída
Objetivo: arrastar clipes (entre trilhas também), aparar pelas bordas, encaixe, seleção por
retângulo, arrastar da biblioteca para a timeline. Cada arrasto é uma transação; Esc cancela.
Arquivos: src/project/commands/clips.ts (moveClips, trimBounds, trimClips, insertMediaAt),
src/timeline/{gestures,snap,hitTest,draw}.ts, src/timeline/TimelineCanvas.tsx, src/app/mediaDrag.ts,
src/app/Layout.tsx, src/panels/library/MediaLibrary.tsx, src/panels/timeline/TimelinePanel.tsx
Pronto quando:
- [x] moveClips testado: tempo com sobrescrita, troca de trilha (o ligado só anda no tempo), vários
      juntos, limites (antes do zero, trilha inexistente ou travada), sem entrada quando não muda
- [x] trimBounds/trimClips testados: vizinho, começo e fim da mídia, speed, 1 quadro mínimo,
      ligados com o limite mais apertado, fonte acompanha o início
- [x] insertMediaAt testado: trilha escolhida, vídeo solto em trilha de áudio, sobrescrita
- [x] snap.ts e hitTest (bordas, retângulo) testados
- [x] No navegador: arrastar da biblioteca com prévia, encaixe em 14 s, mover para 0 s, mover para V2,
      aparar −3 s, Esc cancela sem entrada no histórico, retângulo seleciona, 5× Ctrl+Z volta ao zero
- [ ] No Windows: conferir arrasto da biblioteca (o drop de arquivos do sistema continua funcionando)
Fora do escopo: rolagem automática ao arrastar perto da borda, ripple/roll/slip (Fase 3).

### T1.07 Preview · concluída
Objetivo: reprodução de várias trilhas de vídeo, seek, quadro a quadro, J/K/L, qualidade e proporção.
Arquivos: src/engine/{evaluate,playback,messages,worker}.ts, src/engine/decode/{pool,decoder}.ts,
src/engine/compositor/compositor.ts (aceita ImageBitmap), src/app/{engine,viewStore,shortcuts,editActions}.ts,
src/panels/preview/PreviewPanel.tsx
Pronto quando:
- [x] evaluate.ts testado: camadas de baixo para cima, sourceIn/speed, trilha oculta, clipe desligado,
      mídia ausente/áudio/imagem, limite do fim da mídia
- [x] No navegador (H.264 real no Worker): seek em 5 s mostra o quadro 150; clipe vertical em 15 s mostra
      a fonte em 2,970 s com faixas; PNG com transparência na V2 por cima; Espaço toca e pausa;
      L L = 2×; K pausa; qualidade 1/2; quadros abertos voltam a 0 depois de parado
- [x] No Windows: 1080p30 H.264 tocado até o fim com 1 quadro perdido em 10 s e quadros abertos em 0
      ao parar (validado em 2026-11-26). Falta medir 4K e GPU integrada.
Limitações conhecidas: sem áudio e relógio por performance.now() até T1.08; J (para trás) recomeça
do keyframe a cada quadro, então é lento; transformações, efeitos e textos entram na Fase 2.

### T1.08 Áudio · concluída
Objetivo: mixer em Web Audio, volume, mudo e solo por trilha, áudio ligado ao vídeo, relógio do áudio mestre.
Arquivos: src/engine/{evaluate,audioWorker,messages,playback,worker}.ts, src/engine/audio/decode.ts,
src/engine/decode/pool.ts (referência de tempo do arquivo), src/app/{audio,engine}.ts,
src/panels/timeline/TimelinePanel.tsx
Pronto quando:
- [x] audioSegmentsIn testado: recorte no intervalo, fonte, ganho em dB, mudo, solo, volume mínimo,
      clipes de vídeo e mídia sem áudio ou ausente não tocam
- [x] Envelope de volume testado: fades de entrada e saída, fades que se cruzam, pontos de quebra
- [x] No navegador: AAC 48 kHz do vídeo (A1) e MP3 44,1 kHz (A2) tocam juntos com amplitude real;
      blocos chegam antes da hora (Worker de áudio separado); primeiro bloco sem corte; mudo e solo
      mudam o que toca; em 2× não toca som
- [ ] No Windows: áudio a menos de um quadro do vídeo depois de 2 min (critério do Portão 1)
Fora do escopo: waveforms (Fase 2), áudio acelerado preservando o tom (Fase 3), fades editáveis na interface (Fase 2).

### T1.09 Salvar e abrir · concluída
Objetivo: JSON simples com escrita atômica, sem autosave; registrar mídias ao abrir; tela inicial com recentes.
Arquivos: src-tauri/src/{project_io,commands,main}.rs, src-tauri/capabilities/default.json, src/lib/{ipc,paths}.ts,
src/project/normalize.ts (relPath), src/app/{projectFile,importMedia,shortcuts,editActions,App}.ts(x),
src/panels/{StartScreen,TopBar}.tsx, src/panels/library/MediaLibrary.tsx, src/timeline/draw.ts
Pronto quando:
- [x] project_io testado: pasta a partir da escolha, salvar e abrir, sobrescrever sem sobrar temporário,
      erro claro sem project.json, recentes (sem repetir, máximo 10, some se a pasta sumir, arquivo corrompido)
- [x] paths.ts testado: relativo em Windows (maiúsculas) e Unix, discos diferentes, ida e volta com a pasta movida
- [x] No navegador: tela inicial com recentes; ponto e "•" no título com alterações; Ctrl+S grava com relPath;
      Ctrl+N pergunta (Cancelar mantém, Não salvar descarta); Ctrl+O acha a mídia pelo relPath depois de mover
      a pasta; mídia sumida vira aviso e selo "Ausente"
- [ ] No Windows: salvar, fechar o app (pergunta se houver alterações), abrir pelos recentes
Fora do escopo: autosave e versões, religar mídia ausente (Fase 2).

### T1.10 Exportação · concluída
Objetivo: MP4 H.264 (H.265 quando disponível), resolução, FPS, bitrate, áudio, progresso e cancelamento.
Arquivos: src/engine/{export,exportProject,compose,playback,messages,worker}.ts, src/engine/audio/{mix,envelope}.ts,
src/app/{exportFlow,exportPresets,engine,audio,shortcuts,editActions,Layout}.ts(x),
src/components/ui/dialog.tsx, src/panels/{ExportDialog,TopBar}.tsx
Pronto quando:
- [x] mix.ts testado: reamostragem 44,1 → 48 kHz, mono → estéreo, ganho, fades, início no meio, speed, corte de picos
- [x] exportPresets testado: resoluções na proporção (pares), FPS do projeto primeiro, taxa de bits, tamanho estimado
- [x] Preview e exportação usam a mesma composição (compose.ts)
- [x] No navegador: projeto com vídeo vertical + música exportado em 720p30: ffprobe confirma H.264 1280×720,
      30 fps, 360 quadros, 12,000 s (= timeline), áudio 48 kHz estéreo com níveis coerentes com a mixagem;
      quadro em 5 s é o quadro certo da fonte; teclado responde em ~15 ms durante a exportação;
      cancelar apaga o parcial; falha de gravação vira erro (não trava) e apaga o parcial
- [ ] No Windows: exportar com AAC e H.264 por hardware; abrir no VLC e no player do Windows
Fora do escopo: presets (YouTube, Reels…) e exportador via FFmpeg (Fase 3), pausar tarefas de baixa prioridade (não há ainda).

### Critérios de conclusão da Fase 1 (Portão 1)
- [ ] A prova técnica roda num notebook com GPU integrada e num PC com GPU dedicada
- [ ] Importar três vídeos (4K H.264, vertical de celular, 1080p HEVC) e montar 2 min com 2 trilhas de vídeo e 2 de áudio
- [x] Cortar, dividir, mover e encaixar funcionam por mouse e por atalho
- [x] Um teste aplica 50 comandos e desfaz todos, voltando a um projeto idêntico ao inicial
- [x] Preview 1080p de uma trilha sem queda perceptível (Windows: 1 quadro perdido em 10 s)
- [ ] Áudio a menos de um quadro do vídeo após 2 min (falta medir no Windows)
- [ ] MP4 exportado abre no VLC e no player do Windows; duração igual à timeline (±1 quadro); resolução e FPS confirmados pelo ffprobe
- [ ] A interface responde durante a exportação; cancelar apaga o arquivo parcial
- [x] O contador de VideoFrames abertos volta a zero ao parar a reprodução
- [x] npm test, cargo test e typecheck passando

---

## Fase 2: edição completa

Começou com o Portão 1 ainda com itens a medir no Windows (sincronia de 2 min, exportação com AAC
e H.264 por hardware no VLC e no player do Windows, GPU integrada). Esses itens não dependem da Fase 2
e continuam na lista acima.

### T2.01 Inspetor por seleção, seções Clipe e Áudio · concluída
Objetivo: o inspetor mostra o que vale para a seleção; editar início, duração, volume e fades do clipe.
Arquivos: src/project/commands/clipProps.ts, src/components/ui/number-field.tsx,
src/panels/inspector/{InspectorPanel,ClipInspector}.tsx, src/timeline/draw.ts
Pronto quando:
- [x] setClipAudio testado: limites de volume e fades, fade editado empurra o outro, ignora vídeo e trilha travada
- [x] Campo numérico: digitar (Enter/Esc), setas (Shift ×10), arrastar o rótulo (um passo de desfazer)
- [x] No navegador: inspetor do clipe com o ligado (V1 + A1); fades e volume editados aparecem na timeline
      (rampas) e no histórico; início e duração por timecode; 5× Ctrl+Z volta tudo; vários clipes → resumo
Fora do escopo: transformação (T2.02), editar configurações do projeto.

### T2.02 Transformação · próxima
Posição, escala, rotação, recorte e opacidade no compositor (preview e exportação), seção no inspetor e
alças no preview.

### Demais tarefas da Fase 2
3. Imagens e logotipos, depois formas.
4. Textos e títulos, com fontes do sistema.
5. Ajustes de cor, desfoque e nitidez.
6. Transições: dissolve, fade para preto, deslizar, zoom.
7. Keyframes: motor de interpolação primeiro (com testes), depois a interface no inspetor.
8. Velocidade e congelar quadro (volume e fades já entraram em T2.01).
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
