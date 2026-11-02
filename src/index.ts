import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  detectarEncontrosArquivo,
  detectarEncontrosBuffer,
  encerrarPoolWorkers,
  lerArquivoCompartilhado,
} from './detect.js';
import { salvarEncontrosJson } from './output.js';
import type { OpcoesCli, ResultadoDeteccao } from './types.js';
import { formatarRelatorioValidacao, validarContraArquivo } from './validate.js';

export function parsearArgumentosCli(argv: string[]): OpcoesCli {
  let caminhoDataset: string | undefined;
  let caminhoExpected: string | undefined;
  let autoExpected = false;
  let caminhoOut: string | undefined;
  let autoOut = false;
  let benchIteracoes = 1;
  let executarTodos = false;


  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
  
    if (arg === '--all') {
      executarTodos = true;
    } else if (arg === '--expected') {
  
        const prox = argv[i + 1];
      if (prox && !prox.startsWith('--')) {
        caminhoExpected = prox;
        i++;
      } else {
        autoExpected = true;
      }
    
    } else if (arg === '--out') {
    
      const prox = argv[i + 1];
      if (prox && !prox.startsWith('--')) {
        caminhoOut = prox;
        i++;
      } else {
        autoOut = true;
      }
    
    } else if (arg === '--bench') {
    
      const prox = argv[i + 1];
      if (prox && !prox.startsWith('--')) {
        benchIteracoes = Math.max(1, Number(prox) || 1);
        i++;
      }

    } else if (!arg.startsWith('--') && !caminhoDataset) {
      caminhoDataset = arg;
    }

  }

  return {
    caminhoDataset,
    caminhoExpected,
    autoExpected,
    caminhoOut,
    autoOut,
    benchIteracoes,
    executarTodos,
  };
}

export function resolverCaminhoGabaritoPadrao(caminhoDataset: string): string | undefined {
  const base = path.basename(caminhoDataset);
  const match = base.match(/^dataset(\d+)\.txt$/i);
  if (!match) return undefined;

  const num = match[1]!;
  if (num === '1' || num === '2') {
    return path.join('datasets', 'outputs', `respostas${num}.json`);
  }

  return path.join('datasets', 'reference', `referencia${num}.json`);
}

export function resolverCaminhoSaidaPadrao(caminhoDataset: string): string {
  const base = path.basename(caminhoDataset, path.extname(caminhoDataset));
  return path.join('outputs', `${base}.json`);
}

export async function executarPipelineDataset(caminhoDataset: string, opcoes: OpcoesCli): Promise<void> {
  const nome = path.basename(caminhoDataset);
  console.log(`\n========================================`);
  console.log(`Dataset: ${nome}`);
  console.log(`Caminho: ${caminhoDataset}`);

  if (!fs.existsSync(caminhoDataset)) {
    console.error(`ERRO: Arquivo não encontrado: ${caminhoDataset}`);
    process.exitCode = 1;
    return;
  }

  const caminhoExpected =
    opcoes.caminhoExpected ??
    (opcoes.autoExpected || opcoes.executarTodos
      ? resolverCaminhoGabaritoPadrao(caminhoDataset)
      : undefined);

  const caminhoOut =
    opcoes.caminhoOut ?? (opcoes.autoOut ? resolverCaminhoSaidaPadrao(caminhoDataset) : undefined);

  let resultadoFinal: ResultadoDeteccao;

  if (opcoes.benchIteracoes > 1) {
    console.log(`Modo Benchmark ativado (${opcoes.benchIteracoes} iterações)...`);
    const leituras: number[] = [];
    const parses: number[] = [];
    const deteccoes: number[] = [];
    const totais: number[] = [];
    const inicial = lerArquivoCompartilhado(caminhoDataset);
    
    resultadoFinal = await detectarEncontrosBuffer(inicial.buffer, 0);
    
    for (let i = 0; i < opcoes.benchIteracoes; i++) {
      const { buffer, leituraMs } = lerArquivoCompartilhado(caminhoDataset);
      const res = await detectarEncontrosBuffer(buffer, leituraMs);
    
      leituras.push(res.tempos.leituraMs);
      parses.push(res.tempos.parseMs);
      deteccoes.push(res.tempos.deteccaoMs);
      totais.push(res.tempos.totalMs);
    
      resultadoFinal = res;
    }

    const calcStats = (vals: number[]) => ({
      min: Math.min(...vals),
      max: Math.max(...vals),
      media: vals.reduce((a, b) => a + b, 0) / vals.length,
    });

    const sLei = calcStats(leituras);
    const sPar = calcStats(parses);
    const sDet = calcStats(deteccoes);
    const sTot = calcStats(totais);

    console.log(`\n--- RESULTADOS DO BENCHMARK (${opcoes.benchIteracoes}x) ---`);
    console.log(
      `Leitura I/O:  Média: ${sLei.media.toFixed(2)}ms | Mín: ${sLei.min.toFixed(2)}ms | Máx: ${sLei.max.toFixed(2)}ms`
    );
    console.log(
      `Parse:        Média: ${sPar.media.toFixed(2)}ms | Mín: ${sPar.min.toFixed(2)}ms | Máx: ${sPar.max.toFixed(2)}ms`
    );
    console.log(
      `Detecção:     Média: ${sDet.media.toFixed(2)}ms | Mín: ${sDet.min.toFixed(2)}ms | Máx: ${sDet.max.toFixed(2)}ms`
    );
    console.log(
      `TOTAL:        Média: ${sTot.media.toFixed(2)}ms (${(sTot.media / 1000).toFixed(3)}s) | Mín: ${sTot.min.toFixed(2)}ms | Máx: ${sTot.max.toFixed(2)}ms`
    );
  } else {
    
    resultadoFinal = await detectarEncontrosArquivo(caminhoDataset);

    console.log(`\n--- MÉTRICAS DE PROCESSAMENTO ---`);
    console.log(`Linhas lidas:           ${resultadoFinal.linhasLidas.toLocaleString()}`);
    console.log(`Timestamps distintos:   ${resultadoFinal.timestampsDistintos.toLocaleString()}`);
    console.log(`Monitorados distintos:  ${resultadoFinal.monitoradosDistintos}`);
    console.log(
      `Encontros detectados:   ${resultadoFinal.encontros.length} (generico: ${resultadoFinal.contagemPorTipo.generico}, faccao: ${resultadoFinal.contagemPorTipo.faccao}, protetiva: ${resultadoFinal.contagemPorTipo.protetiva})`
    );
    console.log(`\n--- TEMPOS DE EXECUÇÃO ---`);
    console.log(`Leitura (I/O):  ${resultadoFinal.tempos.leituraMs.toFixed(2)}ms`);
    console.log(`Parse:          ${resultadoFinal.tempos.parseMs.toFixed(2)}ms`);
    console.log(`Detecção:       ${resultadoFinal.tempos.deteccaoMs.toFixed(2)}ms`);
    console.log(
      `Tempo Total:    ${resultadoFinal.tempos.totalMs.toFixed(2)}ms (${(resultadoFinal.tempos.totalMs / 1000).toFixed(3)}s)`
    );
  }

  if (caminhoOut) {
    const t0 = performance.now();
    salvarEncontrosJson(caminhoOut, resultadoFinal.encontros);
    const tEscrita = performance.now() - t0;
    console.log(`JSON salvo em: ${caminhoOut} (${tEscrita.toFixed(2)}ms)`);
  }

  if (caminhoExpected) {
    console.log(`\nValidando contra gabarito: ${caminhoExpected}`);
  
    if (!fs.existsSync(caminhoExpected)) {
      console.warn(`[AVISO] Arquivo de gabarito não encontrado: ${caminhoExpected}`);
    } else {
      const resVal = validarContraArquivo(resultadoFinal.encontros, caminhoExpected);
      console.log(formatarRelatorioValidacao(resVal));
      if (!resVal.valido || resVal.acertosBitABit !== resVal.totalEsperado) {
        console.error(`ERRO: Validação falhou para ${nome}!`);
        process.exitCode = 1;
      }
    }
  
  }

}

export async function principal(): Promise<void> {
  const opcoes = parsearArgumentosCli(process.argv.slice(2));

  try {
    if (opcoes.executarTodos || (!opcoes.caminhoDataset && process.argv.length <= 2)) {
      console.log('=== EXECUÇÃO DOS 7 DATASETS (PIPELINE PRINCIPAL) ===');
      const datasets = [
        'datasets/inputs/dataset1.txt',
        'datasets/inputs/dataset2.txt',
        'datasets/inputs/dataset3.txt',
        'datasets/inputs/dataset4.txt',
        'datasets/inputs/dataset5.txt',
        'datasets/inputs/dataset6.txt',
        'datasets/inputs/dataset7.txt',
      ];

      for (const d of datasets) {
        await executarPipelineDataset(d, { ...opcoes, executarTodos: true });
      }

      return;
    }

    if (opcoes.caminhoDataset) {
      await executarPipelineDataset(opcoes.caminhoDataset, opcoes);
    } else {
      console.log('Uso: node dist/index.js <dataset.txt> [--expected [arq]] [--bench N] [--out [arq]]');
      console.log('     node dist/index.js --all [--bench N]');
    }
  
  } finally {
    await encerrarPoolWorkers();
  }

}

void principal();