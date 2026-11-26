# Guia de interface

## Layout: cinco regiões fixas

```
┌───────────────────────── Barra superior (44 px) ─────────────────────────┐
│ ícones │ Biblioteca │          Preview            │      Inspetor        │
│        │            │                             │                      │
├────────┴────────────┴─────────────────────────────┴──────────────────────┤
│                               Timeline                                   │
└──────────────────────────────────────────────────────────────────────────┘
```

O usuário redimensiona e recolhe painéis, mas não os reorganiza. Implementado em
`src/app/Layout.tsx` com `react-resizable-panels`; os tamanhos ficam salvos no
localStorage (`layout-horizontal`, `layout-vertical`).

- Biblioteca: clicar na aba ativa da coluna de ícones recolhe; clicar em qualquer aba abre.
- Inspetor: recolhe e abre pelo botão na barra superior.
- Timeline: não recolhe (mínimo de 140 px, máximo de 70% da altura).
- Arrastar um painel lateral abaixo do mínimo também recolhe.
- Abaixo de 1400 px de largura os painéis laterais começam com 240 px (300 px acima).

- **Barra superior.** Nome do projeto editável, desfazer/refazer, indicador de tarefas,
  configurações e Exportar (o único botão em cor de destaque).
- **Painel esquerdo.** Coluna de ícones alterna Mídia, Áudio, Texto, Transições e Efeitos.
  Uma biblioteca por vez.
- **Painel central.** Preview e controles: timecode, voltar quadro, play, avançar quadro,
  qualidade e proporção. Alças de transformação sobre o clipe selecionado.
- **Painel direito.** Inspetor só com o que vale para a seleção, em seções recolhíveis:
  Transformação, Ajustes de cor, Efeitos, Áudio, Keyframes. Sem seleção: configurações do projeto.
- **Painel inferior.** Régua, trilhas de vídeo em cima e de áudio embaixo, cabeçalhos com
  mudo/ocultar/travar, barra fina com ferramentas, snap e zoom.

## Regras

1. Uma ação tem um lugar principal. Atalhos e menus de contexto são caminhos extras.
2. O inspetor se adapta à seleção, em vez de mostrar controles desabilitados.
3. Arrastar funciona onde faz sentido: biblioteca → timeline, biblioteca → preview, efeito → clipe.
4. Toda espera tem retorno visual: barra na miniatura, toast ao concluir, contagem de tarefas.
5. Estados vazios explicam o próximo passo ("Arraste vídeos aqui ou clique em Importar").
6. Recursos avançados ficam recolhidos até serem usados (keyframes aparecem pelo cronômetro).

## Tokens (src/styles/tokens.css)

Tema escuro neutro, sem tons azulados, com uma única cor de destaque âmbar.

| Token | Valor | Uso | Classe Tailwind |
|---|---|---|---|
| `--bg-0` | #0E0F11 | Fundo da janela | `bg-bg-0` |
| `--bg-1` | #15171A | Painéis | `bg-bg-1` |
| `--bg-2` | #1C1F23 | Campos, cartões, cabeçalhos de trilha | `bg-bg-2` |
| `--border` | #2A2E34 | Divisórias e contornos | `border-border` |
| `--text-1` | #E8EAED | Texto principal | `text-text-1` |
| `--text-2` | #9AA0A6 | Rótulos e texto secundário | `text-text-2` |
| `--accent` | #F2A93B | Seleção, foco, playhead, Exportar | `bg-accent`, `text-accent` |
| `--danger` | #E5484D | Erros, mídia ausente | `text-danger` |
| `--clip-video` | #4C6FA8 | Clipes de vídeo | `bg-clip-video` |
| `--clip-audio` | #3F8F6B | Clipes de áudio | `bg-clip-audio` |
| `--clip-text` | #8A63C9 | Textos e formas | `bg-clip-text` |
| `--clip-image` | #4E8C99 | Imagens | `bg-clip-image` |

- **Tipografia:** Inter; corpo 13 px (`text-body`), rótulos 12 px (`text-label`), títulos de
  painel 14 px (`text-title`). Timecodes com `.tabular` (algarismos tabulares).
- **Ícones:** lucide-react, 16 px, traço 1,5.
- **Espaçamento:** escala de 4 px (4, 8, 12, 16, 24). Cantos de 6 px em controles
  (`rounded-control`) e 8 px em painéis (`rounded-panel`).
- **Animações:** 120 a 180 ms com ease-out, só em painéis, hover e toasts. Zeradas com
  movimento reduzido. A timeline e o playhead nunca animam.
- **Responsividade:** largura mínima de 1100 px. Abaixo de 1400 px, painéis laterais mais
  estreitos e o inspetor pode virar gaveta.

O canvas da timeline lê os mesmos tokens com `getComputedStyle(document.documentElement)`.

## Tela inicial e estado do arquivo

- Tela inicial (`StartScreen`): "Novo projeto" (accent), "Abrir projeto…" e a lista de recentes
  (nome, data, caminho). Aparece ao abrir o app.
- Alterações não salvas: ponto `accent` de 8 px ao lado do nome do projeto e "• " no título da janela.
- Mídia ausente: selo "Ausente" (`danger`) na biblioteca e "Ausente: nome" no clipe, escurecido.

## Componentes base (src/components/ui)

| Componente | Variantes | Desde |
|---|---|---|
| Button | default, accent, ghost, danger · sm, md, icon | T1.01 |
| ResizableGroup, ResizablePanel, ResizableHandle | handle `direction` horizontal ou vertical | T1.02 |
| TooltipProvider, Tooltip, TooltipContent, Tip | `Tip` = rótulo + atalho; funciona em botão desabilitado | T1.02 |

Componentes de painel só montam peças daqui. Se falta uma peça, ela é criada aqui primeiro.

## Padrões de tela

- **Seção do inspetor** (`src/panels/inspector/InspectorSection.tsx`): título em caixa alta
  com seta, conteúdo recolhível; dentro, `InspectorRow` com rótulo de 96 px e valor.
- **Estado vazio** (`EmptyState` em `src/panels/library/LibraryPanel.tsx`): ícone de 32 px
  com traço 1,25 e uma frase que diz o próximo passo.
- **Item de biblioteca** (`MediaItem` em `src/panels/library/MediaLibrary.tsx`): pôster 16:9
  em `object-contain` sobre `bg-0`, duração no canto inferior direito, selos no canto superior
  esquerdo ("Proxy" em `danger`, "VFR" em `accent`, com tooltip explicando), nome truncado.
  Enquanto o pôster é gerado, um spinner; sem pôster (áudio), o ícone do tipo.
- **Aviso de erro** (`ImportErrors`): borda `danger`, título com contagem, lista com nome e motivo, botão fechar.
- **Diálogo**: entra com a exportação (T1.10).
- **Arrastar arquivos**: a janela inteira mostra "Solte para importar" com borda tracejada `accent`.

## Timeline

- Régua de 24 px; trilhas de 44 px; faixa de 4 px entre vídeo e áudio. V2 acima de V1.
- Clipe: retângulo com cantos de 4 px na cor do tipo (`clip-video`, `clip-audio`, `clip-image`,
  `clip-text`), contorno `text-1` a 25%, pôster 16:9 no começo (vídeo) e nome em 12 px.
  O nome fica preso à borda esquerda quando o começo do clipe sai da tela.
  Trilha oculta ou muda: clipes a 35% de opacidade.
- Playhead: linha de 1 px em `accent` com alça pentagonal na régua.
- Cabeçalho de trilha de áudio: solo (fone, `accent` quando ligado), mudo (`danger`), trava e,
  embaixo, volume de −60 dB (mudo) a +12 dB; dois cliques voltam a 0 dB; arrastar é um passo de desfazer.
- Régua: marcas principais com pelo menos 80 px entre si (quadros, segundos ou minutos,
  conforme o zoom), marcas menores entre elas; rótulos "m:ss" ou "m:ss:ff".
- Mouse: clicar ou arrastar na régua move o playhead (no início do quadro);
  roda rola na horizontal (na vertical só se as trilhas não couberem, ou com Shift invertido);
  Ctrl + roda dá zoom no cursor. Botões: −, +, "Mostrar tudo".
- Até T1.06, dois cliques numa mídia da biblioteca a colocam no fim da V1 (e o áudio na A1).

Botões sem função ainda aparecem desabilitados com tooltip "(em breve)".

## Atalhos (src/app/shortcuts.ts)

| Atalho | Ação | Desde |
|---|---|---|
| ← / → | Um quadro para trás ou para frente | T1.06a |
| Shift + ← / → | Um segundo para trás ou para frente | T1.06a |
| ↑ / ↓ | Corte anterior ou próximo | T1.06a |
| Home / End | Início / fim da timeline | T1.06a |
| S | Dividir os clipes selecionados no playhead | T1.06a |
| Delete / Shift + Delete | Apagar / apagar fechando o espaço (só nas trilhas afetadas) | T1.06a |
| Ctrl + Z / Ctrl + Shift + Z (ou Ctrl + Y) | Desfazer / refazer | T1.06a |
| Ctrl + C / Ctrl + V / Ctrl + D | Copiar / colar no playhead / duplicar logo depois | T1.06a |
| Ctrl + A / Esc | Selecionar tudo / limpar seleção | T1.06a |
| N | Ligar ou desligar encaixe | T1.06a |
| + / − / Shift + Z | Zoom da timeline / mostrar tudo | T1.06a |
| Ctrl + I | Importar | T1.06a |
| Espaço | Reproduzir ou pausar | T1.07 |
| J / K / L | Tocar para trás / pausar / tocar para frente; repetir J ou L dobra (até 8×) | T1.07 |
| M | Adicionar marcador | Fase 2 |
| Ctrl + S / Ctrl + Shift + S | Salvar / salvar como | T1.09 |
| Ctrl + O / Ctrl + N | Abrir / novo projeto | T1.09 |
| Ctrl + E | Exportar | T1.10 |

Seleção: clique num clipe seleciona ele e o clipe ligado (vídeo + áudio do mesmo arquivo);
Ctrl + clique soma ou tira; clique em área vazia limpa; arrastar na área vazia desenha um
retângulo (`accent` a 12% com contorno) que seleciona o que tocar. Selecionado = contorno de 2 px em `accent`.

Mouse na timeline (T1.06b):
- Cursor `grab` sobre o corpo do clipe, `grabbing` ao arrastar, `ew-resize` a até 6 px das bordas.
- Arrastar o corpo move a seleção; subir ou descer troca de trilha (só entre trilhas do mesmo tipo).
- Arrastar a borda apara (o ligado junto), sem passar do vizinho nem do começo/fim da mídia.
- Encaixe (N liga/desliga) a 8 px de bordas de clipes, playhead e zero.
- Arrastar da biblioteca: etiqueta com o nome segue o cursor; sobre a timeline, contorno tracejado
  `accent` mostra onde vídeo e áudio vão cair.
- Esc durante qualquer arrasto cancela.
