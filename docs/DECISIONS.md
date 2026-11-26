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

### D-011 · 2026-11-26 · Portão 0: a stack se mantém
- Contexto: prova técnica (T1.01) no Windows, WebView2, PC com GPU dedicada.
- Resultados: 4K H.264 High (avc1.640034, 25 fps) decodifica por hardware; tempo real 25,0 qps com atraso máximo de 14,8 ms; velocidade máxima 228 a 259 qps. Gravação de tela 1080p60: tempo real 60,0 qps, máximo ~1.400 qps. Exportação 1080p30 H.264 por hardware: 300 quadros em 3,3 s (90 qps) a partir do 4K e 2,2 s (138 qps) a partir do 1080p. MP4 toca no VLC e no player do Windows. Cancelar não deixa `.partial`. Minimizada: 2,98 s, sem lentidão (backgroundThrottling "disabled" funciona). VideoFrames abertos voltam a 0.
- Decisão: manter Tauri 2 + WebCodecs + WebGL2 + Mediabunny e seguir para T1.02.
- Descartadas: plano B (exportador via FFmpeg) fica para a Fase 3, como previsto.
- Consequências: falta medir num notebook com GPU integrada antes do Portão 1. O descarte do primeiro quadro no modo tempo real vem da tela de teste (relógio começa antes do primeiro quadro) e não existirá no preview de T1.07.

### D-012 · 2026-11-26 · Dependências da interface (T1.02)
- Contexto: esqueleto da interface com painéis redimensionáveis, tooltips e a fonte Inter.
- Decisão: `react-resizable-panels` 4.x (previsto no plano; a v4 usa `Group`/`Panel`/`Separator` e tamanhos em px), `@radix-ui/react-tooltip` (base do Tooltip do shadcn/ui) e `@fontsource-variable/inter` (fonte empacotada, sem rede).
- Descartadas: painéis com CSS próprio (arrasto, teclado e acessibilidade dariam trabalho), `title` nativo no lugar de tooltip (atraso fixo, sem atalho), Inter do Google Fonts (exige rede).
- Consequências: layout salvo no localStorage do WebView; se a estrutura de painéis mudar, trocar os ids `layout-*` para não restaurar um layout incompatível.

### D-013 · 2026-11-26 · FFmpeg 8.1 LGPL estático, baixado no npm install
- Contexto: T1.04 precisa de ffprobe e ffmpeg empacotados; o plano exige build LGPL (sem libx264/libx265).
- Decisão: `scripts/ensure-ffmpeg.mjs` (postinstall) baixa `ffmpeg-n8.1-latest-win64-lgpl-8.1.zip` do BtbN/FFmpeg-Builds e copia `ffmpeg.exe`, `ffprobe.exe` e a licença para `src-tauri/binaries/` com o target triple. No Linux/macOS cria links para o FFmpeg do PATH.
- Descartadas: FFmpeg do PATH também no Windows (instalação diferente em cada máquina); build "shared" com DLLs (menor, mas o Tauri não empacota DLLs de sidecar sozinho).
- Consequências: os dois executáveis somam ~270 MB, o instalador fica grande. O asset "latest" muda com o tempo; antes do instalador (Fase 3), fixar uma versão datada com checksum e avaliar o build shared.

### D-014 · 2026-11-26 · Detalhes da importação
- Contexto: escolhas pequenas da T1.04 que uma sessão futura poderia desfazer sem saber por quê.
- Decisão: pôster em JPEG 320 px de largura a 10% da duração (o encoder mjpeg é nativo do FFmpeg; WebP fica para as folhas de miniaturas). Hash parcial FNV-1a 64 do tamanho + primeiros e últimos 64 KB (sem dependência; não é criptográfico, só nomeia cache). VFR quando `r_frame_rate` e `avg_frame_rate` diferem mais de 0,2%. "Decodificável" é perguntado ao WebCodecs no Worker (`media:check`), não deduzido do codec pelo ffprobe.
- Descartadas: hash do arquivo inteiro (lento em 4K), detectar VFR contando quadros (ffprobe -count_frames lê o arquivo todo), tabela fixa de codecs suportados.
- Consequências: a heurística de VFR pode errar em arquivos com duração mal declarada; a conversão para taxa constante entra com os proxies.

### D-015 · 2026-11-26 · Regras de edição da T1.06a
- Contexto: comportamentos que variam entre editores e que uma sessão futura poderia mudar sem querer.
- Decisão: colar e duplicar sobrescrevem o que estiver no caminho (clearRange), nas trilhas de origem; dividir (S) age só nos clipes selecionados (e nos ligados), como no plano; apagar fechando o espaço (ripple) move só as trilhas onde algo foi apagado; selecionar um clipe seleciona os ligados; a área de transferência é interna do app.
- Descartadas: colar inserindo e empurrando o resto (ripple insert), dividir todas as trilhas sem seleção, ripple sincronizado em todas as trilhas.
- Consequências: apagar com ripple um clipe só de vídeo pode dessincronizar outras trilhas; ripple em todas as trilhas e inserção podem entrar na Fase 3 (ripple, roll, slip).

### D-016 · 2026-11-26 · Preview da T1.07
- Contexto: primeira reprodução real; o relógio do áudio só existe na T1.08.
- Decisão: relógio por performance.now() no Worker até a T1.08; quadros atrasados são descartados (contados) em vez de atrasar o relógio; parado, os quadros guardados são soltos depois de 1,5 s; navegar (setas, Home/End, cortes) pausa; o preview compõe cada camada encaixada (contain) com opacidade, sem transformações (Fase 2).
- Descartadas: renderizar trechos antecipadamente; manter quadros guardados para sempre (o contador nunca voltaria a 0); reprodução para trás com decodificação reversa (complexa).
- Consequências: J é lento em vídeos com GOP longo (recomeça do keyframe a cada quadro); com proxies (Fase 3) melhora.

### D-017 · 2026-11-26 · Áudio do preview
- Contexto: o Web Audio só existe na thread da interface; o plano manda o relógio do áudio comandar o vídeo.
- Decisão: decodificação em um Worker de áudio separado (AudioSampleSink do Mediabunny), PCM transferido sem cópia; agendamento por AudioBufferSourceNode na interface, em blocos (1 s, depois 4 s, ~6 s à frente); correção do relógio do vídeo a cada 200 ms por getOutputTimestamp; sem som fora de 1×; velocidade de clipe muda também o tom (playbackRate) até a Fase 3.
- Descartadas: decodificar no Worker de vídeo (o teste mostrou blocos 2 s atrasados com 4K em software); AudioWorklet com buffer circular (mais código, mesma latência para o preview); decodificar o arquivo inteiro (memória).
- Consequências: o primeiro play tem ~0,2 a 0,5 s de latência; emendas entre blocos são agendadas no tempo exato e não devem estalar, mas isso precisa ser ouvido no Windows.

### D-018 · 2026-11-26 · Exportação do projeto
- Contexto: o plano previa OfflineAudioContext para o áudio final, mas ele não existe em Workers; o primeiro teste com duas faixas travou.
- Decisão: mixagem em código no Worker (mix.ts: interpolação linear para 48 kHz estéreo, mesmo envelope do preview), AudioEncoder AAC com Opus como reserva; uma fila de mux por faixa; falha de gravação aborta na hora; composição compartilhada com o preview (compose.ts); diálogo com `@radix-ui/react-dialog` (base do Dialog do shadcn/ui) e selects nativos.
- Descartadas: exportar o áudio na thread da interface com OfflineAudioContext (bloquearia a interface e duplicaria a mixagem); fila de mux única (deadlock com duas faixas); `@radix-ui/react-select` (mais uma dependência para um select simples).
- Consequências: reamostragem linear é suficiente para a v1; um reamostrador de melhor qualidade pode entrar na Fase 3 se houver aliasing audível.
