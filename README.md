# Desafio Tecnico: Deteccao de Encontros Fisicos em Larga Escala

Motor de alta performance em TypeScript e Node.js (zero dependencias em runtime) para processamento de logs massivos de geolocalizacao e deteccao exata de encontros fisicos entre monitorados por tornozeleira eletronica e vitimas com medida protetiva.

---

## 1. Visao Geral do Problema e Regras de Negocio

O algoritmo processa arquivos CSV (separados por `;`) contendo posicionamentos gerados a cada 5 segundos e detecta encontros fisicos sob as seguintes regras estritas:

- **Raio de Encontro:** Distancia estritamente menor que **20 metros** (`distanciaMetros < 20`).
- **Formula Geodesica:** Formula de Haversine considerando o raio da Terra `R = 6.371.000 metros`.
- **Sincronia Temporal:** Apenas posicionamentos com o **exato mesmo timestamp** sao comparados entre si.
- **Unicidade e Hierarquia de Classificacao:** Cada par de individuos gera no maximo **um unico registro por timestamp** (chave canonica `timestamp + menorId:maiorId`), classificado pela prioridade estrita:
  1. `protetiva`: Encontro entre uma vitima (`medidaProtetiva == true`) e um agressor listado em seu campo `idsRestricaoMedida`.
  2. `faccao`: Encontro entre dois monitorados (nao-vitimas) que possuem a mesma faccao preenchida (`faccao != ""`).
  3. `generico`: Encontro entre quaisquer dois monitorados (nao-vitimas) de faccoes diferentes ou sem faccao.
- **Pontuacao Oficial:** `Score = soma_encontros_corretos - soma_falsos_positivos`, com desempate pelo **menor tempo medio de execucao** somado nos datasets.

---

## 2. Como Executar o Projeto

### Pre-requisitos
- **Node.js** v20+ (testado em Node.js v22.18.0)
- **npm** (apenas para instalar `typescript`, `tsx` e `@types/node` em desenvolvimento; o projeto possui **zero dependencias em runtime**)

### Instalacao e Compilacao
```bash
npm install
npm run build
```

### Comandos Principais (Codigo Compilado em `dist/`)

1. **Processar todos os 7 datasets, validar contra os gabaritos/referencias e gerar os JSONs finais em `outputs/`:**
   ```bash
   node dist/index.js --all --out
   ```

2. **Executar em Modo Benchmark (com warmup JIT + N iteracoes medidas por dataset):**
   ```bash
   node dist/index.js --all --out --bench 10
   ```

3. **Processar um dataset especifico:**
   ```bash
   node dist/index.js datasets/inputs/dataset1.txt --expected datasets/outputs/respostas1.json --out outputs/dataset1.json
   ```

4. **Executar a bateria de testes automatizados (Precisao Bit-a-Bit, Serializacao e Casos de Borda):**
   ```bash
   npm test
   ```

5. **Executar o Oraculo de Referencia (Forca Bruta O(N^2) em streaming):**
   ```bash
   npm run ref
   ```

---

## 3. Estrutura do Projeto e Fluxo de Execucao

```text
Detectar_Encontros/
|-- src/
|   |-- types.ts       # Contratos estritos de dominio, TypedArrays, frames e workers
|   |-- haversine.ts   # Formula de Haversine exata (variante asin) e constantes de poda
|   |-- parse.ts       # Parser binario zero-allocation sobre Buffer e fatiador de timestamps
|   |-- detect.ts      # Sweep-Line 1D (ShellSort 32-bits), classificador O(1) e pool de Workers
|   |-- worker.ts      # Thread de execucao paralela sobre fatias de SharedArrayBuffer
|   |-- output.ts      # Ordenacao canonica e serializacao JSON manual
|   |-- validate.ts    # Validador por conjunto, checagem bit-a-bit e calculo do Score oficial
|   +-- index.ts       # CLI principal, modo benchmark e relatorios de execucao
|-- scripts/
|   |-- reference.ts       # Oraculo de referencia forca bruta O(N^2) para validacao cruzada
|   |-- test_phase2.ts     # Testes de exatidao bit-a-bit (10/10) e round-trip de JSON
|   |-- test_robustness.ts # Testes unitarios de fronteira matematica e casos de borda
|   +-- test_torture.ts    # Gerador de dataset adversarial de estresse (pior caso O(N^2))
|-- datasets/
|   |-- inputs/            # Datasets de entrada (dataset1.txt a dataset7.txt)
|   |-- outputs/           # Gabaritos oficiais fornecidos (respostas1.json e respostas2.json)
|   +-- reference/         # Oraculos gerados pela forca bruta (referencia3.json a referencia7.json)
+-- outputs/               # Arquivos JSON finais gerados pela solucao (dataset1.json a dataset7.json)
```

### Pipeline de Processamento

```text
[Arquivo .txt em Disco]
          |
          v  fs.readSync direto em SharedArrayBuffer reutilizavel
[Buffer Binario Compartilhado]
          |
          +---> (< 4 MB) ---> [Execucao Single-Thread Sincrona]
          |
          +---> (>= 4 MB) --> [calcularFatiasPorTimestamp (K blocos sem quebrar timestamps)]
                                        |
                    +-------------------+-------------------+
                    v                   v                   v
               [Worker 1]          [Worker 2]   ...    [Worker K]
                    |                   |                   |
                    +-------------------+-------------------+
                                        |
                                        v  Em cada Worker / Timestamp:
             1. Parse byte a byte (lat/lon -> Int32 x 1e5, Timestamp -> DataView 32-bits)
             2. Metadados O(1) em TypedArrays (salta colunas estaticas se ID ja conhecido)
             3. Empacotamento 32-bits ((latInt << 7) | idx) + ShellSort (Ciura gaps)
             4. Sweep-Line 1D com Early Break (|delta_lat| >= 18 unidades -> break)
             5. Classificacao O(1) + Haversine exato apenas nos pares sobreviventes
                                        |
                                        v
             [Agregacao + Ordenacao Canonica + Serializacao JSON em outputs/]
```

---

## 4. Engenharia Reversa dos Gabaritos e Decisoes de Dominio

Antes de otimizar o algoritmo, os datasets e os gabaritos oficiais (`respostas1.json` e `respostas2.json`) foram submetidos a uma analise exploratoria rigorosa para eliminar ambiguidades do enunciado:

1. **Reproducao Bit-a-Bit da Formula de Haversine (IEEE 754):**
   - Existem multiplas formas algebricamente equivalentes de escrever Haversine em ponto flutuante de 64 bits (`double`), mas que divergem nos ultimos bits da mantissa.
   - Testando variantes contra os 10 encontros oficiais dos gabaritos 1 e 2:
     - Converter `lat`/`lon` para radianos antes de subtrair: **0/10** iguais bit-a-bit.
     - Usar `2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))`: **9/10** iguais bit-a-bit.
     - Subtrair em graus antes de converter para radianos e usar `2 * R * Math.asin(Math.sqrt(h))` passando sempre o **menor ID como primeiro ponto**: **10/10 identicos bit-a-bit (`===`)**.
   - Expressao exata adotada em `src/haversine.ts`:
     ```ts
     const dp = (lat2 - lat1) * Math.PI / 180;
     const dl = (lon2 - lon1) * Math.PI / 180;
     const h =
       Math.sin(dp / 2) ** 2 +
       Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dl / 2) ** 2;
     return 2 * 6371000 * Math.asin(Math.sqrt(h));
     ```

2. **Chave de Unicidade e Prioridade de Tipos:**
   - Dois membros da mesma faccao sao, por definicao, dois monitorados. Os gabaritos confirmaram que um par jamais gera dois registros no mesmo timestamp (ex.: um `faccao` e um `generico`). A chave de unicidade e `timestamp|menorId:maiorId`, prevalecendo `protetiva > faccao > generico`.

3. **Decisao Defensiva para Vitimas:**
   - O enunciado define `generico` como encontro entre "quaisquer dois monitorados", diferenciando conceitualmente Monitorados/Agressores (tornozeleira) de Vitimas (rastreador portatil).
   - Caso uma vitima passe a menos de 20m de outra vitima ou de um monitorado que **nao** conste em seu `idsRestricaoMedida`, o classificador retorna `null` (nao emite encontro). Como cada falso positivo subtrai 1 ponto do `Score`, essa guarda evita penalidades indevidas.

---

## 5. Por Que Esta e a Melhor Abordagem (Engenharia de Performance)

### O Verdadeiro Gargalo: I/O e Parse vs. Geometria
A analise de perfil dos 7 datasets revelou um fato fundamental para a arquitetura:
- O maior arquivo (`dataset7.txt`) possui **12.000.000 de linhas (609 MB)** e **100.000 timestamps**, mas no maximo **120 monitorados por timestamp** (`N <= 120`).
- Em `dataset7.txt`, o arquivo inteiro de 609 MB **excede o limite maximo de string do V8 (~512 MB)** (`fs.readFileSync(path, 'utf8')` falha com `ERR_STRING_TOO_LONG`).
- Portanto, o gargalo real nao e o calculo trigonometrico, e sim a **leitura de disco, a pressao no Garbage Collector (GC) e a conversao de texto para estruturas numericas**.

Com base nisso, a solucao foi projetada sobre tres pilares:

### Pilar 1: Parser Binario Zero-Allocation sobre `Buffer` (`src/parse.ts`)
- **Zero Strings no Loop Quente:** O buffer e percorrido byte a byte com ponteiros inteiros (`pos`). Nao ha chamadas a `.split(';')`, `.slice()`, `.trim()` ou `parseFloat()` durante a leitura das coordenadas.
- **Coordenadas em Ponto Fixo (`Int32Array`):** Latitudes e longitudes sao lidas diretamente dos bytes ASCII e convertidas em inteiros escalados por `10^5` (`latInt`, `lonInt`). Um *fast-path* desenrolado (*loop unrolling*) processa coordenadas padrao de 5 casas decimais em uma unica expressao aritmetica, mantendo um *fallback* seguro (`MULT_CASAS`) para coordenadas com menos casas decimais ou inteiras.
- **Comparacao de Timestamp em Palavras de 32 Bits (`DataView.getInt32`):** Como 99,17% das linhas consecutivas no `dataset7.txt` pertencem ao mesmo timestamp da linha anterior, comparar 19 caracteres byte a byte exigiria ate 38 leituras. Usando `DataView.getInt32` a partir dos segundos (`tsOffset + 15`), o parser verifica se o timestamp mudou em apenas **5 comparacoes de registradores de 32 bits**. A string `"YYYY-MM-DD HH:MM:SS"` so e decodificada (`utf8`) nos raros frames em que um encontro real (< 20m) e confirmado (apenas 35 vezes em 12 milhoes de linhas).
- **Salto de Colunas Cadastrais (Metadados O(1)):** Faccao, flag de vitima e lista de agressores sao constantes por `idMonitorado`. Na primeira vez que um ID aparece (`metaConhecido[id] === 0`), seus atributos sao gravados em `TypedArrays` indexados diretamente pelo proprio ID (`faccaoPorId`, `ehVitimaPorId`, `agressorUnicoPorId`). Em todas as aparicoes subsequentes desse ID (99,999% das linhas), o parser salta as colunas de faccao, booleano e restricao com um `while (buffer[pos] !== 10) pos++`.

### Pilar 2: Sweep-Line 1D por Latitude e Bit-Packing 32-Bits (`src/detect.ts`)
- **Limite Matematico Exato de Latitude:** Na formula de Haversine, a distancia total e sempre maior ou igual a componente meridional (`d >= R * |delta_lat|`). Logo, para `d < 20m`, e matematicamente obrigatorio que:
  ```text
  |lat2 - lat1| < (20 / 6371000) * (180 / PI) = 0.000179864 graus
  ```
  Em inteiros escalados por `10^5`, qualquer par com `|latIntB - latIntA| >= 18` (`0.00018 graus` ~= `20,015 metros`) **jamais** pode configurar um encontro.
- **ShellSort In-Place com Empacotamento de Bits:** Em vez de testar todos os `N * (N - 1) / 2` pares (`7.140` pares para `N = 120`), o algoritmo empacota a latitude inteira e o indice original em um unico `Int32` (`chave = (latInt << 7) | idx` para `N <= 128`, com *fallback* automatico para `N > 128`) e ordena o vetor com *ShellSort* (gaps de Ciura: `[57, 23, 10, 4, 1]`).
- **Interrupcao Precoce (*Early Break*):** Com o vetor ordenado por latitude, o loop interno avanca apenas enquanto `chaveB < chaveLimite` (`latIntA + 18`), executando `break` imediato no primeiro vizinho que ultrapassa 20 metros Norte-Sul. No `dataset7.txt` (12 milhoes de linhas), isso reduz as chamadas reais de Haversine para **menos de 200 em todo o arquivo** (< 0,01 ms de custo trigonometrico total).

### Pilar 3: Paralelismo Multi-Core Zero-Copy (`SharedArrayBuffer` + `worker_threads`)
- **Particionamento sem Dependencia de Estado:** Para arquivos `>= 4 MB`, `calcularFatiasPorTimestamp` divide o buffer em `K` fatias (onde `K = os.availableParallelism()`), ajustando o corte de cada fatia para a proxima quebra de linha onde o timestamp muda. Assim, nenhum timestamp e dividido ao meio e cada worker opera de forma 100% independente.
- **Pool de `SharedArrayBuffer` Reutilizavel:** Alocar e liberar buffers de 609 MB repetidamente forcaria o sistema operacional a zerar a memoria (*zero-fill*) e geraria ~155.000 *Soft Page Faults* (paginas de 4 KB) a cada execucao. O motor mantem uma instancia global reutilizavel de `SharedArrayBuffer`, além de disparar a inicializacao do pool de workers antes do inicio da leitura de disco (*overlap* de boot com I/O).

---

## 6. Hipoteses Avaliadas e Descartadas

Durante a Fase 5, todas as ideias de otimizacao foram submetidas ao ciclo `implementar -> validar bit-a-bit -> medir no benchmark`. As seguintes abordagens foram descartadas com base em evidencias:

| Hipotese | Motivo do Descarte |
|---|---|
| **Grade Espacial 2D (Spatial Hashing)** | Para `N <= 120` pontos por timestamp, o overhead de calcular hashes, alocar buckets e limpar estruturas a cada 5s supera em ordens de grandeza a ordenacao in-place em cache L1. |
| **Pre-calculo de `cos(lat)` por linha** | Apos a poda de *Sweep-Line*, o Haversine e chamado menos de 200 vezes nas 12.000.000 de linhas do dataset 7. Pre-calcular `cos(lat)` no parse substituiria ~200 chamadas por 12.000.000 de calculos trigonometricos inuteis. |
| **Poda Temporal (Cooldown de Pares Distantes)** | Manter uma matriz de cooldown `D / v_max` entre timestamps adiciona overhead de consulta na memoria e cria dependencia temporal entre timestamps consecutivos, inviabilizando o fatiamento limpo entre `worker_threads`. |
| **Atalho de "Matriz Regular" (IDs fixos)** | Assumir que todos os datasets terao sempre os mesmos IDs na mesma ordem criaria *overfitting* fragil. O parser streaming com cache de metadados mantem complexidade O(1) para atributos estaticos enquanto suporta perda de sinal de GPS, IDs fora de ordem e tamanhos variados. |
| **Bundle Unico com `esbuild`** | O projeto tem zero dependencias de producao e apenas 8 arquivos compilados que o Node.js carrega em ~2 ms. |

---

## 7. Resultados de Validacao e Benchmarks

### Perfil dos Datasets e Validacao de Exatidao

Todos os 7 datasets atingiram **100% de validacao exata e igualdade bit-a-bit** (zero falsos positivos, zero falsos negativos e zero divergencias de ponto flutuante):

| Dataset | Tamanho | Linhas | Monitorados | Timestamps | Encontros (Gen / Fac / Prot) | Score Oficial | Precisao Bit-a-Bit |
|---|---:|---:|---:|---:|---:|---:|---:|
| `dataset1.txt` | 255 KB | 5.000 | 10 | 500 | **4** (2 / 1 / 1) | **4 / 4** | 100% (4/4) |
| `dataset2.txt` | 1,25 MB | 25.000 | 20 | 1.250 | **6** (3 / 2 / 1) | **6 / 6** | 100% (6/6) |
| `dataset3.txt` | 5,02 MB | 100.000 | 40 | 2.500 | **10** (5 / 3 / 2) | **10 / 10** | 100% (10/10) |
| `dataset4.txt` | 20,1 MB | 400.020 | 60 | 6.667 | **15** (7 / 5 / 3) | **15 / 15** | 100% (15/15) |
| `dataset5.txt` | 50,4 MB | 1.000.000 | 80 | 12.500 | **21** (10 / 7 / 4) | **21 / 21** | 100% (21/21) |
| `dataset6.txt` | 403,8 MB | 8.000.000 | 100 | 80.000 | **27** (12 / 9 / 6) | **27 / 27** | 100% (27/27) |
| `dataset7.txt` | 608,6 MB | 12.000.000 | 120 | 100.000 | **35** (15 / 12 / 8) | **35 / 35** | 100% (35/35) |

### Tempos de Execucao (Oraculo Forca Bruta vs. Pipeline Principal)

Abaixo estao os tempos medidos em tres regimes:
1. **Oraculo Referencia (`scripts/reference.ts`):** Forca bruta O(N^2) em streaming de strings (baseline de comparacao).
2. **Execucao Unica a Frio (`Cold Start`):** Primeira execucao isolada do processo (`node dist/index.js --all --out`), incluindo alocacao fisica de memoria no SO (*page faults* iniciais do `SharedArrayBuffer`), cache de disco frio, criacao das *worker threads* e compilacao JIT inicial do V8.
3. **Benchmark Aquecido (`--bench 10`):** Media e minimo de 10 iteracoes consecutivas (`node dist/index.js --all --out --bench 10`), medindo o desempenho sustentado do motor com JIT compilado (*TurboFan*) e pool de memoria ativo.

| Dataset | Oraculo Forca Bruta | Pipeline (Cold Start) | Benchmark 10x (Media) | Benchmark 10x (Minimo) | Ganho (Ref vs. Media) |
|---|---:|---:|---:|---:|---:|
| `dataset1.txt` | 20,00 ms | 15,46 ms | **4,23 ms** | 0,41 ms | ~4,7x |
| `dataset2.txt` | 60,00 ms | 28,63 ms | **2,13 ms** | 1,84 ms | ~28,1x |
| `dataset3.txt` | 210,00 ms | 143,69 ms | **22,84 ms** | 4,12 ms | ~9,2x |
| `dataset4.txt` | 1.060,00 ms | 157,06 ms | **15,53 ms** | 12,32 ms | ~68,2x |
| `dataset5.txt` | 3.180,00 ms | 182,64 ms | **41,28 ms** | 31,11 ms | ~77,0x |
| `dataset6.txt` | 28.710,00 ms | 624,39 ms | **266,33 ms** | 254,58 ms | ~107,8x |
| `dataset7.txt` | 49.770,00 ms | 1.450,79 ms | **411,17 ms** | 382,11 ms | **~121,0x** |
| **SOMA TOTAL** | **83.010,00 ms (83,01s)** | **2.602,66 ms (2,60s)** | **763,51 ms (0,76s)** | **686,49 ms (0,69s)** | **~108,7x** |

### Detalhamento por Etapa no Benchmark (10x)

| Dataset | Leitura I/O (Media) | Parse (Media) | Deteccao (Media) | Total (Media) |
|---|---:|---:|---:|---:|
| `dataset1.txt` (5k linhas) | 0,28 ms | 3,11 ms | 0,84 ms | **4,23 ms** |
| `dataset2.txt` (25k linhas) | 0,52 ms | 1,21 ms | 0,40 ms | **2,13 ms** |
| `dataset3.txt` (100k linhas) | 2,79 ms | 12,99 ms | 7,06 ms | **22,84 ms** |
| `dataset4.txt` (400k linhas) | 6,37 ms | 5,92 ms | 3,24 ms | **15,53 ms** |
| `dataset5.txt` (1M linhas) | 19,82 ms | 15,66 ms | 5,80 ms | **41,28 ms** |
| `dataset6.txt` (8M linhas) | 128,21 ms | 104,59 ms | 33,54 ms | **266,33 ms** |
| `dataset7.txt` (12M linhas) | 199,56 ms | 156,35 ms | 55,26 ms | **411,17 ms** |

*(Nota tecnica sobre Cold Start vs. Benchmark: No `dataset7.txt`, a queda do tempo de leitura de ~1.239 ms na primeira execucao a frio para ~199 ms no benchmark deve-se ao mapeamento inicial das ~155.000 paginas fisicas de 4 KB do `SharedArrayBuffer` de 609 MB na tabela de paginas do sistema operacional e ao aquecimento do Page Cache da RAM).*

---

## 8. Robustez e Testes de Estresse (Fase 6)

Alem dos 7 datasets oficiais, a solucao foi validada contra suites especificas de robustez (`scripts/test_robustness.ts` e `scripts/test_torture.ts`):

- **Variacoes de Formatacao CSV:** Tratamento nativo de arquivos com UTF-8 BOM (`0xEF 0xBB 0xBF`), quebras de linha mistas (`CRLF` e `LF`), linhas em branco contendo espacos ou tabulacoes, faccoes compostas apenas por espacos em branco e omissao da 7a coluna.
- **Formatos Numericos Extremos:** Coordenadas com menos de 5 casas decimais (ex.: `-23.5`), coordenadas inteiras (ex.: `-46`), coordenadas negativas com parte inteira zero cruzando a Linha do Equador (`-0.00005` vs `0.00005`), multiplos agressores separados por virgula (`"3, 4"`) e vitimas sem agressor cadastrado.
- **Escalabilidade Dinamica de Estruturas:** Teste de realocacao automatica dos `TypedArrays` para `idMonitorado > 256` e validacao do *fallback* de ordenacao para `N > 128` monitorados simultaneos no mesmo timestamp (`N = 150`).
- **Teste de Tortura Adversarial (`scripts/test_torture.ts`):** Dataset sintetico de 749.500 linhas com 150 monitorados por timestamp posicionados todos na mesma faixa de latitude (`-0.00005` a `+0.00005`), derrotando propositalmente a poda de *Sweep-Line* e forcando **~55,8 milhoes de chamadas reais da Formula de Haversine**, misturando quebras `CRLF`/`LF` e perda de sinal de GPS. O algoritmo manteve 100% de precisao bit-a-bit em ~0,81s.

---

## 9. Declaracao de Uso de Inteligencia Artificial

Em conformidade com as diretrizes do desafio, declaro de forma transparente que ferramentas de Inteligencia Artificial (modelos **Gemini** integrados ao ambiente de desenvolvimento **VS Code + Antigravity**, apoiados por memoria persistente de contexto via **MCP Obsidian**) foram utilizadas intensivamente ao longo de todo o ciclo de desenvolvimento, tanto no **planejamento arquitetural** quanto na **codificacao e depuracao**.

A utilizacao da IA seguiu uma metodologia estrita de engenharia assistida (*Human-in-the-Loop*), dividida em quatro frentes:

1. **Planejamento e Analise Exploratoria (`CONTEXT.md` e `IMPLEMENTATION_GUIDE.md`):**
   - A IA auxiliou a estruturar o projeto em 7 fases incrementais e a formular scripts de inspecao para levantar o perfil estatistico dos datasets.
   - Através dessa analise conjunta, identificamos que o `dataset7.txt` (609 MB) excedia o limite de strings do V8, que o numero maximo de entidades por timestamp era `N <= 120` (tornando estruturas complexas como QuadTrees ou Grids 2D contraproducentes) e que a variante exata de Haversine exigia `Math.asin` com subtracao em graus.

2. **Construcao de um Oraculo Independente antes da Otimizacao (`scripts/reference.ts`):**
   - Para garantir que nenhuma otimizacao de baixo nivel sugerida ou codificada com auxilio da IA introduzisse bugs silenciosos, implementamos primeiro um algoritmo de referencia por forca bruta O(N^2) simples e auditavel.
   - Esse oraculo foi validado contra os gabaritos oficiais 1 e 2 (100% de aderencia) e gerou os arquivos de verdade-base (`referencia3.json` a `referencia7.json`). Nenhuma otimizacao subsequente foi aceita sem antes passar por validacao bit-a-bit (`===`) nos 7 datasets contra o oraculo.

3. **Codificacao Controlada e Benchmarking Cientifico (`src/`):**
   - A codificacao do parser binario em `Buffer`, da leitura de timestamps via `DataView` de 32 bits, do empacotamento `(latInt << 7) | idx` no *ShellSort* e da orquestracao de `worker_threads` com `SharedArrayBuffer` foi realizada com revisao manual de cada *snippet* antes da aplicacao.
   - Ideias inicialmente cogitadas no brainstorming com a IA (como pre-calculo de `cos(lat)` por linha e poda por continuidade temporal) foram criticamente descartadas quando a analise matematica de ciclos de CPU e de concorrencia demonstrou que trariam regressoes ou acoplamento de estado.

4. **Auditoria de Casos de Borda e Testes Adversariais (`scripts/test_robustness.ts` e `scripts/test_torture.ts`):**
   - Na fase final de robustez, criamos testes de borda e datasets de tortura especificamente desenhados para quebrar atalhos de implementacao (como coordenadas curtas `-23.5;-46;` seguidas de ponto e virgula na 6a posicao, que expuseram e permitiram corrigir uma condicao de contorno real no *fast-path* do parser decimal).
   - Essa abordagem garantiu dominio completo sobre cada linha de codigo, permitindo justificar e defender matematicamente todas as escolhas de estruturas de dados, gerenciamento de memoria e paralelismo adotadas na solucao.