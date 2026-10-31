# Contexto: Desafio "Detecção de Encontros" (TypeScript + Node.js)

## O problema
Processar dados de geolocalização e detectar encontros físicos entre:
- Monitorados/agressores (tornozeleira) e vítimas (medida protetiva, rastreador portátil).

Tipos de encontro (campo "tipo" da saída):
- `generico`: quaisquer dois monitorados
- `faccao`: dois monitorados da mesma facção
- `protetiva`: agressor e sua respectiva vítima

## Regras
- Encontro = distância < 20 m (estrito), calculada por Haversine com raio da Terra de 6.371.000 m
- Comparar apenas posições com o MESMO timestamp (posições a cada 5 s)
- Um encontro por par por timestamp (a ordem dos IDs no array não importa)
- Tecnologia obrigatória: JavaScript ou TypeScript (Node.js). Uso de IA é permitido, mas será avaliado COMO foi usada e a capacidade de defender a solução
- Desempate: soma do tempo médio de execução nos datasets (mais rápido vence)
- Prazo: 03/11/2026 às 23:59:59

## Dados
- 7 datasets .txt (2 com gabarito JSON para validar, 5 oficiais) em `datasets/inputs/`, gabaritos em `datasets/outputs/`
- CSV com ";" e cabeçalho: `idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida`
  - facção só existe para usuários de tornozeleira (pode ser vazio)
  - `idsRestricaoMedida`: IDs dos agressores da vítima, formato "1,2,3" (entre aspas no arquivo)
- Saída: um JSON por dataset, array de objetos:
  `{ "tipo", "monitoradosEncontro": [id1, id2], "timestamp", "posicoes": { "id": { "lat", "lon" } }, "distanciaMetros" }`

### Perfil real dos datasets (análise exploratória, 31/10)
| Dataset | Linhas | IDs | Timestamps | Encontros (força bruta) |
|---|---|---|---|---|
| 1 | 5.000 | 10 | 500 | 4 (= gabarito) |
| 2 | 25.000 | 20 | 1.250 | 6 (= gabarito) |
| 3 | 100.000 | 40 | 2.500 | 10 |
| 4 | 400.020 | 60 | 6.667 | 15 |
| 5 | 1.000.000 | 80 | 12.500 | 21 |
| 7 | 12.000.000 (609 MB) | 120 | 100.000 | 35 |

Fatos observados em TODOS os datasets:
- Formato: LF (sem CR), sem BOM, sem linhas inválidas; timestamp entre aspas (`"2024-01-01 00:00:00"`); lat/lon sempre com 5 casas; booleano `true`/`false`
- Arquivo ordenado por timestamp, intervalos sempre de exatamente 5 s
- Todo ID aparece em todo timestamp, sempre na mesma ordem, sem duplicatas (estrutura de matriz `[timestamp][pessoa]`)
- Facção e medida/restrição são constantes por ID
- Cada facção tem exatamente 2 membros; vítimas nunca têm facção; cada vítima tem 1 agressor
- Nenhum par com distância entre 19,5 m e 20,5 m (sem risco de fronteira)
- Encontros são raros (dados sintéticos com encontros "plantados")

## Decisões tomadas
- SEM interface (descartada). Foco 100% no algoritmo, rodando no console
- TypeScript (modo `strict`) pela tipagem forte, mesmo com etapa de build
- Build e execução simples para quem avalia:
  `npm install && npm run build` e depois
  `node dist/index.js <dataset.txt> [--expected gabarito.json] [--bench N]`
  (opcional em desenvolvimento: `tsx` para rodar direto, sem build)
- README curto com os comandos acima; tsconfig com target ES2022 e módulos ESM (NodeNext)
- Estrutura: `src/parse.ts`, `src/haversine.ts`, `src/detect.ts`, `src/validate.ts`, `src/types.ts`, `src/index.ts`
- Núcleo puro `detectarEncontros(...)`, separado de I/O
- Tipos explícitos para `Encontro`, `Posicao`, `TipoEncontro = 'generico' | 'faccao' | 'protetiva'`
- Manter uma implementação de referência força bruta O(n²) (`src/reference.ts` ou script de teste) e comparar a versão otimizada com ela em todos os datasets

### Regras de classificação (confirmadas pelos gabaritos)
- **Um único registro por par/timestamp, com um único tipo**, por prioridade: `protetiva` > `faccao` > `generico`
- Chave de unicidade: `timestamp + (menorId, maiorId)` — **sem o tipo**
- `faccao` só se ambos têm facção não vazia e igual
- Vítima x vítima, ou vítima x quem não é seu agressor: não ocorre nos dados; decisão defensiva = **não emitir** (falso positivo custa ponto)

### Haversine (exatamente a variante do gabarito)
```ts
const dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
const h = Math.sin(dp / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dl / 2) ** 2;
return 2 * 6371000 * Math.asin(Math.sqrt(h));
```
- Subtrair em graus e depois converter; usar `asin` (não `atan2`)
- Otimizações (pré-calcular `cos(lat)`, radianos) só são aceitas se mantiverem igualdade bit a bit com o gabarito

### Formato de saída (confirmado pelos gabaritos)
- `monitoradosEncontro` com menor ID primeiro; array ordenado por timestamp
- `lat`/`lon` como número (`-44.6352`, sem zero à direita) — `int / 1e5` produz exatamente isso
- `distanciaMetros` com precisão total do double (`String(number)`)

## Abordagem do algoritmo (desempenho)
- **Gargalo é o parse (I/O), não a geometria**: poucos IDs por timestamp (≤ 120) e poucos encontros
- Ler o arquivo como `Buffer` e fazer parse direto nos bytes (o dataset7 tem 609 MB, acima do limite de string do V8 ~512 MB)
- lat/lon como inteiros ×1e5 (`Int32Array`), sem `parseFloat`; timestamp convertido em inteiro na própria varredura (a string original só é gerada para encontros)
- Processar em streaming por timestamp (arquivo já ordenado) — sem agrupar tudo em `Map`
- Pré-filtro exato por latitude: se `|Δlat| ≥ 20 / 6371000` rad (≈ 0,0001799°), não é encontro (Haversine ≥ R·|Δφ|) — descarte sem margem e sem risco
- Candidatos a medir (benchmark decide):
  1. Força bruta com pré-filtro de latitude
  2. Ordenar por latitude e varrer (sweep)
  3. Aproveitar continuidade temporal: pares distantes D metros não podem se encontrar nos próximos k timestamps (limite por velocidade máxima observada)
  4. `worker_threads` dividindo o buffer em fronteiras de linha/timestamp (maior ganho esperado no dataset7)
- Atalho "matriz regular" (IDs fixos e na mesma ordem) só se confirmado durante o parse; caso contrário, cair no caminho genérico
- Facções/medidas mapeadas por ID em arrays (IDs pequenos e contíguos) — consulta O(1)
- JSON de saída montado manualmente
- Nenhum `console.log` dentro do loop principal
- Medir sempre o código compilado (`dist/`), não o `tsx`; considerar bundle único (esbuild) e zero dependências em runtime para reduzir tempo de boot

### Referência de tempos (protótipo JS não otimizado, sem workers)
- dataset7: leitura ~0,56 s, parse + detecção ~3,9 s; dataset5: ~0,3 s

## Saída no console (por dataset)
- Linhas lidas, timestamps distintos, monitorados distintos
- Encontros por tipo e total
- Tempos separados: parse, detecção, escrita do JSON
- Validação (datasets com gabarito): quantos bateram, faltaram e sobraram, com exemplos; comparar como conjunto e usar tolerância mínima só na distância
- Modo benchmark: roda N vezes e mostra média/mín/máx (o JIT esquenta na 1ª execução)

## Pontos em aberto
- Escolher a estratégia de detecção/paralelismo via benchmark

## Histórico de mudanças e justificativas
### 31/10 — Após análise exploratória dos 6 datasets disponíveis
Scripts usados: análise geral + força bruta comparada aos gabaritos, teste de variantes de Haversine e varredura rápida em bytes.

| Mudança | Antes | Agora | Por quê |
|---|---|---|---|
| Tipo por par | Dúvida se par de facção gera `generico` E `faccao` | Um registro com prioridade `protetiva` > `faccao` > `generico` | Gabaritos 1 e 2 nunca repetem par/timestamp; pares de facção aparecem só como `faccao` |
| Chave de unicidade | `tipo + timestamp + par` | `timestamp + par` | Consequência da linha acima; incluir o tipo permitiria duplicatas (falsos positivos) |
| Vítimas no `generico` | Em aberto | Não emitir (defensivo) | Caso não ocorre em nenhum dataset; emitir só traria risco de falso positivo |
| Haversine | Não especificado | Variante `asin`, subtração em graus | Reproduziu `distanciaMetros` do gabarito bit a bit (10/10); `atan2` deu 9/10; converter antes de subtrair deu 0/10 |
| Formato de saída | Em aberto | IDs crescentes, ordenado por timestamp, lat/lon numéricos | Observado nos gabaritos |
| Grade espacial | Estratégia principal | Removida; trocada por pré-filtro de latitude + candidatos via benchmark | Máx. 120 IDs por timestamp: o custo de montar a grade supera o ganho |
| Margem de segurança no filtro | "Filtro barato com margem" | Filtro exato por `\|Δlat\|` | Haversine ≥ R·\|Δφ\| é limite matemático; não precisa de margem |
| Leitura do arquivo | "Parse manual, evitar split" | Parse em bytes sobre `Buffer` obrigatório | dataset7 (609 MB) excede o limite de string do V8 |
| Foco de otimização | Geometria | Parse/I/O e paralelismo | Protótipo mostrou que quase todo o tempo vai para ler e interpretar o arquivo |
| Validação | Só contra gabarito | + implementação de referência força bruta | Gabaritos só cobrem 2 datasets; a referência garante equivalência nos oficiais |
