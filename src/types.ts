// types.ts - 类型定义

export interface TrackPoint {
  longitude: number;
  latitude: number;
  altitude: number;
  timestamp: number; // UNIX 时间戳（秒）
}

export interface RawTrackPoint {
  timestamp: number;
  latitude_scaled_1e5: number;
  longitude_scaled_1e5: number;
  altitude_m_scaled_1e1: number;
}

export interface StopSegment {
  startIdx: number;
  endIdx: number;
  startTime: number;
  endTime: number;
  durationSec: number;
  centerLng: number;
  centerLat: number;
}

export interface TrackSegment {
  startIdx: number;
  endIdx: number;
  points: TrackPoint[];
  type: 'move' | 'stop';
  startTime?: number;
  endTime?: number;
  duration?: number;
  distance?: number;
  avgSpeed?: number;
}

export interface ProcessedTrackData {
  points: TrackPoint[];
  fullTrackGeoJSON: GeoJSON.Feature<GeoJSON.LineString>;
  stops?: StopSegment[];
}

export type ColorMode = 'fixed' | 'speed' | 'time';