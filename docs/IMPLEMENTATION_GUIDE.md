# Guia de Implementação — Detecção de Encontros

> Ordem de execução. Detalhes técnicos e justificativas em [CONTEXT.md](./CONTEXT.md).

## Fase 1 — Setup do projeto
- [x] `git init` + `.gitignore` (`node_modules/`, `dist/`, `datasets/inputs/*.txt` grandes)
- [x] `package.json` (scripts `build`, `start`, `ref`, `validate`, `bench`)
- [x] `tsconfig.json` (`strict`, ES2022, NodeNext)
- [x] Dev deps: `typescript`, `tsx`, `@types/node` (zero deps em runtime)

## Fase 2 — Base
- [ ] `src/types.ts` — `Encontro`, `Posicao`, `TipoEncontro`
- [ ] `src/haversine.ts` — variante `asin` do gabarito
- [ ] `src/output.ts` — serialização JSON (ids crescentes, ordenado por timestamp)
- [ ] `src/validate.ts` — comparador por conjunto (`timestamp + par`), tipo e distância; relatório de bateram/faltaram/sobraram

## Fase 3 — Referência (força bruta)
- [ ] `scripts/reference.ts` — parse simples + todos os pares por timestamp + classificação por prioridade
- [ ] Validar contra `respostas1.json` e `respostas2.json` (100%)
- [ ] Gerar `datasets/reference/referencia{3..7}.json`

## Fase 4 — Versão principal (simples e correta)
- [ ] `src/parse.ts` — parse em bytes sobre `Buffer` (ints ×1e5, timestamp inteiro, streaming por timestamp)
- [ ] `src/detect.ts` — força bruta por timestamp + pré-filtro exato de latitude
- [ ] `src/index.ts` — CLI (`<dataset> [--expected] [--bench N] [--out]`), estatísticas e tempos no console
- [ ] Validar nos 7 datasets (gabaritos + referências)
- [ ] Registrar tempos base (baseline)

## Fase 5 — Otimizações (uma por vez: implementar → validar → medir → manter ou descartar)
- [ ] Micro-otimizações do parse (menos branches, typed arrays pré-alocados)
- [ ] Pré-cálculo por posição (radianos, `cos(lat)`) mantendo distância bit a bit
- [ ] Sweep por latitude vs força bruta filtrada
- [ ] Poda por continuidade temporal
- [ ] `worker_threads` (divisão do buffer em fronteiras de timestamp)
- [ ] Atalho "matriz regular" com fallback genérico
- [ ] Bundle único (esbuild) e medição do tempo de boot
- [ ] Atualizar tabela de benchmarks a cada etapa

## Fase 6 — Robustez
- [ ] Tratar CRLF, BOM, linhas vazias, facção vazia, vítima sem restrição
- [ ] Testes unitários mínimos (haversine, classificação, parse de linha)
- [ ] Revalidar os 7 datasets

## Fase 7 — Entrega
- [ ] Gerar os JSONs finais dos 7 datasets (`outputs/`)
- [ ] `README.md`: lógica, como executar, por que esta abordagem, benchmarks, decisões e evidências, uso de IA
- [ ] Revisão final do código (você precisa saber defender cada parte)
- [ ] Teste do zero: clone limpo → `npm install && npm run build` → executar
- [ ] Compactar (.zip) ou link do GitHub e enviar antes de 03/11/2026 23:59:59

