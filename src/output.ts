import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Encontro } from './types.js';

export function ordenarEncontros(encontros: Encontro[]): Encontro[] {
  
    return encontros
    .map((e) => {
      
      const [a, b] = e.monitoradosEncontro;
      const minId = a < b ? a : b;
      const maxId = a < b ? b : a;
      
      return minId === a ? e : { ...e, monitoradosEncontro: [minId, maxId] as [number, number] };
    })
    .sort((x, y) => {
  
      if (x.timestamp !== y.timestamp) {
        return x.timestamp < y.timestamp ? -1 : 1;
      }
      
      const x0 = x.monitoradosEncontro[0];
      const y0 = y.monitoradosEncontro[0];
      
      if (x0 !== y0) {
        return x0 - y0;
      }
      
      return x.monitoradosEncontro[1] - y.monitoradosEncontro[1];
    });

}

export function serializarEncontrosJson(encontros: Encontro[]): string {
  const ordenados = ordenarEncontros(encontros);
  if (ordenados.length === 0) return '[]\n';

  const blocos = new Array<string>(ordenados.length);
  for (let i = 0; i < ordenados.length; i++) {
    
    const e = ordenados[i]!;
    const [id1, id2] = e.monitoradosEncontro;
    
    const k1 = String(id1);
    const k2 = String(id2);
    
    const p1 = e.posicoes[k1];
    const p2 = e.posicoes[k2];

    if (!p1 || !p2) {
      throw new Error(`Posições ausentes para o par [${id1}, ${id2}] em ${e.timestamp}`);
    }

    blocos[i] =
      `  {\n` +
      `    "tipo": "${e.tipo}",\n` +
      `    "monitoradosEncontro": [\n` +
      `      ${id1},\n` +
      `      ${id2}\n` +
      `    ],\n` +
      `    "timestamp": "${e.timestamp}",\n` +
      `    "posicoes": {\n` +
      `      "${k1}": {\n` +
      `        "lat": ${p1.lat},\n` +
      `        "lon": ${p1.lon}\n` +
      `      },\n` +
      `      "${k2}": {\n` +
      `        "lat": ${p2.lat},\n` +
      `        "lon": ${p2.lon}\n` +
      `      }\n` +
      `    },\n` +
      `    "distanciaMetros": ${e.distanciaMetros}\n` +
      `  }`;
  }

  return `[\n${blocos.join(',\n')}\n]\n`;
}

export function salvarEncontrosJson(caminhoArquivo: string, encontros: Encontro[]): void {
  const conteudo = serializarEncontrosJson(encontros);
  fs.mkdirSync(path.dirname(caminhoArquivo), { recursive: true });
  fs.writeFileSync(caminhoArquivo, conteudo, 'utf8');
}