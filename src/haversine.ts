export const RAIO_TERRA_METROS = 6_371_000;
export const DISTANCIA_LIMITE_METROS = 20;
export const DEG_TO_RAD = Math.PI / 180;
export const DLAT_MAX_GRAUS = DISTANCIA_LIMITE_METROS / RAIO_TERRA_METROS / DEG_TO_RAD;
export const DLAT_MAX_INT_1E5 = 18;

export function calcularDistanciaHaversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const h =
    Math.sin(dp / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dl / 2) ** 2;
  return 2 * RAIO_TERRA_METROS * Math.asin(Math.sqrt(h));
}