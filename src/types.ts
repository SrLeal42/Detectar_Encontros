export type TipoEncontro = 'generico' | 'faccao' | 'protetiva';

export interface Posicao {
  lat: number;
  lon: number;
}

export interface Encontro {
  tipo: TipoEncontro;
  monitoradosEncontro: [number, number];
  timestamp: string;
  posicoes: Record<string, Posicao>;
  distanciaMetros: number;
}

export interface DivergenciaAtributo {
  chave: string;
  esperado: Encontro;
  obtido: Encontro;
  tipoDiferente: boolean;
  diferencaDistancia: number;
  bitABitIgual: boolean;
}

export interface ResultadoValidacao {
  valido: boolean;
  totalEsperado: number;
  totalObtido: number;
  acertosExatos: number;
  acertosBitABit: number;
  faltando: Encontro[];
  sobrando: Encontro[];
  divergencias: DivergenciaAtributo[];
  score: number;
}