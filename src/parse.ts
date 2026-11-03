import { performance } from 'node:perf_hooks';
import type { FrameTimestamp, TabelaMetadados } from './types.js';

const MULT_CASAS = [100_000, 10_000, 1_000, 100, 10, 1] as const;

export function criarTabelaMetadados(capacidadeInicial = 256): TabelaMetadados {
  const agressorUnicoPorId = new Int32Array(capacidadeInicial);
  agressorUnicoPorId.fill(-1);

  return {
    capacidade: capacidadeInicial,
    conhecido: new Uint8Array(capacidadeInicial),
    faccaoPorId: new Int32Array(capacidadeInicial),
    ehVitimaPorId: new Uint8Array(capacidadeInicial),
    agressorUnicoPorId,
    agressoresExtrasPorId: new Array(capacidadeInicial),
    mapaFaccoes: new Map<string, number>(),
    monitoradosDistintos: 0,
  };
}

export function garantirCapacidadeMetadados(meta: TabelaMetadados, id: number): void {
  if (id < meta.capacidade) return;

  let novaCap = meta.capacidade * 2;
  while (novaCap <= id) novaCap *= 2;

  const novoConhecido = new Uint8Array(novaCap);
  novoConhecido.set(meta.conhecido);

  const novaFaccao = new Int32Array(novaCap);
  novaFaccao.set(meta.faccaoPorId);

  const novoEhVitima = new Uint8Array(novaCap);
  novoEhVitima.set(meta.ehVitimaPorId);

  const novoAgressor = new Int32Array(novaCap);
  novoAgressor.fill(-1);
  novoAgressor.set(meta.agressorUnicoPorId);

  const novosExtras = new Array<Set<number> | undefined>(novaCap);
  for (let i = 0; i < meta.agressoresExtrasPorId.length; i++) {
    novosExtras[i] = meta.agressoresExtrasPorId[i];
  }

  meta.capacidade = novaCap;
  meta.conhecido = novoConhecido;
  meta.faccaoPorId = novaFaccao;
  meta.ehVitimaPorId = novoEhVitima;
  meta.agressorUnicoPorId = novoAgressor;
  meta.agressoresExtrasPorId = novosExtras;
}

export function criarFrameTimestamp(capacidadeInicial = 256): FrameTimestamp {
  return {
    timestampInt: 0,
    tsByteOffset: 0,
    tsBuffer: Buffer.alloc(0),
    quantidade: 0,
    ids: new Int32Array(capacidadeInicial),
    latsInt: new Int32Array(capacidadeInicial),
    lonsInt: new Int32Array(capacidadeInicial),
    chavesSort: new Int32Array(capacidadeInicial),
  };
}

function garantirCapacidadeFrame(frame: FrameTimestamp, tamanhoNecessario: number): void {
  if (tamanhoNecessario <= frame.ids.length) return;

  let novaCap = frame.ids.length * 2;
  while (novaCap < tamanhoNecessario) novaCap *= 2;

  const novosIds = new Int32Array(novaCap);
  novosIds.set(frame.ids);

  const novasLats = new Int32Array(novaCap);
  novasLats.set(frame.latsInt);

  const novasLons = new Int32Array(novaCap);
  novasLons.set(frame.lonsInt);

  frame.ids = novosIds;
  frame.latsInt = novasLats;
  frame.lonsInt = novasLons;
  
  const novasChaves = new Int32Array(novaCap);
  novasChaves.set(frame.chavesSort);
  frame.chavesSort = novasChaves;

}


export function extrairTimestampString(frame: FrameTimestamp): string {
  return frame.tsBuffer.toString('utf8', frame.tsByteOffset, frame.tsByteOffset + 19);
}

export function percorrerBufferPorTimestamp(
  buffer: Buffer,
  meta: TabelaMetadados,
  frame: FrameTimestamp,
  aoFecharTimestamp: (frame: FrameTimestamp, meta: TabelaMetadados) => void
): {
  linhasLidas: number;
  timestampsDistintos: number;
  tempoDeteccaoMs: number;
} {
  const len = buffer.length;
  let pos = 0;
  let linhasLidas = 0;
  let timestampsDistintos = 0;
  let tempoDeteccaoAmostrado = 0;
  let amostrasDeteccao = 0;

  if (len >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    pos = 3;
  }

  if (pos < len && buffer[pos] === 105) {
    const nl = buffer.indexOf(10, pos);
    pos = nl === -1 ? len : nl + 1;
  }

  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let tsRef0 = 0;
  let tsRef1 = 0;
  let tsRef2 = 0;
  let tsRef3 = 0;
  let tsRef4 = 0;

  let metaCap = meta.capacidade;
  let metaConhecido = meta.conhecido;
  let frameIds = frame.ids;
  let frameLats = frame.latsInt;
  let frameLons = frame.lonsInt;
  let frameCap = frameIds.length;
  let frameQtd = 0;
  let tsRefOffset = 0;
  frame.quantidade = 0;
  frame.tsBuffer = buffer;

  while (pos < len) {
    
    while (
      pos < len &&
      (buffer[pos] === 10 || buffer[pos] === 13 || buffer[pos] === 32 || buffer[pos] === 9)
    ) { pos++;}

    if (pos >= len) break;

    let id = 0;
    while (pos < len) {
      const b = buffer[pos]!;
      if (b === 59) {
        pos++;
        break;
      }
      id = id * 10 + (b - 48);
      pos++;
    }

    if (id >= metaCap) {
      garantirCapacidadeMetadados(meta, id);
      metaCap = meta.capacidade;
      metaConhecido = meta.conhecido;
    }

    const ehNovoId = metaConhecido[id] === 0;
    if (!ehNovoId) {
      while (pos < len && buffer[pos] !== 59) pos++;
      if (pos < len) pos++;
    } else {
      metaConhecido[id] = 1;
      meta.monitoradosDistintos++;

      const inicioFac = pos;
      while (pos < len && buffer[pos] !== 59) pos++;

      if (pos > inicioFac) {
        const facStr = buffer.toString('utf8', inicioFac, pos).trim();
        
        if (facStr.length > 0) {
         
          let facId = meta.mapaFaccoes.get(facStr);
          if (facId === undefined) {
            facId = meta.mapaFaccoes.size + 1;
            meta.mapaFaccoes.set(facStr, facId);
          }
         
          meta.faccaoPorId[id] = facId;
        }

      }

      if (pos < len) pos++;
    }

    if (pos < len && buffer[pos] === 34) pos++;
    const tsOffset = pos;
    if (tsOffset + 19 > len) break;
    pos += 19;
    if (pos < len && buffer[pos] === 34) pos++;
    if (pos < len && buffer[pos] === 59) pos++;

    if (frameQtd > 0) {
      const mesmoTs =
        dv.getInt32(tsOffset + 15, true) === tsRef0 &&
        dv.getInt32(tsOffset + 11, true) === tsRef1 &&
        dv.getInt32(tsOffset + 7, true) === tsRef2 &&
        dv.getInt32(tsOffset + 3, true) === tsRef3 &&
        dv.getInt32(tsOffset, true) === tsRef4;

      if (!mesmoTs) {
        frame.quantidade = frameQtd;
        if ((timestampsDistintos & 63) === 1) {
          const t0 = performance.now();
          aoFecharTimestamp(frame, meta);
          tempoDeteccaoAmostrado += performance.now() - t0;
          amostrasDeteccao++;
        } else {
          aoFecharTimestamp(frame, meta);
        }
        frameQtd = 0;
      }

    }

    if (frameQtd === 0) {
      tsRefOffset = tsOffset;
      tsRef0 = dv.getInt32(tsOffset + 15, true);
      tsRef1 = dv.getInt32(tsOffset + 11, true);
      tsRef2 = dv.getInt32(tsOffset + 7, true);
      tsRef3 = dv.getInt32(tsOffset + 3, true);
      tsRef4 = dv.getInt32(tsOffset, true);
      frame.tsByteOffset = tsOffset;
      timestampsDistintos++;
    }

    let negLat = false;
    if (buffer[pos] === 45) {
      negLat = true;
      pos++;
    }

    let latInt = 0;
    while (pos < len) {
      const b = buffer[pos]!;
      if (b === 46 || b === 59) break;
      latInt = latInt * 10 + (b - 48);
      pos++;
    }

    if (pos < len && buffer[pos] === 46) {
      const b1 = buffer[pos + 1]!;
      const b2 = buffer[pos + 2]!;
      const b3 = buffer[pos + 3]!;
      const b4 = buffer[pos + 4]!;
      const b5 = buffer[pos + 5]!;
      if (
        pos + 6 < len &&
        buffer[pos + 6] === 59 &&
        b1 >= 48 && b1 <= 57 &&
        b2 >= 48 && b2 <= 57 &&
        b3 >= 48 && b3 <= 57 &&
        b4 >= 48 && b4 <= 57 &&
        b5 >= 48 && b5 <= 57
      ) {
        latInt =
          latInt * 100_000 +
          (b1 - 48) * 10_000 +
          (b2 - 48) * 1_000 +
          (b3 - 48) * 100 +
          (b4 - 48) * 10 +
          (b5 - 48);
        pos += 7;
      } else {

        pos++;
        let casasLat = 0;

        while (pos < len) {
          const b = buffer[pos]!;
          if (b === 59) break;
          if (casasLat < 5) {
            latInt = latInt * 10 + (b - 48);
            casasLat++;
          }
          pos++;
        }

        latInt = latInt * (MULT_CASAS[casasLat] ?? 1);

        if (pos < len && buffer[pos] === 59) pos++;
      }

    } else {
      latInt = latInt * 100_000;
      if (pos < len && buffer[pos] === 59) pos++;
    }

    if (negLat) latInt = -latInt;

    let negLon = false;
    if (buffer[pos] === 45) {
      negLon = true;
      pos++;
    }

    let lonInt = 0;
    while (pos < len) {
      const b = buffer[pos]!;
      if (b === 46 || b === 59) break;
      lonInt = lonInt * 10 + (b - 48);
      pos++;
    }

    if (pos < len && buffer[pos] === 46) {
      const b1 = buffer[pos + 1]!;
      const b2 = buffer[pos + 2]!;
      const b3 = buffer[pos + 3]!;
      const b4 = buffer[pos + 4]!;
      const b5 = buffer[pos + 5]!;
      if (
        pos + 6 < len &&
        buffer[pos + 6] === 59 &&
        b1 >= 48 && b1 <= 57 &&
        b2 >= 48 && b2 <= 57 &&
        b3 >= 48 && b3 <= 57 &&
        b4 >= 48 && b4 <= 57 &&
        b5 >= 48 && b5 <= 57
      ) {
        lonInt =
          lonInt * 100_000 +
          (b1 - 48) * 10_000 +
          (b2 - 48) * 1_000 +
          (b3 - 48) * 100 +
          (b4 - 48) * 10 +
          (b5 - 48);
        pos += 7;
      } else {
        pos++;
        let casasLon = 0;

        while (pos < len) {
          const b = buffer[pos]!;
          if (b === 59) break;
          if (casasLon < 5) {
            lonInt = lonInt * 10 + (b - 48);
            casasLon++;
          }
          pos++;
        }

        lonInt = lonInt * (MULT_CASAS[casasLon] ?? 1);

        if (pos < len && buffer[pos] === 59) pos++;
      }

    } else {
      lonInt = lonInt * 100_000;
      if (pos < len && buffer[pos] === 59) pos++;
    }

    if (negLon) lonInt = -lonInt;

    if (!ehNovoId) {
      while (pos < len && buffer[pos] !== 10) pos++;
      if (pos < len) pos++;
    } else {

      while (pos < len && (buffer[pos] === 32 || buffer[pos] === 9)) pos++;

      const isTrue = pos < len && (buffer[pos] === 116 || buffer[pos] === 84);

      if (isTrue) {
        meta.ehVitimaPorId[id] = 1;
      }

      while (pos < len && buffer[pos] !== 59 && buffer[pos] !== 10) pos++;

      if (pos < len && buffer[pos] === 59) {
        pos++;
        if (isTrue) {
          let primeiroAgr = -1;
          let extras: Set<number> | undefined;

          while (pos < len && buffer[pos] !== 10) {
            const b = buffer[pos]!;
            if (b >= 48 && b <= 57) {
              let agId = 0;
              while (pos < len) {
                const dig = buffer[pos]!;
                if (dig < 48 || dig > 57) break;
                agId = agId * 10 + (dig - 48);
                pos++;
              }
              if (primeiroAgr === -1) {
                primeiroAgr = agId;
              } else {
                if (!extras) {
                  extras = new Set<number>();
                  extras.add(primeiroAgr);
                }
                extras.add(agId);
              }
            } else {
              pos++;
            }
          }

          if (extras !== undefined) {
            meta.agressorUnicoPorId[id] = -2;
            meta.agressoresExtrasPorId[id] = extras;
          } else {
            meta.agressorUnicoPorId[id] = primeiroAgr;
          }
        } else {
          while (pos < len && buffer[pos] !== 10) pos++;
        }
      }

      if (pos < len && buffer[pos] === 10) pos++;
    }

    if (frameQtd >= frameCap) {
      garantirCapacidadeFrame(frame, frameQtd + 1);
      frameIds = frame.ids;
      frameLats = frame.latsInt;
      frameLons = frame.lonsInt;
      frameCap = frameIds.length;
    }
    frameIds[frameQtd] = id;
    frameLats[frameQtd] = latInt;
    frameLons[frameQtd] = lonInt;
    frameQtd++;
    linhasLidas++;
  }

  if (frameQtd > 0) {
    frame.quantidade = frameQtd;
    const t0 = performance.now();
    aoFecharTimestamp(frame, meta);
    tempoDeteccaoAmostrado += performance.now() - t0;
    amostrasDeteccao++;
  }

  const tempoDeteccaoMs =
    amostrasDeteccao > 0
      ? (tempoDeteccaoAmostrado / amostrasDeteccao) * timestampsDistintos
      : 0;

  return { linhasLidas, timestampsDistintos, tempoDeteccaoMs };
}


function obterOffsetTimestampNaLinha(buffer: Buffer, inicioLinha: number, fim: number): number {
  let pos = inicioLinha;

  while (
    pos < fim &&
    (buffer[pos] === 10 || buffer[pos] === 13 || buffer[pos] === 32 || buffer[pos] === 9)
  ) { pos++; }

  if (pos >= fim) return -1;

  // 1º ';' (após idMonitorado)
  while (pos < fim && buffer[pos] !== 59 && buffer[pos] !== 10) pos++;

  if (pos >= fim || buffer[pos] === 10) return -1;

  pos++;
  // 2º ';' (após faccaoMonitorado)
  while (pos < fim && buffer[pos] !== 59 && buffer[pos] !== 10) pos++;

  if (pos >= fim || buffer[pos] === 10) return -1;

  pos++;

  if (pos < fim && buffer[pos] === 34) pos++;

  return pos + 19 <= fim ? pos : -1;
}

export function calcularFatiasPorTimestamp(
  buffer: Buffer,
  numFatias: number
): Array<[number, number]> {
 
  const len = buffer.length;
  let pos = 0;
 
  if (len >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    pos = 3;
  }
 
  if (pos < len && buffer[pos] === 105) {
    const nlCabecalho = buffer.indexOf(10, pos);
    pos = nlCabecalho === -1 ? len : nlCabecalho + 1;
  }
 
  const inicioDados = pos;
  if (numFatias <= 1 || inicioDados >= len) {
    return [[inicioDados, len]];
  }
 
  const fatias: Array<[number, number]> = [];
  let inicioAtual = inicioDados;
 
  for (let k = 1; k < numFatias; k++) {
    const alvo = inicioDados + Math.floor(((len - inicioDados) * k) / numFatias);
 
    if (alvo <= inicioAtual) continue;
 
    const nlAlvo = buffer.indexOf(10, alvo);
 
    if (nlAlvo === -1 || nlAlvo + 1 >= len) break;
 
    let inicioLinha = nlAlvo + 1;
    const tsRef = obterOffsetTimestampNaLinha(buffer, inicioLinha, len);
 
    if (tsRef === -1) break;
 
    while (inicioLinha < len) {
 
      const nlProx = buffer.indexOf(10, inicioLinha);
      if (nlProx === -1 || nlProx + 1 >= len) {
        inicioLinha = len;
        break;
      }
      inicioLinha = nlProx + 1;
 
      const tsProx = obterOffsetTimestampNaLinha(buffer, inicioLinha, len);
      if (tsProx === -1) {
        inicioLinha = len;
        break;
      }
 
      if (buffer.compare(buffer, tsProx, tsProx + 19, tsRef, tsRef + 19) !== 0) {
        break;
      }
    }
 
    if (inicioLinha > inicioAtual && inicioLinha < len) {
      fatias.push([inicioAtual, inicioLinha]);
      inicioAtual = inicioLinha;
    }
 
  }
 
  if (inicioAtual < len) {
    fatias.push([inicioAtual, len]);
  }
 
  return fatias;
}