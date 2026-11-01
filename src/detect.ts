import * as fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { calcularDistanciaHaversine, DISTANCIA_LIMITE_METROS, DLAT_MAX_INT_1E5 } from './haversine.js';
import {
  criarFrameTimestamp,
  criarTabelaMetadados,
  extrairTimestampString,
  percorrerBufferPorTimestamp,
} from './parse.js';
import type {
  Encontro,
  FrameTimestamp,
  ResultadoDeteccao,
  TabelaMetadados,
  TipoEncontro,
} from './types.js';

export function classificarPar(
  idA: number,
  idB: number,
  meta: TabelaMetadados
): TipoEncontro | null {
  const vitA = meta.ehVitimaPorId[idA] === 1;
  const vitB = meta.ehVitimaPorId[idB] === 1;

  if (vitA || vitB) {
    
    if (vitA) {
      const agA = meta.agressorUnicoPorId[idA]!;
      if (agA === idB || (agA === -2 && meta.agressoresExtrasPorId[idA]?.has(idB))) {
        return 'protetiva';
      }
    }
    
    if (vitB) {
      const agB = meta.agressorUnicoPorId[idB]!;
      if (agB === idA || (agB === -2 && meta.agressoresExtrasPorId[idB]?.has(idA))) {
        return 'protetiva';
      }
    }

    return null;
  }

  const facA = meta.faccaoPorId[idA]!;
  if (facA !== 0 && facA === meta.faccaoPorId[idB]!) {
    return 'faccao';
  }

  return 'generico';
}

export function detectarNoTimestamp(
  frame: FrameTimestamp,
  meta: TabelaMetadados,
  acumulador: Encontro[],
  contagemPorTipo: Record<TipoEncontro, number>
): void {
  const n = frame.quantidade;
  const ids = frame.ids;
  const lats = frame.latsInt;
  const lons = frame.lonsInt;
  let tsString: string | undefined;

  for (let i = 0; i < n; i++) {
    const idA = ids[i]!;
    const latIntA = lats[i]!;
    const lonIntA = lons[i]!;

    for (let j = i + 1; j < n; j++) {
      const diffLat = latIntA - lats[j]!;
      if (diffLat >= DLAT_MAX_INT_1E5 || diffLat <= -DLAT_MAX_INT_1E5) {
        continue;
      }

      const idB = ids[j]!;
      if (idA === idB) continue;

      const tipo = classificarPar(idA, idB, meta);
      if (tipo === null) continue;

      const latA = latIntA / 1e5;
      const lonA = lonIntA / 1e5;
      const latB = lats[j]! / 1e5;
      const lonB = lons[j]! / 1e5;

      const distanciaMetros = calcularDistanciaHaversine(latA, lonA, latB, lonB);
      if (distanciaMetros < DISTANCIA_LIMITE_METROS) {
        
        if (tsString === undefined) {
          tsString = extrairTimestampString(frame);
        }
        contagemPorTipo[tipo]++;

        if (idA < idB) {
          acumulador.push({
            tipo,
            monitoradosEncontro: [idA, idB],
            timestamp: tsString,
            posicoes: {
              [String(idA)]: { lat: latA, lon: lonA },
              [String(idB)]: { lat: latB, lon: lonB },
            },
            distanciaMetros,
          });
        } else {
          acumulador.push({
            tipo,
            monitoradosEncontro: [idB, idA],
            timestamp: tsString,
            posicoes: {
              [String(idB)]: { lat: latB, lon: lonB },
              [String(idA)]: { lat: latA, lon: lonA },
            },
            distanciaMetros,
          });
        }

      }


    }
  }

}


export function detectarEncontrosBuffer(buffer: Buffer, leituraMs = 0): ResultadoDeteccao {
  const meta = criarTabelaMetadados();
  const frame = criarFrameTimestamp();
  const encontros: Encontro[] = [];
  const contagemPorTipo: Record<TipoEncontro, number> = {
    generico: 0,
    faccao: 0,
    protetiva: 0,
  };

  const tInicio = performance.now();
  const stats = percorrerBufferPorTimestamp(buffer, meta, frame, (f, m) => {
    detectarNoTimestamp(f, m, encontros, contagemPorTipo);
  });
  const tFim = performance.now();

  const tempoTotalProcessamento = tFim - tInicio;
  const deteccaoMs = stats.tempoDeteccaoMs;
  const parseMs = Math.max(0, tempoTotalProcessamento - deteccaoMs);

  return {
    encontros,
    contagemPorTipo,
    linhasLidas: stats.linhasLidas,
    timestampsDistintos: stats.timestampsDistintos,
    monitoradosDistintos: meta.monitoradosDistintos,
    tempos: {
      leituraMs,
      parseMs,
      deteccaoMs,
      escritaMs: 0,
      totalMs: leituraMs + parseMs + deteccaoMs,
    },
  };

}

export function detectarEncontrosArquivo(caminhoDataset: string): ResultadoDeteccao {
  const t0 = performance.now();
  const buffer = fs.readFileSync(caminhoDataset);
  const t1 = performance.now();
  return detectarEncontrosBuffer(buffer, t1 - t0);
}