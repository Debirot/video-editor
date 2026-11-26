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
- **Item de biblioteca** e **diálogo**: entram com a importação (T1.04) e a exportação (T1.10).

Botões sem função ainda aparecem desabilitados com tooltip "(em breve)".

## Atalhos (src/app/shortcuts.ts, T1.06)

| Atalho | Ação |
|---|---|
| Espaço | Reproduzir ou pausar |
| J / K / L | Voltar, pausar, avançar (repetir acelera) |
| ← / → | Um quadro para trás ou para frente |
| Shift + ← / → | Um segundo para trás ou para frente |
| ↑ / ↓ | Corte anterior ou próximo |
| S | Dividir no playhead |
| Delete / Shift + Delete | Apagar / apagar fechando o espaço |
| Ctrl + Z / Ctrl + Shift + Z | Desfazer / refazer |
| Ctrl + C / Ctrl + V / Ctrl + D | Copiar / colar / duplicar |
| M | Adicionar marcador |
| N | Ligar ou desligar snap |
| + / − | Zoom da timeline |
| Ctrl + I / Ctrl + S / Ctrl + E | Importar / salvar / exportar |
