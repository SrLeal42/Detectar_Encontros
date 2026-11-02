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

export interface TabelaMetadados {
  capacidade: number;
  conhecido: Uint8Array;
  faccaoPorId: Int32Array;
  ehVitimaPorId: Uint8Array;
  agressorUnicoPorId: Int32Array;
  agressoresExtrasPorId: Array<Set<number> | undefined>;
  mapaFaccoes: Map<string, number>;
  monitoradosDistintos: number;
}

export interface FrameTimestamp {
  timestampInt: number;
  tsByteOffset: number;
  tsBuffer: Buffer;
  quantidade: number;
  ids: Int32Array;
  latsInt: Int32Array;
  lonsInt: Int32Array;
}

export interface TemposExecucao {
  leituraMs: number;
  parseMs: number;
  deteccaoMs: number;
  escritaMs: number;
  totalMs: number;
}

export interface ResultadoDeteccao {
  encontros: Encontro[];
  contagemPorTipo: Record<TipoEncontro, number>;
  linhasLidas: number;
  timestampsDistintos: number;
  monitoradosDistintos: number;
  tempos: TemposExecucao;
}

export interface OpcoesCli {
  caminhoDataset?: string | undefined;
  caminhoExpected?: string | undefined;
  autoExpected: boolean;
  caminhoOut?: string | undefined;
  autoOut: boolean;
  benchIteracoes: number;
  executarTodos: boolean;
}

export interface TarefaWorker {
  sab: SharedArrayBuffer;
  inicioByte: number;
  fimByte: number;
}

export interface ResultadoWorker {
  encontros: Encontro[];
  contagemPorTipo: Record<TipoEncontro, number>;
  linhasLidas: number;
  timestampsDistintos: number;
  conhecido: Uint8Array;
  parseMs: number;
  deteccaoMs: number;
}