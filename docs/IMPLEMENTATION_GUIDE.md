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
- [x] **`worker_threads` (divisão do buffer em fronteiras de timestamp)**: Principal vetor de aceleração. Como cada timestamp é independente, fatiar o buffer em $K$ blocos alinhados por quebra de linha com novo timestamp permite processamento multi-core paralelo do dataset 7 sem dependência de estado.
- [x] **Micro-otimizações do parse**: Refinar a varredura byte a byte em `src/parse.ts` (ex.: testar `buffer.indexOf(10, pos)` com SIMD nativo do C++/V8 para pular colunas de IDs já conhecidos, simplificar leitura inteira de coordenadas), reduzindo tempo de CPU mantendo compatibilidade genérica com CSV.
- [x] **Teste: Sweep por latitude vs. força bruta filtrada**: Testar se ordenar as posições por latitude para interrupção precoce (*break*) compensa o custo de ordenação ($O(N \log N)$ para $N \le 120$) em relação às subtrações inteiras já residentes em cache L1.
- [x] **Pool de Memória Compartilhada (`SharedArrayBuffer` reutilizável)**: Reutilizar a instância de `SharedArrayBuffer` entre execuções (`--all` e `--bench N`), realocando apenas quando o próximo arquivo exceder a capacidade atual, eliminando o custo repetido de *zero-fill* do kernel e ~155.000 *Page Faults* de memória virtual no dataset 7.
- [x] **Inicialização Antecipada dos Workers (*Overlap* de Boot com I/O)**: Disparar a criação do pool de `worker_threads` antes da leitura em disco para arquivos `>= 4 MB`, sobrepondo o tempo de boot das threads V8 (~40–60 ms) com o tempo de transferência de I/O.
- [x] **Comparação de Timestamp em Palavras de 32 Bits (`DataView.getInt32`)**: Substituir as 14 comparações individuais de bytes na verificação de mesmo timestamp por leituras inteiras de 32 bits (`DataView`) comparadas contra registradores locais (`tsRef0..tsRef4`), reduzindo de 28 leituras de memória para 5 quando o timestamp se mantém igual (99,17% das linhas).
- [x] **Empacotamento de Chave 32-bits (`latInt << 7 | idx`) no ShellSort**: Ordenar um único `Int32Array` empacotando latitude e índice original (para $N \le 128$, com *fallback* automático para 3 arrays se $N > 128$), reduzindo em 3x as leituras/escritas de memória durante a ordenação e lendo `ids`/`lons` apenas nos raros pares que passam pelo filtro de 20 m de latitude.
- [x] **Metodologia de benchmark e validação contínua**: Executar `--bench N` (com aquecimento JIT) e validação contra os oráculos (`scripts/reference.ts` e gabaritos) a cada mudança; manter apenas o que apresentar ganho mensurável.

### Otimizações descartadas (decisões arquiteturais e justificativas)
- [x] ~~**Pré-cálculo por posição (radianos e `cos(lat)`)**~~:
  - *Justificativa*: Após a poda por *Sweep-Line 1D* de latitude, o Haversine só é chamado para pares a menos de 20 m de latitude (< 200 chamadas em 12 milhões de linhas no dataset 7, custando < 0,01 ms no total). Pré-calcular `cos(lat)` por linha trocaria ~200 chamadas por 12.000.000 de chamadas trigonométricas inúteis, enquanto converter graus em radianos antes da subtração quebra a igualdade bit a bit IEEE 754 com os gabaritos.
- [x] ~~**Poda por continuidade temporal**~~:
  - *Justificativa*: O pré-filtro atual de latitude já descarta pares em 1 ciclo de CPU (subtração inteira). Rastrear e consultar tabelas de "cooldown" por par na memória adiciona overhead de lookup e cria dependência de estado entre timestamps vizinhos, complicando ou inviabilizando a divisão limpa em `worker_threads`.
- [x] ~~**Atalho "matriz regular"**~~:
  - *Justificativa*: Risco de *overfitting* estrutural aos datasets atuais. Manter o parser genérico em streaming garante que a solução funcione mesmo com leituras faltantes (perda de sinal de GPS), ordem variada de IDs ou datasets ligeiramente diferentes, defendendo a robustez e generalidade do código.
- [x] ~~**Bundle único com esbuild**~~:
  - *Justificativa*: *Overengineering* sem ganho prático. O projeto tem zero dependências em runtime e apenas 6 módulos compilados que o Node.js carrega em ~2 a 4 ms. O ganho no tempo de boot é estatisticamente desprezível frente ao processamento do dataset 7.

## Fase 6 — Robustez
- [x] Tratar CRLF, BOM, linhas vazias, facção vazia, vítima sem restrição
- [x] Testes unitários mínimos (haversine, classificação, parse de linha)
- [x] Revalidar os 7 datasets

## Fase 7 — Entrega
- [ ] Gerar os JSONs finais dos 7 datasets (`outputs/`)
- [ ] `README.md`: lógica, como executar, por que esta abordagem, benchmarks, decisões e evidências, uso de IA
- [ ] Revisão final do código (você precisa saber defender cada parte)
- [ ] Teste do zero: clone limpo → `npm install && npm run build` → executar
- [ ] Compactar (.zip) ou link do GitHub e enviar antes de 03/11/2026 23:59:59

