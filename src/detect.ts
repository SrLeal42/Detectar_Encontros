import * as fs from 'node:fs';
import * as os from 'node:os';
import { performance } from 'node:perf_hooks';
import { Worker, type WorkerOptions } from 'node:worker_threads';
import { calcularDistanciaHaversine, DISTANCIA_LIMITE_METROS, DLAT_MAX_INT_1E5 } from './haversine.js';
import {
  calcularFatiasPorTimestamp,
  criarFrameTimestamp,
  criarTabelaMetadados,
  extrairTimestampString,
  percorrerBufferPorTimestamp,
} from './parse.js';
import type {
  Encontro,
  FrameTimestamp,
  ResultadoDeteccao,
  ResultadoWorker,
  TabelaMetadados,
  TarefaWorker,
  TipoEncontro,
} from './types.js';



export const LIMIAR_PARALELO_BYTES = 4 * 1024 * 1024; // 4 MB
const GAPS_CIURA = [57, 23, 10, 4, 1] as const;

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
  
  if (n < 2) return;
  
  const ids = frame.ids;
  const lats = frame.latsInt;
  const lons = frame.lonsInt;
  
  for (let g = 0; g < 5; g++) {
    const gap = GAPS_CIURA[g]!;
  
    if (gap >= n) continue;
  
    for (let i = gap; i < n; i++) {
      const tempLat = lats[i]!;
      const tempId = ids[i]!;
      const tempLon = lons[i]!;
      let j = i;
  
      while (j >= gap && lats[j - gap]! > tempLat) {
        lats[j] = lats[j - gap]!;
        ids[j] = ids[j - gap]!;
        lons[j] = lons[j - gap]!;
        j -= gap;
      }
  
      lats[j] = tempLat;
      ids[j] = tempId;
      lons[j] = tempLon;
    }
  
  }
  
  let tsString: string | undefined;
  const limiteSuperior = n - 1;
  
  for (let i = 0; i < limiteSuperior; i++) {
    
    const latIntA = lats[i]!;
    const latLimite = latIntA + DLAT_MAX_INT_1E5;
    const idA = ids[i]!;
    const lonIntA = lons[i]!;
    
    for (let j = i + 1; j < n; j++) {
      const latIntB = lats[j]!;
      
      if (latIntB >= latLimite) {
        break;
      }
      
      const idB = ids[j]!;
      
      if (idA === idB) continue;
      
      const tipo = classificarPar(idA, idB, meta);
      
      if (tipo === null) continue;
      
      const latA = latIntA / 1e5;
      const lonA = lonIntA / 1e5;
      const latB = latIntB / 1e5;
      const lonB = lons[j]! / 1e5;
      
      const distanciaMetros =
        idA < idB
          ? calcularDistanciaHaversine(latA, lonA, latB, lonB)
          : calcularDistanciaHaversine(latB, lonB, latA, lonA);

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

export function lerArquivoCompartilhado(caminhoDataset: string): {
  buffer: Buffer;
  leituraMs: number;
} {
  const t0 = performance.now();
  const fd = fs.openSync(caminhoDataset, 'r');

  try {
    const tamanho = fs.fstatSync(fd).size;
    const sab = new SharedArrayBuffer(tamanho);
    const buffer = Buffer.from(sab);

    let lidosTotal = 0;

    while (lidosTotal < tamanho) {
      const bytes = fs.readSync(fd, buffer, lidosTotal, tamanho - lidosTotal, lidosTotal);
      if (bytes === 0) break;
      lidosTotal += bytes;
    }

    return { buffer, leituraMs: performance.now() - t0 };

  } finally {
    fs.closeSync(fd);
  }

}

let poolWorkers: Worker[] | null = null;

function obterPoolWorkers(quantidade: number): Worker[] {
  if (poolWorkers !== null) return poolWorkers;

  const pool: Worker[] = [];
  const emModoTs = import.meta.url.endsWith('.ts');
  const urlWorker = new URL(emModoTs ? './worker.ts' : './worker.js', import.meta.url);
  const opcoesWorker: WorkerOptions = emModoTs ? { execArgv: ['--import', 'tsx'] } : {};

  for (let i = 0; i < quantidade; i++) {
    pool.push(new Worker(urlWorker, opcoesWorker));
  }

  poolWorkers = pool;

  return pool;
}

export async function encerrarPoolWorkers(): Promise<void> {
  if (poolWorkers === null) return;
  
  const promises = poolWorkers.map((w) => w.terminate());
  
  poolWorkers = null;

  await Promise.all(promises);
}

function executarTarefaWorker(worker: Worker, tarefa: TarefaWorker): Promise<ResultadoWorker> {
  return new Promise((resolve, reject) => {
    const onMessage = (res: ResultadoWorker) => {
      cleanup();
      resolve(res);
    };
  
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
  
    function cleanup() {
      worker.off('message', onMessage);
      worker.off('error', onError);
    }
    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.postMessage(tarefa);
  });

}

export function detectarEncontrosBufferSync(buffer: Buffer, leituraMs = 0): ResultadoDeteccao {
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

export async function detectarEncontrosBuffer(
  buffer: Buffer,
  leituraMs = 0
): Promise<ResultadoDeteccao> {
  if (buffer.length < LIMIAR_PARALELO_BYTES) {
    return detectarEncontrosBufferSync(buffer, leituraMs);
  }

  const numCpus = os.availableParallelism?.() ?? os.cpus().length ?? 4;
  const fatias = calcularFatiasPorTimestamp(buffer, numCpus);
  if (fatias.length <= 1) {
    return detectarEncontrosBufferSync(buffer, leituraMs);
  }

  let sab: SharedArrayBuffer;
  if (buffer.buffer instanceof SharedArrayBuffer) {
    sab = buffer.buffer;
  } else {
    sab = new SharedArrayBuffer(buffer.length);
    const viewSab = Buffer.from(sab);
    buffer.copy(viewSab);
  }

  const pool = obterPoolWorkers(fatias.length);
  const tarefas: TarefaWorker[] = fatias.map(([inicioByte, fimByte]) => ({
    sab,
    inicioByte,
    fimByte,
  }));

  const tInicio = performance.now();
  const resultados = await Promise.all(
    tarefas.map((tarefa, idx) => executarTarefaWorker(pool[idx]!, tarefa))
  );
  const tempoWallMs = performance.now() - tInicio;

  const encontros: Encontro[] = [];
  const contagemPorTipo: Record<TipoEncontro, number> = {
    generico: 0,
    faccao: 0,
    protetiva: 0,
  };
  let linhasLidas = 0;
  let timestampsDistintos = 0;
  let somaParseCpu = 0;
  let somaDeteccaoCpu = 0;
  let maiorCapConhecido = 0;

  for (const res of resultados) {
    for (let i = 0; i < res.encontros.length; i++) {
      encontros.push(res.encontros[i]!);
    }
    contagemPorTipo.generico += res.contagemPorTipo.generico;
    contagemPorTipo.faccao += res.contagemPorTipo.faccao;
    contagemPorTipo.protetiva += res.contagemPorTipo.protetiva;
    linhasLidas += res.linhasLidas;
    timestampsDistintos += res.timestampsDistintos;
    somaParseCpu += res.parseMs;
    somaDeteccaoCpu += res.deteccaoMs;
    if (res.conhecido.length > maiorCapConhecido) {
      maiorCapConhecido = res.conhecido.length;
    }
  }

  const conhecidoGlobal = new Uint8Array(maiorCapConhecido);
  for (const res of resultados) {
    for (let i = 0; i < res.conhecido.length; i++) {
      conhecidoGlobal[i]! |= res.conhecido[i]!;
    }
  }
  let monitoradosDistintos = 0;
  for (let i = 0; i < conhecidoGlobal.length; i++) {
    if (conhecidoGlobal[i] === 1) monitoradosDistintos++;
  }

  const cpuTotal = somaParseCpu + somaDeteccaoCpu || 1;
  const parseMs = (somaParseCpu / cpuTotal) * tempoWallMs;
  const deteccaoMs = tempoWallMs - parseMs;

  return {
    encontros,
    contagemPorTipo,
    linhasLidas,
    timestampsDistintos,
    monitoradosDistintos,
    tempos: {
      leituraMs,
      parseMs,
      deteccaoMs,
      escritaMs: 0,
      totalMs: leituraMs + tempoWallMs,
    },
  };
}

export async function detectarEncontrosArquivo(caminhoDataset: string): Promise<ResultadoDeteccao> {
  const { buffer, leituraMs } = lerArquivoCompartilhado(caminhoDataset);
  return detectarEncontrosBuffer(buffer, leituraMs);
}