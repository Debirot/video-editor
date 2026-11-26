# Modelo de dados

O projeto inteiro é um objeto TypeScript serializado em `project.json`, com clipes e
transições aninhados nas trilhas. Os tipos vivem em `src/project/types.ts`; este
documento explica as regras. Mudou um tipo? Atualize aqui e em `normalize.ts` no mesmo commit.

## Regras de tempo

- `start`, `duration`, `sourceIn` e tempos de keyframe são **inteiros em µs**.
- FPS é racional: `{ num: 30000, den: 1001 }` para 29,97.
- A duração de um quadro é `1_000_000 × den / num`, que nem sempre é inteira.
  Por isso não existe "duração do quadro" no modelo; use as funções de `src/lib/time.ts`:
  - `frameToUs(n, fps)`: início do quadro n, arredondado ao µs.
  - `usToFrame(t, fps)`: quadro que contém t. Ida e volta exata (testado até 10 h).
  - `snapToFrame(t, fps)`: início de quadro mais próximo.
  - `formatTimecode` / `parseTimecode`: HH:MM:SS:FF sem drop-frame, FPS nominal.
- A interface sempre arredonda posições ao quadro antes de gravar no modelo.
- Keyframes usam tempo relativo ao início do clipe; mover o clipe não exige atualizá-los.
- Trilhas de vídeo: índice 0 fica por baixo na composição.
- Clipes de uma trilha ficam ordenados por `start`, sem sobreposição (`trackProblems`).

## Estrutura

```
Project
├─ schemaVersion: 1, id, name
├─ settings { width, height, fps, sampleRate: 48000, background }
├─ bins[]    { id, name, parentId }
├─ media[]   { id, kind, path, relPath, fingerprint, probe, proxy, binId, missing? }
├─ tracks[]  { id, kind, name, hidden, muted, locked, solo, gainDb, clips[], transitions[] }
│   └─ clips[] { id, kind, mediaId?, start, duration, sourceIn, speed, linkGroup?, enabled,
│                transform, crop, color, effects[], audio?, text?, shape?, keyframes }
└─ markers[] { id, time, name, color }
```

Detalhes que importam:
- `Media.missing` é calculado ao abrir e nunca é gravado (`serializeProject` remove).
- Uma propriedade com keyframes ignora o valor estático do clipe.
- Keyframes são endereçados por caminho: `"transform.opacity"`, `"effects.e_1.radius"`.
  Efeitos usam o id, então reordenar efeitos não quebra animações.
- Uma transição exige mídia sobrando além do corte nos dois clipes; o comando que a cria verifica.
- `linkGroup` liga vídeo e áudio importados do mesmo arquivo.

## Ids

`newId(prefixo)` em `src/lib/ids.ts`: prefixo + 8 caracteres (`c_7fK2xQ9a`).
Prefixos: p projeto, m mídia, b bin, t trilha, c clipe, e efeito, x transição, k marcador, g grupo.

## Abrir e salvar

- `normalizeProject(json)` é a única porta de entrada de um arquivo lido do disco:
  valida o essencial (ids, tempos inteiros, FPS racional), preenche valores padrão
  omitidos, ordena clipes e aplica migrações de `schemaVersion`.
- Projeto de versão mais nova que o app é recusado com mensagem clara.
- Para criar a versão 2: adicionar `MIGRATIONS[1]` em normalize.ts e subir
  `CURRENT_SCHEMA_VERSION` em types.ts, com teste de migração.

## Pasta de um projeto

```
Viagem a Morretes.vproj/
├─ project.json
├─ versions/
│  ├─ 2026-11-26T14-30-00.json
│  └─ 2026-11-26T15-10-00_antes-da-cor.json   (marcada manualmente)
└─ assets/                                     LUTs e fontes copiadas (opcional)
```

O cache (miniaturas, picos, proxies) fica na pasta de dados do app, por hash da mídia.

## Exemplo

O exemplo completo (dois clipes com dissolve, título com fade por keyframes, áudio
original e música com fades) está no plano técnico, seção 6. Um projeto com 500 clipes
fica na casa de algumas centenas de KB.
