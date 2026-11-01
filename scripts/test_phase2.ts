import * as fs from 'node:fs';
import * as assert from 'node:assert';
import { calcularDistanciaHaversine } from '../src/haversine.js';
import { serializarEncontrosJson } from '../src/output.js';
import { validarEncontros, validarContraArquivo, gerarChaveEncontro } from '../src/validate.js';
import type { Encontro } from '../src/types.js';

console.log('=== INICIANDO BATERIA DE TESTES - FASE 2 ===\n');

// -------------------------------------------------------------
// Teste 2: Exatidão Bit-a-Bit do Haversine nos 10 Encontros Oficiais
// -------------------------------------------------------------
console.log('-> Teste 2: Exatidão Bit-a-Bit do Haversine (10/10)');

const arquivosGabarito = [
  'datasets/outputs/respostas1.json',
  'datasets/outputs/respostas2.json',
];

let totalComparados = 0;
let totalBitABit = 0;

for (const caminho of arquivosGabarito) {
  const encontros = JSON.parse(fs.readFileSync(caminho, 'utf8')) as Encontro[];
  for (const e of encontros) {
    totalComparados++;
    const [id1, id2] = e.monitoradosEncontro;
    const p1 = e.posicoes[String(id1)]!;
    const p2 = e.posicoes[String(id2)]!;

    const distCalculada = calcularDistanciaHaversine(p1.lat, p1.lon, p2.lat, p2.lon);
    const bitABit = distCalculada === e.distanciaMetros;

    if (bitABit) {
      totalBitABit++;
    } else {
      console.error(
        `Divergência em [${e.timestamp}] par ${id1}-${id2}: calc=${distCalculada} !== gabarito=${e.distanciaMetros}`
      );
    }
  }
}

assert.strictEqual(
  totalBitABit,
  10,
  `Falha: apenas ${totalBitABit}/${totalComparados} encontros foram bit-a-bit idênticos!`
);
console.log(`   [PASS] 10 de 10 encontros idênticos bit-a-bit (===).\n`);

// -------------------------------------------------------------
// Teste 3: Round-Trip da Serialização JSON
// -------------------------------------------------------------
console.log('-> Teste 3: Round-Trip da Serialização (output.ts)');

for (const caminho of arquivosGabarito) {
  const conteudoOriginal = fs.readFileSync(caminho, 'utf8').replace(/\r\n/g, '\n').trim();
  const parsed = JSON.parse(conteudoOriginal) as Encontro[];
  const serializado = serializarEncontrosJson(parsed).replace(/\r\n/g, '\n').trim();

  assert.strictEqual(
    serializado,
    conteudoOriginal,
    `Falha na serialização idêntica para o arquivo: ${caminho}`
  );
}
console.log('   [PASS] Serialização JSON 100% idêntica caractere a caractere aos gabaritos.\n');

// -------------------------------------------------------------
// Teste 4: Auto-Validação e Detecção de Erros (validate.ts)
// -------------------------------------------------------------
console.log('-> Teste 4: Auto-Validação e Detecção de Erros (validate.ts)');

// 4.1 Auto-validação de respostas1.json
const resp1 = JSON.parse(fs.readFileSync('datasets/outputs/respostas1.json', 'utf8')) as Encontro[];
const resSelf = validarContraArquivo(resp1, 'datasets/outputs/respostas1.json');
assert.strictEqual(resSelf.valido, true);
assert.strictEqual(resSelf.acertosExatos, 4);
assert.strictEqual(resSelf.acertosBitABit, 4);
assert.strictEqual(resSelf.score, 4);
console.log('   [PASS] 4.1: Auto-validação do gabarito 1 aprovada (Score = 4).');

// 4.2 Inversão de IDs no par [6, 4] -> deve normalizar para a mesma chave canônica
const invertido: Encontro = {
  ...resp1[0]!,
  monitoradosEncontro: [
    resp1[0]!.monitoradosEncontro[1]!,
    resp1[0]!.monitoradosEncontro[0]!,
  ] as [number, number],
};
const chaveNormalizada = gerarChaveEncontro(invertido);
assert.strictEqual(chaveNormalizada, '2024-01-01 00:05:15|4:6');
console.log('   [PASS] 4.2: Normalização de IDs no par e chave canônica verificados.');

// 4.3 Detecção de duplicata (violação de unicidade)
const comDuplicata: Encontro[] = [resp1[0]!, ...resp1];
const resDup = validarEncontros(comDuplicata, resp1);
assert.strictEqual(resDup.valido, false);
assert.strictEqual(resDup.sobrando.length, 1);
assert.strictEqual(resDup.score, 3); // 4 acertos - 1 duplicata sobressalente = 3
console.log('   [PASS] 4.3: Detecção de duplicata com penalidade no Score aprovada.');

console.log('\nTODOS OS TESTES DA FASE 2 PASSARAM COM SUCESSO!');