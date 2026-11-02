# Guia de Implementação — Detecção de Encontros

> Ordem de execução. Detalhes técnicos e justificativas em [CONTEXT.md](./CONTEXT.md).

## Fase 1 — Setup do projeto
- [x] `git init` + `.gitignore` (`node_modules/`, `dist/`, `datasets/inputs/*.txt` grandes)
- [x] `package.json` (scripts `build`, `start`, `ref`, `validate`, `bench`)
- [x] `tsconfig.json` (`strict`, ES2022, NodeNext)
- [x] Dev deps: `typescript`, `tsx`, `@types/node` (zero deps em runtime)

## Fase 2 — Base
- [x] `src/types.ts` — `Encontro`, `Posicao`, `TipoEncontro`
- [x] `src/haversine.ts` — variante `asin` do gabarito
- [x] `src/output.ts` — serialização JSON (ids crescentes, ordenado por timestamp)
- [x] `src/validate.ts` — comparador por conjunto (`timestamp + par`), tipo e distância; relatório de bateram/faltaram/sobraram

## Fase 3 — Referência (força bruta)
- [x] `scripts/reference.ts` — parse simples + todos os pares por timestamp + classificação por prioridade
- [x] Validar contra `respostas1.json` e `respostas2.json` (100%)
- [x] Gerar `datasets/reference/referencia{3..7}.json`

## Fase 4 — Versão principal (simples e correta)
- [x] `src/parse.ts` — parse em bytes sobre `Buffer` (ints ×1e5, timestamp inteiro, streaming por timestamp)
- [x] `src/detect.ts` — força bruta por timestamp + pré-filtro exato de latitude
- [x] `src/index.ts` — CLI (`<dataset> [--expected] [--bench N] [--out]`), estatísticas e tempos no console
- [x] Validar nos 7 datasets (gabaritos + referências)
- [x] Registrar tempos base (baseline)

## Fase 5 — Otimizações (uma por vez: implementar → validar → medir → manter ou descartar)

### Otimizações a testar e implementar
- [ ] **`worker_threads` (divisão do buffer em fronteiras de timestamp)**: Principal vetor de aceleração. Como cada timestamp é independente, fatiar o buffer em $K$ blocos alinhados por quebra de linha com novo timestamp permite processamento multi-core paralelo do dataset 7 sem dependência de estado.
- [ ] **Micro-otimizações do parse**: Refinar a varredura byte a byte em `src/parse.ts` (ex.: testar `buffer.indexOf(10, pos)` com SIMD nativo do C++/V8 para pular colunas de IDs já conhecidos, simplificar leitura inteira de coordenadas), reduzindo tempo de CPU mantendo compatibilidade genérica com CSV.
- [ ] **Teste: Sweep por latitude vs. força bruta filtrada**: Testar se ordenar as posições por latitude para interrupção precoce (*break*) compensa o custo de ordenação ($O(N \log N)$ para $N \le 120$) em relação às subtrações inteiras já residentes em cache L1.
- [ ] **Teste: Pré-cálculo por posição (radianos e `cos(lat)`)**: Avaliar se pré-calcular termos trigonométricos por monitorado compensa. Medir se a computação adiantada não gera overhead desnecessário, já que o pré-filtro descarta $>99\%$ dos pares antes do Haversine (exigência estrita: igualdade bit a bit).
- [ ] **Metodologia de benchmark e validação contínua**: Executar `--bench N` (com aquecimento JIT) e validação contra os oráculos (`scripts/reference.ts` e gabaritos) a cada mudança; manter apenas o que apresentar ganho mensurável.

### Otimizações descartadas (decisões arquiteturais e justificativas)
- [x] ~~**Poda por continuidade temporal**~~:
  - *Justificativa*: O pré-filtro atual de latitude já descarta pares em 1 ciclo de CPU (subtração inteira). Rastrear e consultar tabelas de "cooldown" por par na memória adiciona overhead de lookup e cria dependência de estado entre timestamps vizinhos, complicando ou inviabilizando a divisão limpa em `worker_threads`.
- [x] ~~**Atalho "matriz regular"**~~:
  - *Justificativa*: Risco de *overfitting* estrutural aos datasets atuais. Manter o parser genérico em streaming garante que a solução funcione mesmo com leituras faltantes (perda de sinal de GPS), ordem variada de IDs ou datasets ligeiramente diferentes, defendendo a robustez e generalidade do código.
- [x] ~~**Bundle único com esbuild**~~:
  - *Justificativa*: *Overengineering* sem ganho prático. O projeto tem zero dependências em runtime e apenas 6 módulos compilados que o Node.js carrega em ~2 a 4 ms. O ganho no tempo de boot é estatisticamente desprezível frente ao processamento do dataset 7.

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

