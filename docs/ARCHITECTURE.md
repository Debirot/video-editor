# Arquitetura

O sistema roda em três lugares: a thread principal do WebView (interface e edição),
um Web Worker (preview e exportação) e o processo Rust (arquivos e FFmpeg).

```
 Thread principal                 Web Worker                       Processo Rust
 ┌──────────────────┐  projeto,  ┌──────────────────┐  bytes de   ┌───────────────────┐
 │ Interface        │  play,seek │ Preview          │◄──mídia─────│ Armazenamento     │
 │ Timeline/edição  │──────────► │  decodifica      │  (media://) │  media://, salvar │
 │ Projeto (store)  │◄────────── │  compõe (WebGL2) │             │  autosave, cache  │
 └──────────────────┘  tempo,    │ Exportação       │──MP4──────► │ Processamento     │
          │            progresso │  VideoEncoder    │  (media://) │  fila, ffprobe,   │
          │                      └──────────────────┘             │  proxies, picos   │
          └──────────── invoke (pedidos) / eventos (progresso) ──►└─────────┬─────────┘
                                                                            │ inicia
                                                                       FFmpeg (filhos)
```

Só o Rust lê e grava arquivos. O Worker recebe os bytes de mídia pelo protocolo
`media://` e devolve o MP4 exportado pelo mesmo protocolo. A interface troca apenas
mensagens pequenas com os dois. Os dados de vídeo nunca passam pela thread da interface.

## Módulos

| Módulo | Onde roda | Pasta | Faz | Não faz |
|---|---|---|---|---|
| Interface | Thread principal | src/app, src/panels, src/components | Painéis, atalhos, timeline em canvas | Decodificar mídia, acessar arquivos |
| Projeto | Thread principal + Rust | src/project, project_io.rs | Tipos, store, abrir, salvar, migrar schema | Desenhar |
| Timeline e edição | Thread principal | src/project/commands, src/timeline | Comandos puros, undo, snap, seleção | Tocar em arquivos ou no Worker |
| Preview | Web Worker | src/engine | Decodificar, compor em WebGL2, mixar áudio, relógio | Alterar o projeto |
| Processamento | Rust + FFmpeg | ffmpeg.rs, jobs.rs, media.rs | ffprobe, miniaturas, waveforms, proxies | Lógica de edição |
| Exportação | Worker (+ Rust grava) | src/engine/export.ts | Laço de quadros, VideoEncoder, mux MP4 | Ter compositor próprio |
| Armazenamento | Rust | protocol.rs, project_io.rs, cache.rs | Escrita atômica, autosave, cache, media:// | Interpretar o projeto |

## Comunicação

### Interface ↔ Rust (invoke e eventos)
Wrappers em `src/lib/ipc.ts`; handlers em `src-tauri/src/commands.rs`.

| Comando | Entrada | Saída | Desde |
|---|---|---|---|
| `allow_media` | `path` | — | T1.01 |
| `begin_export` | `path` (.mp4) | `id: u64` | T1.01 |
| `finish_export` | `id` | bytes gravados | T1.01 |
| `cancel_export` | `id` | — | T1.01 |
| `import_media` | `paths[]` | `ImportOutcome[]` (ok com kind, fingerprint, probe, pôster; ou failed com erro) | T1.04 |
| `save_project` | `path`, `json`, `name` | pasta `.vproj` (grava atômico e põe nos recentes) | T1.09 |
| `open_project` | `path` (pasta ou project.json) | `{ dir, json }` | T1.09 |
| `recent_projects` | — | `RecentProject[]` (só pastas que existem) | T1.09 |
| `attach_media` | `paths[]` | `boolean[]` (existe? autoriza no media://) | T1.09 |

| Evento | Payload | Desde |
|---|---|---|
| `job:done` | `{ key, kind: "poster", mediaHash, ok, error, output }` | T1.04 |

`job:progress` entra com os proxies. Arquivos arrastados para a janela chegam pelo
`onDragDropEvent` do webview (`onFileDrop` em ipc.ts), porque o drop do HTML5 não dá caminhos.

### Interface ↔ Worker (postMessage)
Tipos em `src/engine/messages.ts`. Hoje existem as mensagens da prova técnica
(`proof:*`, só na tela `?prova`) e `media:check` → `media:checked`, que lê o cabeçalho
de um vídeo e diz se o WebCodecs decodifica (aviso de proxy na biblioteca). O cliente
do app fica em `src/app/engine.ts`. O preview real acrescenta `project`, `play`, `pause`,
`seek` e `export`.

### Worker ↔ arquivos (protocolo media://)
Implementado em `src-tauri/src/protocol.rs`.

- Base: `http://media.localhost/` no Windows, `media://localhost/` no macOS e Linux
  (`mediaBaseUrl()` em ipc.ts resolve com `convertFileSrc`).
- `GET|HEAD /file/<caminho codificado>`: só arquivos autorizados por `allow_media`.
  Respostas com Range são limitadas a 2 MB (`MAX_CHUNK`); o Mediabunny pede o resto
  com um novo Range. Sem Range, arquivos até 8 MB vêm inteiros.
- `PUT /write/<id>?pos=<n>`: grava um pedaço do MP4 em `<destino>.partial`.
  `finish_export` renomeia para o destino; `cancel_export` apaga o parcial.
- `GET|HEAD /cache/<relativo>`: arquivos da pasta de cache do app (pôsteres), sem `..`.
- CORS liberado (`*`), porque no Windows a página e o protocolo têm origens diferentes.

### Rust ↔ FFmpeg
`src-tauri/src/ffmpeg.rs` monta todos os argumentos (funções testadas) e roda processos
filhos com `tokio::process`, prioridade abaixo do normal e sem janela de console no Windows.
Os binários são sidecars (`externalBin`); sem eles, cai para o `ffmpeg` do PATH.
A fila (`jobs.rs`) limita a concorrência por prioridade (alta 4, média 2, baixa 1) e não
repete tarefas com a mesma chave (`poster:<hash>`). Progresso por `-progress pipe:1` e
cancelamento entram com os proxies.

### Importação (T1.04)
```
diálogo ou drop → importPaths (src/app/importMedia.ts)
  → import_media (Rust): fingerprint + ffprobe (até 4), allow_media, pôster na fila
  → applyCommand("Importar N mídias", addMedia) — mídias repetidas (mesmo hash) são ignoradas
  → Worker media:check em cada vídeo (decodifica? senão, selo "Proxy")
  → job:done → pôster aparece (media://.../cache/media/<hash>/poster.jpg)
```
O que depende da máquina (pôster pronto, decodificável) fica em `src/app/mediaRuntime.ts`,
indexado pelo hash, e não vai para o project.json.

### Timeline (T1.05)
- `src/timeline/viewport.ts`: geometria pura (tempo ↔ px, zoom ancorado, rolagem, linhas
  das trilhas, marcas da régua), testada.
- `src/timeline/draw.ts`: desenha régua, trilhas, clipes (com pôster e nome) e playhead,
  só o visível, com as cores lidas dos tokens.
- `src/timeline/TimelineCanvas.tsx`: o React só monta o canvas; mudanças no projeto, no
  `viewStore` ou nos pôsteres agendam um redesenho por requestAnimationFrame.
- `src/app/viewStore.ts`: playhead, zoom (px/s), rolagem e largura visível. Fora do projeto
  e do histórico de desfazer.
- Os cabeçalhos de trilha são DOM (TimelinePanel) com as mesmas alturas de `trackLayout`
  (régua 24, trilha 44, faixa 4) e acompanham a rolagem vertical por `translateY`.

### Edição (T1.06a)
- `src/app/shortcuts.ts`: mapa único combinação → ação, sem lógica. `Layout.tsx` escuta o
  teclado e ignora quando o foco está num campo de texto.
- `src/app/editActions.ts`: `runAction(ação)` lê os stores e chama `applyCommand` com os
  comandos puros de `src/project/commands/clips.ts`. Botões e atalhos usam as mesmas ações.
- `src/app/selectionStore.ts`: clipes selecionados e área de transferência (fora do histórico).
  Selecionar um clipe seleciona também os do mesmo `linkGroup` (`withLinked`).
- `src/timeline/hitTest.ts`: régua, trilha + clipe sob o ponteiro (com borda para aparar), ou vazio.

### Preview (T1.07)
```
projectStore ─(projeto + URLs media://)─► Worker: Playback
viewStore.playhead ─(seek, só quando o usuário move)─► Playback
Playback: relógio → frameStart(t) → videoLayersAt (evaluate.ts) → PicturePool.picture
          → Compositor (WebGL2, OffscreenCanvas do painel) → preview:time a cada quadro
```
- `src/engine/evaluate.ts`: camadas visíveis em t (função pura, testada).
- `src/engine/decode/pool.ts`: um decodificador por mídia em uso (no máximo 6, LRU); para frente
  reaproveita o FrameCursor, para trás ou salto > 2 s recomeça do keyframe; imagens viram
  ImageBitmap uma vez. Usos simultâneos da mesma mídia no mesmo quadro usam "slots" separados.
- `src/engine/playback.ts`: laço por requestAnimationFrame do Worker; se a composição anterior
  não terminou, o quadro é descartado e contado. Parado, só o último seek é desenhado (o redesenho
  pendente espera a fila de mensagens do Worker esvaziar), e depois de 1,5 s os quadros guardados
  são soltos (contador volta a 0).
- `src/app/engine.ts`: um Worker para o app; envia o projeto uma vez por rodada de mudanças
  (microtarefa: o desfaz-e-reaplica de um arrasto vira um envio só, do estado final) e o playhead
  quando o usuário o move (ignora o eco do que veio do Worker); a timeline acompanha o playhead tocando.

### Transformação (T2.02)
- `src/engine/transform.ts` (puro, testado): `placeLayer` calcula onde a camada cai na saída
  (centro, tamanho, ângulo e recorte em coordenadas de textura) a partir do tamanho da fonte, da
  rotação gravada no arquivo, do tamanho do projeto e do `transform`/`crop` do clipe.
  `placementMatrix` vira a matriz do shader; `visibleCorners`, `containsPoint` e `toImage` servem
  às alças.
- O compositor desenha cada camada com essa matriz (`drawPlaced`); preview e exportação passam
  por `drawLayers` em compose.ts, então a conta é a mesma nos dois.
- `src/panels/preview/TransformHandles.tsx`: SVG sobre o canvas que usa o mesmo `placeLayer`
  (no tamanho do palco em px CSS) para a moldura cair sobre a imagem. Arrastos usam transação
  como os gestos da timeline.

### Áudio (T1.08)
```
src/app/audio.ts (thread da interface, Web Audio)       audioWorker.ts (Worker só de áudio)
  sessão: t0 na timeline ↔ ctxStart no AudioContext       audioSegmentsIn (evaluate.ts)
  bombeia a cada 200 ms: pede [até, até+4 s) ──audio:render──► AudioPool: AudioSampleSink → PCM f32
  agenda AudioBufferSourceNode + GainNode (ganho e fades) ◄──audio:pcm (buffers transferidos)
  getOutputTimestamp → preview:clock ───────────────────────► Worker de vídeo: Playback.clock()
```
- O relógio do áudio manda: o Worker de vídeo recebe a cada 200 ms o par (tempo da timeline,
  instante absoluto em ms) e recalcula o seu relógio; tempos absolutos usam `performance.timeOrigin`
  porque a origem do `performance.now()` muda entre a página e o Worker.
- O áudio decodifica num Worker próprio para que imagem pesada nunca atrase o som.
- Vídeo e áudio usam a mesma referência de tempo do arquivo (`input.getFirstTimestamp()`).
- Primeiro bloco atrasado: o início da sessão é adiado em vez de cortar o começo do som.
- Em velocidades diferentes de 1× (J/L) o som fica mudo e o Worker de vídeo usa o próprio relógio.
- Mudanças no projeto durante a reprodução reiniciam o som do ponto atual (agrupadas em 120 ms).

### Exportação (T1.10)
```
ExportDialog → exportFlow.startExport: diálogo de salvar → begin_export (Rust abre <arquivo>.partial)
  → Worker: exportProject
       vídeo: videoLayersAt → gatherPictures (PicturePool próprio, originais) → drawLayers (compose.ts,
              o mesmo do preview) → VideoFrame(canvas) → VideoEncoder → EncodedVideoPacketSource
       áudio: audioSegmentsIn → AudioPool → mixInto (48 kHz estéreo, envelope.ts) → AudioEncoder (AAC; Opus
              como reserva) → EncodedAudioPacketSource, em blocos de 1 s à frente do vídeo
       Mp4OutputFormat → StreamTarget (PUT media://.../write/<id>?pos=)
  → export:done → finish_export (renomeia) | export:cancelled ou erro → cancel_export (apaga)
```
- Uma fila de mux por faixa: o muxer intercala as faixas e pode segurar o vídeo até chegar o áudio.
- Falha de gravação avisa o laço na hora (a exportação termina com erro, nunca fica presa).
- Número de quadros = teto(duração × FPS): o último quadro parcial entra.
- Em navegadores sem `OfflineAudioContext` no Worker (todos), a mixagem é feita em código (`mix.ts`).

### Salvar e abrir (T1.09)
- `src/app/projectFile.ts`: salvar (primeira vez pede o local), salvar como, abrir, novo, pergunta
  "Salvar / Não salvar / Cancelar" ao descartar alterações e ao fechar a janela (`onCloseRequested`;
  se a pergunta falhar, a janela fecha mesmo assim), título "• Nome — Editor".
- Ao salvar, `serializeProject(projeto, pasta)` grava o `relPath` de cada mídia. Ao abrir, a mídia é
  procurada no caminho absoluto e, se não estiver lá, pelo `relPath` a partir da pasta atual; a que
  não for achada fica com `missing` (calculado, nunca gravado).
- `src-tauri/src/project_io.rs`: escrita atômica (`.tmp` + `sync_all` + rename) e recentes em
  `app_config_dir/recent.json`.

### Edição com o mouse (T1.06b)
- `src/timeline/gestures.ts`: máquina de gestos (scrub, clique, mover, aparar, retângulo).
  Mover e aparar abrem uma transação; a cada movimento a transação é cancelada e o passo
  reaplicado a partir do estado inicial, então o projeto atualiza ao vivo e o histórico
  recebe uma entrada ao soltar. Esc (capturado antes dos atalhos) cancela.
- `src/timeline/snap.ts`: pontos de encaixe (0, playhead, bordas de clipes, marcadores) a 8 px.
- `src/app/mediaDrag.ts`: arrastar da biblioteca com eventos de ponteiro, porque o
  drag-and-drop do HTML5 não funciona no WebView2 com o drop de arquivos do Tauri ligado.
  A timeline registra um alvo (`setMediaDropTarget`) que desenha a prévia e chama `insertMediaAt`.

## Pipeline de vídeo (validado na prova técnica)

```
media:// (Range) → Mediabunny UrlSource → EncodedPacketSink (demux)
  → VideoDecoder (prefer-hardware, fila ≤ 4) → VideoFrame (adopt/release)
  → Compositor WebGL2 (texImage2D direto do VideoFrame)
  → [preview] OffscreenCanvas transferido da página
  → [export]  VideoFrame(canvas) → VideoEncoder (fila ≤ 8) → EncodedVideoPacketSource
              → Mp4OutputFormat → StreamTarget (pedaços de 4 MB) → media:// write
```

## Edição não destrutiva

Para saber o que aparece no tempo t, o motor faz sempre o mesmo cálculo:
1. Em cada trilha visível, o clipe que cobre t (`clipAt`).
2. Tempo na fonte: `sourceIn + (t − start) × speed` (`sourceTimeAt`).
3. Quadro daquele tempo, do proxy ou do original.
4. Valor de cada propriedade em t, interpolando keyframes.
5. Composição de baixo para cima com transformação, efeitos, opacidade e transições.

## Histórico de desfazer

Toda alteração passa por `applyCommand(label, recipe)`, que usa `produceWithPatches`
do Immer e empilha patches de ida e volta. Arrastos usam `beginTransaction` /
`commitTransaction` (ou `cancelTransaction` no Esc) para virar uma única entrada.
