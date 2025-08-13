// track-parser.ts - GPX解析和轨迹数据处理

import { RawTrackPoint, ProcessedTrackData, TrackPoint, StopSegment, TrackSegment } from './types';
import { calculateDistance } from './utils';

/**
 * GPX静止检测常量
 */
export const STOP_WINDOW_SIZE = 5; // 连续点数
export const STOP_SPEED_THRESHOLD_KMPH = 3; // km/h
export const STOP_MIN_DURATION_SEC = 60; // 静止区段最小持续时间（秒）
export const STOP_MAX_DISPLACEMENT_M = 30; // 静止区段最大位移（米）

/**
 * 解析GPX字符串为原始轨迹数据
 */
export function parseGPXToRawTrackData(gpxString: string): RawTrackPoint[] | null {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(gpxString, "text/xml");
  const newRawData: RawTrackPoint[] = [];
  
  const parseError = xmlDoc.getElementsByTagName("parsererror");
  if (parseError.length > 0) {
    console.error("GPX parsing error:", parseError[0].textContent);
    alert("GPX 文件解析失败。请检查文件格式。\n错误详情：" + parseError[0].textContent);
    return null;
  }
  
  const trkpts = xmlDoc.querySelectorAll('trkpt');
  if (trkpts.length === 0) {
    console.warn("GPX 文件中未找到 <trkpt> 元素。");
    alert("GPX 文件中未找到有效的轨迹点 (<trkpt>)。");
    return [];
  }
  
  trkpts.forEach((trkpt, index) => {
    const latAttr = trkpt.getAttribute('lat');
    const lonAttr = trkpt.getAttribute('lon');
    
    if (!latAttr || !lonAttr) {
      console.warn(`Trackpoint ${index + 1} 缺少经纬度属性，将被跳过。`);
      return;
    }
    
    const lat = parseFloat(latAttr);
    const lon = parseFloat(lonAttr);
    
    let ele = 0;
    const eleTag = trkpt.querySelector('ele');
    if (eleTag && eleTag.textContent) ele = parseFloat(eleTag.textContent);
    
    let time = null;
    const timeTag = trkpt.querySelector('time');
    if (timeTag && timeTag.textContent) {
      time = Math.floor(new Date(timeTag.textContent).getTime() / 1000);
    } else {
      console.warn(`Trackpoint ${index + 1} (Lat: ${lat}, Lon: ${lon}) 缺少时间信息，将被跳过。`);
      return;
    }
    
    if (!isNaN(lat) && !isNaN(lon) && time !== null && !isNaN(time)) {
      newRawData.push({
        timestamp: time,
        latitude_scaled_1e5: Math.round(lat * 1e5),
        longitude_scaled_1e5: Math.round(lon * 1e5),
        altitude_m_scaled_1e1: Math.round(ele * 1e1)
      });
    } else {
      console.warn(`跳过无效的轨迹点数据：Lat=${lat}, Lon=${lon}, Time=${time}, Ele=${ele}`);
    }
  });
  
  if (newRawData.length === 0 && trkpts.length > 0) {
    alert("GPX 文件中的轨迹点均无效或缺少必要信息 (有效的经纬度、时间)。");
  }
  
  return newRawData;
}

/**
 * 轨迹数据预处理
 */
export function processTrackData(rawData: RawTrackPoint[]): ProcessedTrackData {
  if (!rawData || rawData.length === 0) {
    return {
      points: [],
      fullTrackGeoJSON: { 
        type: 'Feature', 
        geometry: { 
          type: 'LineString', 
          coordinates: [] 
        }, 
        properties: {} 
      }
    };
  }
  
  const sortedRawData = [...rawData].sort((a, b) => a.timestamp - b.timestamp);
  
  const points: TrackPoint[] = sortedRawData.map(p => ({
    longitude: p.longitude_scaled_1e5 / 1e5,
    latitude: p.latitude_scaled_1e5 / 1e5,
    altitude: p.altitude_m_scaled_1e1 / 1e1,
    timestamp: p.timestamp
  }));
  
  const coordinates = points.map(p => [p.longitude, p.latitude, p.altitude]);
  
  // 检测静止区段
  const stops = detectStops(points);
  
  return {
    points: points,
    fullTrackGeoJSON: {
      type: 'Feature',
      geometry: { 
        type: 'LineString', 
        coordinates: coordinates 
      },
      properties: {}
    },
    stops: stops
  };
}

/**
 * 检测静止区段
 */
export function detectStops(points: TrackPoint[]): StopSegment[] {
  const res: StopSegment[] = [];
  
  if (!points || points.length < STOP_WINDOW_SIZE) return res;
  
  let i = 0;
  while (i <= points.length - STOP_WINDOW_SIZE) {
    let totalDist = 0, totalTime = 0;
    
    for (let j = 0; j < STOP_WINDOW_SIZE - 1; j++) {
      const p1 = points[i + j], p2 = points[i + j + 1];
      totalDist += calculateDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
      totalTime += Math.abs(p2.timestamp - p1.timestamp);
    }
    
    const displacement = calculateDistance(
      points[i].latitude, points[i].longitude,
      points[i + STOP_WINDOW_SIZE - 1].latitude,
      points[i + STOP_WINDOW_SIZE - 1].longitude
    );
    
    const avgSpeedKmph = totalTime > 0 ? (totalDist / 1000) / (totalTime / 3600) : 0;
    
    if (
      avgSpeedKmph < STOP_SPEED_THRESHOLD_KMPH &&
      displacement < STOP_MAX_DISPLACEMENT_M
    ) {
      // 向后扩展直到速度或位移超阈值
      let endIdx = i + STOP_WINDOW_SIZE - 1;
      // Get current end point
      
      while (endIdx + 1 < points.length) {
        const pPrev = points[endIdx], pNext = points[endIdx + 1];
        const dist = calculateDistance(pPrev.latitude, pPrev.longitude, pNext.latitude, pNext.longitude);
        const dt = Math.abs(pNext.timestamp - pPrev.timestamp);
        const v = dt > 0 ? (dist / 1000) / (dt / 3600) : 0;
        
        // 扩展后再判断首尾位移
        const newDisplacement = calculateDistance(
          points[i].latitude, points[i].longitude,
          points[endIdx + 1].latitude, points[endIdx + 1].longitude
        );
        
        if (v >= STOP_SPEED_THRESHOLD_KMPH || newDisplacement >= STOP_MAX_DISPLACEMENT_M) break;
        
        endIdx++;
      }
      
      const durationSec = points[endIdx].timestamp - points[i].timestamp;
      
      if (durationSec >= STOP_MIN_DURATION_SEC) {
        // 取区段中点为标记点
        const midIdx = Math.floor((i + endIdx) / 2);
        
        res.push({
          startIdx: i,
          endIdx: endIdx,
          startTime: points[i].timestamp,
          endTime: points[endIdx].timestamp,
          durationSec,
          centerLng: points[midIdx].longitude,
          centerLat: points[midIdx].latitude
        });
      }
      
      i = endIdx + 1;
    } else {
      i++;
    }
  }
  
  return res;
}

/**
 * 按静止区段切分轨迹，保证所有段首尾点连续，静止段和活动段都保留
 */
export function splitTrackByStops(points: TrackPoint[], stops: StopSegment[]): TrackSegment[] {
  if (!points || points.length < 2) return [];
  
  if (!stops || stops.length === 0) {
    return [{
      startIdx: 0,
      endIdx: points.length - 1,
      points: points.slice(),
      type: 'move'
    }];
  }
  
  const segments: TrackSegment[] = [];
  let segStart = 0;
  
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    
    // 活动段（静止前）
    if (stop.startIdx > segStart) {
      segments.push({
        startIdx: segStart,
        endIdx: stop.startIdx,
        points: points.slice(segStart, stop.startIdx + 1), // 包含首尾点
        type: 'move'
      });
    }
    
    // 静止段
    segments.push({
      startIdx: stop.startIdx,
      endIdx: stop.endIdx,
      points: points.slice(stop.startIdx, stop.endIdx + 1), // 包含首尾点
      type: 'stop'
    });
    
    segStart = stop.endIdx;
  }
  
  // 最后一个活动段
  if (segStart < points.length - 1) {
    segments.push({
      startIdx: segStart,
      endIdx: points.length - 1,
      points: points.slice(segStart),
      type: 'move'
    });
  }
  
  // 统计信息
  segments.forEach(seg => {
    if (seg.points.length < 2) return;
    
    seg.startTime = seg.points[0].timestamp;
    seg.endTime = seg.points[seg.points.length - 1].timestamp;
    seg.duration = seg.endTime - seg.startTime;
    
    let dist = 0;
    for (let i = 1; i < seg.points.length; i++) {
      dist += calculateDistance(
        seg.points[i - 1].latitude,
        seg.points[i - 1].longitude,
        seg.points[i].latitude,
        seg.points[i].longitude
      );
    }
    
    seg.distance = dist;
    seg.avgSpeed = seg.duration > 0 ? (dist / seg.duration) * 3.6 : 0; // km/h
  });
  
  return segments;
}

/**
 * 计算轨迹点速度并返回统计值（含百分位数）
 */
export function calculateSpeedsWithPercentiles(points: TrackPoint[]) {
  if (!points || points.length < 2) {
    return { speeds: [], minV: 0, maxV: 0 };
  }

  const speeds: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i], p2 = points[i + 1];
    const dt = p2.timestamp - p1.timestamp;
    const dist = calculateDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
    let v = (dt > 0) ? (dist / dt) : 0;
    speeds.push(v);
  }

  // 使用 p99 和 p1 作为 min 和 max
  const sortedSpeeds = [...speeds].sort((a, b) => a - b);
  const p99Index = Math.floor(sortedSpeeds.length * 0.99);
  const p1Index = Math.floor(sortedSpeeds.length * 0.01);
  const minV = sortedSpeeds[p1Index] || 0;
  const maxV = sortedSpeeds[p99Index] || 0;

  return { speeds, minV, maxV };
}

/**
 * 计算考虑周围段落的平均速度，用于短距离段落的着色
 */
export function calculateAveragedSpeedsForColoring(points: TrackPoint[], minDistanceMeters: number = 10) {
  if (!points || points.length < 2) {
    return { averagedSpeeds: [], originalSpeeds: [], minV: 0, maxV: 0 };
  }

  const originalSpeeds: number[] = [];
  const averagedSpeeds: number[] = [];

  // 先计算原始速度
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i], p2 = points[i + 1];
    const dt = p2.timestamp - p1.timestamp;
    const dist = calculateDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
    let v = (dt > 0) ? (dist / dt) : 0;
    originalSpeeds.push(v);
  }

  // 计算平均速度用于着色
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i], p2 = points[i + 1];
    const segmentDist = calculateDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);

    // 如果段落长度足够，直接使用原始速度
    if (segmentDist >= minDistanceMeters) {
      averagedSpeeds.push(originalSpeeds[i]);
      continue;
    }

    // 短段落需要寻找前后段落
    let totalDistance = segmentDist;
    let totalTime = p2.timestamp - p1.timestamp;

    // 向前寻找
    let forwardIdx = i - 1;
    while (forwardIdx >= 0 && totalDistance < minDistanceMeters) {
      const prevP1 = points[forwardIdx];
      const prevP2 = points[forwardIdx + 1];
      const prevDist = calculateDistance(prevP1.latitude, prevP1.longitude, prevP2.latitude, prevP2.longitude);
      const prevTime = prevP2.timestamp - prevP1.timestamp;

      totalDistance += prevDist;
      totalTime += prevTime;
      forwardIdx--;
    }

    // 向后寻找
    let backwardIdx = i + 2;
    while (backwardIdx < points.length && totalDistance < minDistanceMeters) {
      const nextP1 = points[backwardIdx - 1];
      const nextP2 = points[backwardIdx];
      const nextDist = calculateDistance(nextP1.latitude, nextP1.longitude, nextP2.latitude, nextP2.longitude);
      const nextTime = nextP2.timestamp - nextP1.timestamp;

      totalDistance += nextDist;
      totalTime += nextTime;
      backwardIdx++;
    }

    // 计算平均速度
    const avgSpeed = (totalTime > 0) ? (totalDistance / totalTime) : 0;
    averagedSpeeds.push(avgSpeed);
  }

  // 使用 p99 和 p1 作为 min 和 max
  const sortedSpeeds = [...averagedSpeeds].sort((a, b) => a - b);
  const p99Index = Math.floor(sortedSpeeds.length * 0.99);
  const p1Index = Math.floor(sortedSpeeds.length * 0.01);
  const minV = sortedSpeeds[p1Index] || 0;
  const maxV = sortedSpeeds[p99Index] || 0;

  return { averagedSpeeds, originalSpeeds, minV, maxV };
}
