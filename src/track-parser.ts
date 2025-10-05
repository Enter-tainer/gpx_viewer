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

// 速度着色时，单段超过该距离则直接使用单段速度；否则使用回溯窗口
export const SPEED_COLOR_MIN_SEGMENT_LENGTH_M = 10;

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
export function calculateSpeedsWithPercentiles(
  points: TrackPoint[],
  minSegmentLengthMeters: number = SPEED_COLOR_MIN_SEGMENT_LENGTH_M
) {
  if (!points || points.length < 2) {
    return { speeds: [], minV: 0, maxV: 0, rawMin: 0, rawMax: 0 };
  }

  const numSegments = points.length - 1;
  const threshold = Math.max(minSegmentLengthMeters, 0);
  const segmentDistances = new Array<number>(numSegments);
  const segmentDurations = new Array<number>(numSegments);
  const speeds: number[] = new Array<number>(numSegments);

  let rawMin = Number.POSITIVE_INFINITY;
  let rawMax = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < numSegments; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    segmentDurations[i] = p2.timestamp - p1.timestamp;
    segmentDistances[i] = calculateDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
  }

  let windowDistance = 0;
  let windowStart = 0;

  for (let i = 0; i < numSegments; i++) {
    windowDistance += segmentDistances[i];

    // 维持最小窗口，保证距离阈值被满足（若可能）
    while (
      windowStart < i &&
      windowDistance - segmentDistances[windowStart] >= threshold
    ) {
      windowDistance -= segmentDistances[windowStart];
      windowStart++;
    }

    const currentDistance = segmentDistances[i];
    const currentDuration = segmentDurations[i];

    if (threshold <= 0 || currentDistance >= threshold) {
      speeds[i] = currentDuration > 0 ? currentDistance / currentDuration : 0;
      rawMin = Math.min(rawMin, speeds[i]);
      rawMax = Math.max(rawMax, speeds[i]);
      continue;
    }

    const windowDuration = points[i + 1].timestamp - points[windowStart].timestamp;

    if (windowDistance <= 0 || windowDuration <= 0) {
      speeds[i] = 0;
    } else {
      speeds[i] = windowDistance / windowDuration;
    }

    rawMin = Math.min(rawMin, speeds[i]);
    rawMax = Math.max(rawMax, speeds[i]);
  }

  if (!isFinite(rawMin)) rawMin = 0;
  if (!isFinite(rawMax)) rawMax = 0;

  // 使用 p99 和 p1 作为 min 和 max
  const sortedSpeeds = [...speeds].sort((a, b) => a - b);
  const p99Index = Math.floor(sortedSpeeds.length * 0.99);
  const p1Index = Math.floor(sortedSpeeds.length * 0.01);
  const minV = sortedSpeeds[p1Index] || 0;
  const maxV = sortedSpeeds[p99Index] || 0;

  return { speeds, minV, maxV, rawMin, rawMax };
}
