import { performance } from 'node:perf_hooks';
import { parentPort } from 'node:worker_threads';
import { detectarNoTimestamp } from './detect.js';
import {
  criarFrameTimestamp,
  criarTabelaMetadados,
  percorrerBufferPorTimestamp,
} from './parse.js';
import type { Encontro, ResultadoWorker, TarefaWorker, TipoEncontro } from './types.js';

if (!parentPort) {
  throw new Error('src/worker.ts deve ser executado exclusivamente como Worker thread');
}

parentPort.on('message', (tarefa: TarefaWorker) => {
  const view = Buffer.from(tarefa.sab, tarefa.inicioByte, tarefa.fimByte - tarefa.inicioByte);
  const meta = criarTabelaMetadados();
  const frame = criarFrameTimestamp();
  const encontros: Encontro[] = [];
  const contagemPorTipo: Record<TipoEncontro, number> = {
    generico: 0,
    faccao: 0,
    protetiva: 0,
  };

  const tInicio = performance.now();
  const stats = percorrerBufferPorTimestamp(view, meta, frame, (f, m) => {
    detectarNoTimestamp(f, m, encontros, contagemPorTipo);
  });
  const tFim = performance.now();

  const totalMs = tFim - tInicio;
  const deteccaoMs = stats.tempoDeteccaoMs;
  const parseMs = Math.max(0, totalMs - deteccaoMs);

  const resultado: ResultadoWorker = {
    encontros,
    contagemPorTipo,
    linhasLidas: stats.linhasLidas,
    timestampsDistintos: stats.timestampsDistintos,
    conhecido: meta.conhecido.slice(0, meta.capacidade),
    parseMs,
    deteccaoMs,
  };

  parentPort!.postMessage(resultado);
});