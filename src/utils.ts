// utils.ts - 通用工具函数

/**
 * 计算两个经纬度点之间的距离（米）
 */
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // 地球半径（米）
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;
  
  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
}

/**
 * 计算两个经纬度点之间的方位角（角度）
 */
export function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRadians = Math.PI / 180;
  const toDegrees = 180 / Math.PI;
  
  const y = Math.sin((lon2 - lon1) * toRadians) * Math.cos(lat2 * toRadians);
  const x = Math.cos(lat1 * toRadians) * Math.sin(lat2 * toRadians) -
    Math.sin(lat1 * toRadians) * Math.cos(lat2 * toRadians) * Math.cos((lon2 - lon1) * toRadians);
  
  let brng = Math.atan2(y, x) * toDegrees;
  brng = (brng + 360) % 360;
  
  return brng;
}

/**
 * turbo colormap: 输入0~1，输出rgb字符串
 */
export function turboColormap(t: number): string {
  t = Math.max(0, Math.min(1, t));
  const kRedVec4 = [0.13572138, 4.61539260, -42.66032258, 132.13108234];
  const kGreenVec4 = [0.09140261, 2.19418839, 4.84296658, -14.18503333];
  const kBlueVec4 = [0.10667330, 12.64194608, -60.58204836, 110.36276771];
  const kRedVec2 = [-152.94239396, 59.28637943];
  const kGreenVec2 = [4.27729857, 2.82956604];
  const kBlueVec2 = [-89.90310912, 27.34824973];
  
  const t2 = t * t;
  const t3 = t * t2;
  const t4 = t * t3;
  const t5 = t * t4;
  
  const r_float = kRedVec4[0] + kRedVec4[1] * t + kRedVec4[2] * t2 + kRedVec4[3] * t3 + kRedVec2[0] * t4 + kRedVec2[1] * t5;
  const g_float = kGreenVec4[0] + kGreenVec4[1] * t + kGreenVec4[2] * t2 + kGreenVec4[3] * t3 + kGreenVec2[0] * t4 + kGreenVec2[1] * t5;
  const b_float = kBlueVec4[0] + kBlueVec4[1] * t + kBlueVec4[2] * t2 + kBlueVec4[3] * t3 + kBlueVec2[0] * t4 + kBlueVec2[1] * t5;
  
  const r = Math.round(r_float * 255);
  const g = Math.round(g_float * 255);
  const b = Math.round(b_float * 255);
  
  return `rgb(${r},${g},${b})`;
}