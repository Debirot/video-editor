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

Eventos (`job:progress`, `job:done`) entram com a fila de tarefas em T1.04.

### Interface ↔ Worker (postMessage)
Tipos em `src/engine/messages.ts`. Hoje só existem as mensagens da prova técnica
(`proof:*`). O preview real acrescenta `project`, `play`, `pause`, `seek` e `export`.

### Worker ↔ arquivos (protocolo media://)
Implementado em `src-tauri/src/protocol.rs`.

- Base: `http://media.localhost/` no Windows, `media://localhost/` no macOS e Linux
  (`mediaBaseUrl()` em ipc.ts resolve com `convertFileSrc`).
- `GET|HEAD /file/<caminho codificado>`: só arquivos autorizados por `allow_media`.
  Respostas com Range são limitadas a 2 MB (`MAX_CHUNK`); o Mediabunny pede o resto
  com um novo Range. Sem Range, arquivos até 8 MB vêm inteiros.
- `PUT /write/<id>?pos=<n>`: grava um pedaço do MP4 em `<destino>.partial`.
  `finish_export` renomeia para o destino; `cancel_export` apaga o parcial.
- CORS liberado (`*`), porque no Windows a página e o protocolo têm origens diferentes.

### Rust ↔ FFmpeg
Processos filhos com `tokio::process`, progresso de `-progress pipe:1`, cancelamento
matando o processo. Entra em T1.04.

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
