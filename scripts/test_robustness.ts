import * as assert from 'node:assert';
import {
  calcularDistanciaHaversine,
  DISTANCIA_LIMITE_METROS,
  DLAT_MAX_INT_1E5,
} from '../src/haversine.js';
import {
  classificarPar,
  detectarEncontrosBuffer,
  detectarEncontrosBufferSync,
  encerrarPoolWorkers,
} from '../src/detect.js';
import {
  calcularFatiasPorTimestamp,
  criarTabelaMetadados,
} from '../src/parse.js';
import { validarEncontros } from '../src/validate.js';
import {
  parsearLinhaReferencia,
  processarTimestampForcaBruta,
  type RegistroLinhaReferencia,
} from './reference.js';
import type { Encontro, TipoEncontro } from '../src/types.js';

async function executarTestesRobustez(): Promise<void> {
  console.log('=== INICIANDO BATERIA DE TESTES DE ROBUSTEZ - FASE 6 ===\n');

  // -------------------------------------------------------------------------
  // 1. Fronteira Matemática do Haversine e Poda de Latitude (DLAT_MAX_INT_1E5)
  // -------------------------------------------------------------------------
  console.log('-> Teste 1: Fronteira de 20m do Haversine e Poda Exata de Latitude');
  const latBase = -23.55052;
  const lonBase = -46.63331;

  // 17 unidades (0.00017 graus) na mesma longitude ~ 18.90m (< 20m)
  const dist17 = calcularDistanciaHaversine(latBase, lonBase, latBase + 0.00017, lonBase);
  assert.ok(dist17 < DISTANCIA_LIMITE_METROS, `Esperado < 20m para dLat=17, obtido ${dist17}`);

  // 18 unidades (0.00018 graus = DLAT_MAX_INT_1E5) na mesma longitude ~ 20.015m (>= 20m)
  const dist18 = calcularDistanciaHaversine(
    latBase,
    lonBase,
    latBase + DLAT_MAX_INT_1E5 / 1e5,
    lonBase
  );
  assert.ok(
    dist18 >= DISTANCIA_LIMITE_METROS,
    `Poda inválida: dLat=18 gerou distância < 20m (${dist18})`
  );
  console.log(`   [PASS] dLat=17 -> ${dist17.toFixed(4)}m (<20m) | dLat=18 -> ${dist18.toFixed(4)}m (>=20m)\n`);

  // -------------------------------------------------------------------------
  // 2. Regras de Classificação e Prioridade (protetiva > faccao > generico)
  // -------------------------------------------------------------------------
  console.log('-> Teste 2: Classificação de Pares e Prioridade Estrita');
  const meta = criarTabelaMetadados(32);
  // ID 1: Monitorado Facção 1
  meta.faccaoPorId[1] = 1;
  // ID 2: Monitorado Facção 1
  meta.faccaoPorId[2] = 1;
  // ID 3: Monitorado Sem Facção
  meta.faccaoPorId[3] = 0;
  // ID 4: Vítima com agressor único = 1
  meta.ehVitimaPorId[4] = 1;
  meta.agressorUnicoPorId[4] = 1;
  // ID 5: Vítima com múltiplos agressores (2 e 3)
  meta.ehVitimaPorId[5] = 1;
  meta.agressorUnicoPorId[5] = -2;
  meta.agressoresExtrasPorId[5] = new Set([2, 3]);
  // ID 6: Vítima sem agressores cadastrados (-1)
  meta.ehVitimaPorId[6] = 1;
  meta.agressorUnicoPorId[6] = -1;

  assert.strictEqual(classificarPar(1, 2, meta), 'faccao', 'Mesma facção deve ser faccao');
  assert.strictEqual(classificarPar(1, 3, meta), 'generico', 'Facções distintas/vazias deve ser generico');
  assert.strictEqual(classificarPar(1, 4, meta), 'protetiva', 'Agressor + Vítima (único) deve ser protetiva');
  assert.strictEqual(classificarPar(4, 1, meta), 'protetiva', 'Simetria Vítima + Agressor deve ser protetiva');
  assert.strictEqual(classificarPar(2, 5, meta), 'protetiva', 'Múltiplos agressores (ID 2) deve ser protetiva');
  assert.strictEqual(classificarPar(5, 3, meta), 'protetiva', 'Múltiplos agressores (ID 3) deve ser protetiva');
  assert.strictEqual(classificarPar(4, 3, meta), null, 'Vítima + Não-agressor deve retornar null');
  assert.strictEqual(classificarPar(4, 5, meta), null, 'Vítima + Vítima deve retornar null');
  assert.strictEqual(classificarPar(6, 1, meta), null, 'Vítima sem restrição deve retornar null');
  console.log('   [PASS] Todas as combinações de classificação e prioridade validadas.\n');

  // -------------------------------------------------------------------------
  // 3. Parser Binário com BOM, CRLF, Linhas Vazias, Casas Decimais Variadas
  // -------------------------------------------------------------------------
  console.log('-> Teste 3: Edge Cases do Parser (BOM, CRLF, Espaços, Decimais Curto/Inteiro)');
  const csvEdgeCases =
    '\uFEFF' + // UTF-8 BOM
    'idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida\r\n' +
    '\r\n' + // Linha vazia logo após cabeçalho
    '1;   ;"2024-01-01 00:00:00";-23.5;-46;false;\r\n' + // Facção só com espaços, lat 1 casa, lon inteira
    '2;;"2024-01-01 00:00:00";-23.50005;-46.00000;false\r\n' + // Sem 7ª coluna, encontro generico com ID 1
    '   \r\n' + // Linha apenas com espaços no meio
    '3;Comando_A;"2024-01-01 00:00:05";-10.12345;-37.12345;false;\r\n' +
    '4;Comando_A;"2024-01-01 00:00:05";-10.12340;-37.12345;false;\r\n' + // Encontro faccao com ID 3
    '5;;"2024-01-01 00:00:05";-10.12342;-37.12345;true;"3, 4"\r\n' + // Vítima c/ múltiplos agressores (3 e 4)
    '6;;"2024-01-01 00:00:05";-10.12342;-37.12345;true;""\r\n' + // Vítima sem restrição na mesma posição
    '   \t  \r\n'; // Whitespace no fim do arquivo

  const bufEdge = Buffer.from(csvEdgeCases, 'utf8');
  const resEdge = detectarEncontrosBufferSync(bufEdge);

  assert.strictEqual(resEdge.linhasLidas, 6, 'Deve ler exatamente 6 linhas válidas');
  assert.strictEqual(resEdge.timestampsDistintos, 2, 'Deve detectar 2 timestamps distintos');
  assert.strictEqual(resEdge.monitoradosDistintos, 6, 'Deve registrar 6 monitorados distintos');
  // Esperados:
  // ts 00:00:00 -> [1, 2] generico
  // ts 00:00:05 -> [3, 4] faccao, [3, 5] protetiva, [4, 5] protetiva (ID 6 não gera nada)
  assert.strictEqual(resEdge.encontros.length, 4, 'Deve detectar 4 encontros exatos');
  assert.strictEqual(resEdge.contagemPorTipo.generico, 1);
  assert.strictEqual(resEdge.contagemPorTipo.faccao, 1);
  assert.strictEqual(resEdge.contagemPorTipo.protetiva, 2);
  console.log('   [PASS] BOM, CRLF, linhas em branco, coordenadas curtas e múltiplos agressores aprovados.\n');

  // -------------------------------------------------------------------------
  // 4. Fallback N > 128 Monitorados por Timestamp vs. Oráculo Força Bruta
  // -------------------------------------------------------------------------
  console.log('-> Teste 4: Fallback N > 128 Monitorados no Mesmo Timestamp (N = 150)');
  const linhas150: string[] = [
    'idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida',
  ];
  const registrosRef: RegistroLinhaReferencia[] = [];
  const tsUnico = '2024-01-01 12:00:00';

  for (let id = 1; id <= 150; id++) {
    // Espalha grupos mas cria alguns encontros propositais a cada 30 IDs
    const cluster = id % 30 === 0 ? 0 : id * 0.001;
    const lat = Number((-15.0 - cluster - (id % 3) * 0.00004).toFixed(5));
    const lon = Number((-47.0 - cluster - (id % 2) * 0.00004).toFixed(5));
    const fac = id % 10 === 0 ? 'FAC_X' : '';
    const linha = `${id};${fac};"${tsUnico}";${lat.toFixed(5)};${lon.toFixed(5)};false;`;
    linhas150.push(linha);
    registrosRef.push(parsearLinhaReferencia(linha));
  }

  const esp150: Encontro[] = [];
  const contRef150: Record<TipoEncontro, number> = { generico: 0, faccao: 0, protetiva: 0 };
  processarTimestampForcaBruta(tsUnico, registrosRef, esp150, contRef150);

  const res150 = detectarEncontrosBufferSync(Buffer.from(linhas150.join('\n'), 'utf8'));
  const val150 = validarEncontros(res150.encontros, esp150);

  assert.strictEqual(val150.valido, true, 'Fallback N=150 divergiu da força bruta');
  assert.strictEqual(val150.acertosBitABit, esp150.length);
  console.log(`   [PASS] Fallback N=150 validado bit-a-bit (${esp150.length} encontros idênticos).\n`);
 
  // -------------------------------------------------------------------------
  // 5. Fatiamento por Timestamp e Consistência Paralela (Worker Threads)
  // -------------------------------------------------------------------------
  console.log('-> Teste 5: Fatiamento em Fronteiras de Timestamp e Consistência Multi-Worker');
  const linhasMultiTs: string[] = [
    '\uFEFFidMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida\r\n',
  ];
  for (let t = 0; t < 10; t++) {
    const seg = String(t * 5).padStart(2, '0');
    const ts = `2024-01-01 00:00:${seg}`;
    linhasMultiTs.push(`1;FAC_1;"${ts}";-23.50000;-46.60000;false;\r\n`);
    linhasMultiTs.push(`2;FAC_1;"${ts}";-23.50005;-46.60000;false;\r\n\r\n`);
  }
  const bufMultiTs = Buffer.from(linhasMultiTs.join(''), 'utf8');

  const fatias = calcularFatiasPorTimestamp(bufMultiTs, 4);
  assert.strictEqual(fatias.length, 4, 'Deve dividir 10 timestamps em 4 fatias');

  // Verifica que a soma dos encontros processando cada fatia isoladamente === buffer inteiro
  const resFullSync = detectarEncontrosBufferSync(bufMultiTs);
  const encontrosFatias: Encontro[] = [];
  for (const [ini, fim] of fatias) {
    const resFatia = detectarEncontrosBufferSync(bufMultiTs.subarray(ini, fim));
    encontrosFatias.push(...resFatia.encontros);
  }
  const valFatias = validarEncontros(encontrosFatias, resFullSync.encontros);
  assert.strictEqual(valFatias.valido, true, 'Fatiamento alterou os encontros detectados');
  assert.strictEqual(encontrosFatias.length, 10, 'Deve detectar 1 encontro em cada um dos 10 timestamps');

  const resAsync = await detectarEncontrosBuffer(bufEdge);
  const valSyncAsync = validarEncontros(resAsync.encontros, resEdge.encontros);
  assert.strictEqual(valSyncAsync.valido, true);
  console.log('   [PASS] Fatiamento em 4 blocos e consistência de resultados 100% aprovados.\n');

  await encerrarPoolWorkers();
  console.log('TODOS OS TESTES DE ROBUSTEZ DA FASE 6 PASSARAM COM SUCESSO!');
}

void executarTestesRobustez();