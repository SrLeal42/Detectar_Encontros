import * as fs from 'node:fs';
import type { Encontro, ResultadoValidacao, DivergenciaAtributo } from './types.js';

export function gerarChaveEncontro(encontro: Encontro): string {
  const [a, b] = encontro.monitoradosEncontro;
  const min = a < b ? a : b;
  const max = a < b ? b : a;
  return `${encontro.timestamp}|${min}:${max}`;
}

export function validarEncontros(
  obtidos: Encontro[],
  esperados: Encontro[],
  toleranciaDistancia = 1e-9
): ResultadoValidacao {
  const mapaEsperados = new Map<string, Encontro>();
  for (const esp of esperados) {
    mapaEsperados.set(gerarChaveEncontro(esp), esp);
  }

  const mapaObtidos = new Map<string, Encontro>();
  const sobrando: Encontro[] = [];

  for (const obt of obtidos) {
    const chave = gerarChaveEncontro(obt);
    if (mapaObtidos.has(chave)) {
      sobrando.push(obt);
    } else {
      mapaObtidos.set(chave, obt);
    }
  }

  const faltando: Encontro[] = [];
  const divergencias: DivergenciaAtributo[] = [];
  let acertosExatos = 0;
  let acertosBitABit = 0;

  for (const [chave, esp] of mapaEsperados.entries()) {
    const obt = mapaObtidos.get(chave);
    if (!obt) {
      faltando.push(esp);
      continue;
    }

    const diffDist = Math.abs(obt.distanciaMetros - esp.distanciaMetros);
    const bitABitIgual = obt.distanciaMetros === esp.distanciaMetros;
    const tipoDiferente = obt.tipo !== esp.tipo;

    const [id1, id2] = esp.monitoradosEncontro[0] < esp.monitoradosEncontro[1]
      ? esp.monitoradosEncontro
      : [esp.monitoradosEncontro[1], esp.monitoradosEncontro[0]];

    const p1Esp = esp.posicoes[String(id1)];
    const p2Esp = esp.posicoes[String(id2)];
    const p1Obt = obt.posicoes[String(id1)];
    const p2Obt = obt.posicoes[String(id2)];

    const posicoesIguais =
      p1Esp !== undefined &&
      p2Esp !== undefined &&
      p1Obt !== undefined &&
      p2Obt !== undefined &&
      Math.abs(p1Esp.lat - p1Obt.lat) <= 1e-9 &&
      Math.abs(p1Esp.lon - p1Obt.lon) <= 1e-9 &&
      Math.abs(p2Esp.lat - p2Obt.lat) <= 1e-9 &&
      Math.abs(p2Esp.lon - p2Obt.lon) <= 1e-9;

    if (!tipoDiferente && diffDist <= toleranciaDistancia && posicoesIguais) {
      acertosExatos++;
      if (bitABitIgual) acertosBitABit++;
    } else {
      divergencias.push({
        chave,
        esperado: esp,
        obtido: obt,
        tipoDiferente,
        diferencaDistancia: diffDist,
        bitABitIgual,
      });
    }
    
  }

  for (const [chave, obt] of mapaObtidos.entries()) {
    if (!mapaEsperados.has(chave)) {
      sobrando.push(obt);
    }
  }

  const falsosPositivos = sobrando.length + divergencias.length;
  const score = acertosExatos - falsosPositivos;
  const valido = faltando.length === 0 && sobrando.length === 0 && divergencias.length === 0;

  return {
    valido,
    totalEsperado: esperados.length,
    totalObtido: obtidos.length,
    acertosExatos,
    acertosBitABit,
    faltando,
    sobrando,
    divergencias,
    score,
  };
}

export function validarContraArquivo(
  obtidos: Encontro[],
  caminhoEsperado: string,
  toleranciaDistancia = 1e-9
): ResultadoValidacao {
  const raw = fs.readFileSync(caminhoEsperado, 'utf8');
  const esperados = JSON.parse(raw) as Encontro[];
  return validarEncontros(obtidos, esperados, toleranciaDistancia);
}

export function formatarRelatorioValidacao(resultado: ResultadoValidacao, maxExemplos = 5): string {
  const linhas: string[] = [
    `--- RELATÓRIO DE VALIDAÇÃO ---`,
    `Status: ${resultado.valido ? 'VÁLIDO (100% aderente)' : 'DIVERGENTE'}`,
    `Score Oficial: ${resultado.score}`,
    `Esperados: ${resultado.totalEsperado} | Obtidos: ${resultado.totalObtido}`,
    `Acertos Exatos: ${resultado.acertosExatos} (Bit-a-bit idênticos: ${resultado.acertosBitABit})`,
    `Faltando (Falsos Negativos): ${resultado.faltando.length}`,
    `Sobrando (Falsos Positivos): ${resultado.sobrando.length}`,
    `Divergências de Tipo/Distância: ${resultado.divergencias.length}`,
  ];

  if (resultado.faltando.length > 0) {
    linhas.push(`\nExemplos Faltando:`);
    for (const e of resultado.faltando.slice(0, maxExemplos)) {
      linhas.push(`  - [${e.timestamp}] Par: ${JSON.stringify(e.monitoradosEncontro)}, Tipo: ${e.tipo}`);
    }
  }

  if (resultado.sobrando.length > 0) {
    linhas.push(`\nExemplos Sobrando:`);
    for (const e of resultado.sobrando.slice(0, maxExemplos)) {
      linhas.push(`  - [${e.timestamp}] Par: ${JSON.stringify(e.monitoradosEncontro)}, Tipo: ${e.tipo}`);
    }
  }

  if (resultado.divergencias.length > 0) {
    linhas.push(`\nExemplos Divergências:`);
    for (const d of resultado.divergencias.slice(0, maxExemplos)) {
      linhas.push(
        `  - Chave: ${d.chave} | Tipo esp/obt: ${d.esperado.tipo}/${d.obtido.tipo} | DiffDist: ${d.diferencaDistancia}`
      );
    }
  }

  linhas.push(`------------------------------`);
 
  return linhas.join('\n');
}