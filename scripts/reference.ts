import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';

import { calcularDistanciaHaversine, DISTANCIA_LIMITE_METROS } from '../src/haversine.js';
import { salvarEncontrosJson } from '../src/output.js';
import { validarContraArquivo, formatarRelatorioValidacao } from '../src/validate.js';
import type { Encontro, TipoEncontro } from '../src/types.js';

export interface RegistroLinhaReferencia {
  id: number;
  faccao: string;
  timestamp: string;
  lat: number;
  lon: number;
  medidaProtetiva: boolean;
  idsRestricao: number[];
}

export interface EstatisticasReferencia {
  arquivo: string;
  linhasLidas: number;
  timestampsDistintos: number;
  monitoradosDistintos: number;
  encontros: Encontro[];
  contagemPorTipo: Record<TipoEncontro, number>;
  tempoMs: number;
}

export function parsearLinhaReferencia(linha: string): RegistroLinhaReferencia {
  const cols = linha.split(';');
  const rawId = cols[0];
  const rawFaccao = cols[1];
  const rawTimestamp = cols[2];
  const rawLat = cols[3];
  const rawLon = cols[4];
  const rawMedida = cols[5];
  const rawRestricao = cols[6];

  if (
    rawId === undefined ||
    rawFaccao === undefined ||
    rawTimestamp === undefined ||
    rawLat === undefined ||
    rawLon === undefined ||
    rawMedida === undefined
  ) {
    throw new Error(`Linha inválida ou incompleta: "${linha}"`);
  }

  const id = Number(rawId);
  const faccao = rawFaccao.trim();
  const timestamp = rawTimestamp.replace(/"/g, '').trim();
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  const medidaProtetiva = rawMedida.trim().toLowerCase() === 'true';

  let idsRestricao: number[] = [];
  if (rawRestricao !== undefined) {
    const limpo = rawRestricao.replace(/"/g, '').trim();
    if (limpo.length > 0) {
      idsRestricao = limpo
        .split(',')
        .map((v) => Number(v.trim()))
        .filter((n) => !Number.isNaN(n));
    }
  }

  return { id, faccao, timestamp, lat, lon, medidaProtetiva, idsRestricao };
}

export function classificarParReferencia(
  a: RegistroLinhaReferencia,
  b: RegistroLinhaReferencia
): TipoEncontro | null {
  const aRestringeB = a.medidaProtetiva && a.idsRestricao.includes(b.id);
  const bRestringeA = b.medidaProtetiva && b.idsRestricao.includes(a.id);

  if (aRestringeB || bRestringeA) {
    return 'protetiva';
  }

  if (a.medidaProtetiva || b.medidaProtetiva) {
    return null;
  }

  if (a.faccao !== '' && a.faccao === b.faccao) {
    return 'faccao';
  }

  return 'generico';
}

export function processarTimestampForcaBruta(
  timestamp: string,
  registros: RegistroLinhaReferencia[],
  acumulador: Encontro[],
  contagemPorTipo: Record<TipoEncontro, number>
): void {
  
  const n = registros.length;
  for (let i = 0; i < n; i++) {
  
    const a = registros[i]!;
    for (let j = i + 1; j < n; j++) {
  
      const b = registros[j]!;
      if (a.id === b.id) continue;

      const tipo = classificarParReferencia(a, b);
      if (tipo === null) continue;

      const distanciaMetros = calcularDistanciaHaversine(a.lat, a.lon, b.lat, b.lon);
      if (distanciaMetros < DISTANCIA_LIMITE_METROS) {
        const [primeiro, segundo] = a.id < b.id ? [a, b] : [b, a];
        contagemPorTipo[tipo]++;
        acumulador.push({
          tipo,
          monitoradosEncontro: [primeiro.id, segundo.id],
          timestamp,
          posicoes: {
            [String(primeiro.id)]: { lat: primeiro.lat, lon: primeiro.lon },
            [String(segundo.id)]: { lat: segundo.lat, lon: segundo.lon },
          },
          distanciaMetros,
        });
      }
    
    }

  }

}

export function executarReferenciaDataset(caminhoDataset: string): EstatisticasReferencia {
  
  const inicio = performance.now();
  const TAMANHO_CHUNK = 16 * 1024 * 1024;
  const buffer = Buffer.allocUnsafe(TAMANHO_CHUNK);
  const fd = fs.openSync(caminhoDataset, 'r');

  const idsVistos = new Set<number>();
  const contagemPorTipo: Record<TipoEncontro, number> = { generico: 0, faccao: 0, protetiva: 0 };
  const encontros: Encontro[] = [];

  let linhasLidas = 0;
  let timestampsDistintos = 0;
  let sobra = '';
  let primeiraLinha = true;
  let timestampAtual = '';
  let grupoAtual: RegistroLinhaReferencia[] = [];

  try {
    let bytesLidos = 0;
    while ((bytesLidos = fs.readSync(fd, buffer, 0, TAMANHO_CHUNK, null)) > 0) {
      const texto = sobra + buffer.toString('utf8', 0, bytesLidos);
      let inicioLinha = 0;
      let idxQuebra = texto.indexOf('\n', inicioLinha);

      while (idxQuebra !== -1) {
        let linha = texto.slice(inicioLinha, idxQuebra);
        if (linha.endsWith('\r')) linha = linha.slice(0, -1);
        inicioLinha = idxQuebra + 1;
        idxQuebra = texto.indexOf('\n', inicioLinha);

        if (primeiraLinha) {
          primeiraLinha = false;
          if (linha.startsWith('idMonitorado;')) continue;
        }
        if (linha.length === 0) continue;

        const reg = parsearLinhaReferencia(linha);
        linhasLidas++;
        idsVistos.add(reg.id);

        if (reg.timestamp !== timestampAtual) {
          if (grupoAtual.length > 0) {
            processarTimestampForcaBruta(timestampAtual, grupoAtual, encontros, contagemPorTipo);
            grupoAtual = [];
          }
          timestampAtual = reg.timestamp;
          timestampsDistintos++;
        }
        grupoAtual.push(reg);
      }

      sobra = texto.slice(inicioLinha);
    }

    if (sobra.trim().length > 0) {
      const reg = parsearLinhaReferencia(sobra.trim());
      linhasLidas++;
      idsVistos.add(reg.id);
      if (reg.timestamp !== timestampAtual) {
        if (grupoAtual.length > 0) {
          processarTimestampForcaBruta(timestampAtual, grupoAtual, encontros, contagemPorTipo);
          grupoAtual = [];
        }
        timestampAtual = reg.timestamp;
        timestampsDistintos++;
      }
      grupoAtual.push(reg);
    }

    if (grupoAtual.length > 0) {
      processarTimestampForcaBruta(timestampAtual, grupoAtual, encontros, contagemPorTipo);
    }
  } finally {
    fs.closeSync(fd);
  }

  const fim = performance.now();
  
  return {
    arquivo: caminhoDataset,
    linhasLidas,
    timestampsDistintos,
    monitoradosDistintos: idsVistos.size,
    encontros,
    contagemPorTipo,
    tempoMs: fim - inicio,
  };

}

function processarDatasetEValidar(caminhoDataset: string, caminhoGabarito: string): void {
  
  const nome = path.basename(caminhoDataset);
  console.log(`\n========================================`);
  console.log(`Processando e validando: ${nome}`);
  const stats = executarReferenciaDataset(caminhoDataset);

  console.log(
    `Linhas: ${stats.linhasLidas.toLocaleString()} | Timestamps: ${stats.timestampsDistintos.toLocaleString()} | Monitorados: ${stats.monitoradosDistintos}`
  );
  console.log(
    `Encontros: ${stats.encontros.length} (generico: ${stats.contagemPorTipo.generico}, faccao: ${stats.contagemPorTipo.faccao}, protetiva: ${stats.contagemPorTipo.protetiva})`
  );
  console.log(`Tempo gasto: ${(stats.tempoMs / 1000).toFixed(2)}s`);

  const res = validarContraArquivo(stats.encontros, caminhoGabarito);
  console.log(formatarRelatorioValidacao(res));

  if (!res.valido) {
    console.error(`ERRO: Validação falhou para ${nome}! Abortando.`);
    process.exit(1);
  }

}

function processarDatasetEGravarReferencia(caminhoDataset: string, caminhoSaida: string): void {
  
  const nome = path.basename(caminhoDataset);
  console.log(`\n========================================`);
  console.log(`Processando e gerando referência: ${nome}`);
  const stats = executarReferenciaDataset(caminhoDataset);

  console.log(
    `Linhas: ${stats.linhasLidas.toLocaleString()} | Timestamps: ${stats.timestampsDistintos.toLocaleString()} | Monitorados: ${stats.monitoradosDistintos}`
  );
  console.log(
    `Encontros: ${stats.encontros.length} (generico: ${stats.contagemPorTipo.generico}, faccao: ${stats.contagemPorTipo.faccao}, protetiva: ${stats.contagemPorTipo.protetiva})`
  );
  console.log(`Tempo gasto: ${(stats.tempoMs / 1000).toFixed(2)}s`);

  salvarEncontrosJson(caminhoSaida, stats.encontros);
  console.log(`Salvo com sucesso em: ${caminhoSaida}`);
}

function principal(): void {
  const args = process.argv.slice(2);

  if (args.length > 0 && args[0] !== '--all') {
    const caminhoDataset = args[0]!;
    let caminhoExpected: string | undefined;
    let caminhoOut: string | undefined;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--expected' && args[i + 1]) {
        caminhoExpected = args[++i];
      } else if (args[i] === '--out' && args[i + 1]) {
        caminhoOut = args[++i];
      }
    }

    if (caminhoExpected) {
      processarDatasetEValidar(caminhoDataset, caminhoExpected);
    } else if (caminhoOut) {
      processarDatasetEGravarReferencia(caminhoDataset, caminhoOut);
    } else {
      const stats = executarReferenciaDataset(caminhoDataset);
      console.log(`Encontros detectados: ${stats.encontros.length}`);
      console.log(`Tempo gasto: ${(stats.tempoMs / 1000).toFixed(2)}s`);
    }

    return;
  }

  console.log('=== EXECUÇÃO COMPLETA DA IMPLEMENTAÇÃO DE REFERÊNCIA ===');

  processarDatasetEValidar('datasets/inputs/dataset1.txt', 'datasets/outputs/respostas1.json');
  processarDatasetEValidar('datasets/inputs/dataset2.txt', 'datasets/outputs/respostas2.json');

  const datasetsOficiais = [
    { in: 'datasets/inputs/dataset3.txt', out: 'datasets/reference/referencia3.json' },
    { in: 'datasets/inputs/dataset4.txt', out: 'datasets/reference/referencia4.json' },
    { in: 'datasets/inputs/dataset5.txt', out: 'datasets/reference/referencia5.json' },
    { in: 'datasets/inputs/dataset6.txt', out: 'datasets/reference/referencia6.json' },
    { in: 'datasets/inputs/dataset7.txt', out: 'datasets/reference/referencia7.json' },
  ];

  for (const item of datasetsOficiais) {
    if (fs.existsSync(item.in)) {
      processarDatasetEGravarReferencia(item.in, item.out);
    } else {
      console.warn(`\n[AVISO] Arquivo não encontrado: ${item.in}. Pulando.`);
    }
  }

}

principal();