// 扩展 MapLibre GL 类型
import maplibregl from 'maplibre-gl';

declare module 'maplibre-gl' {
  // 扩展 Map 类
  interface Map {
    style: {
      getImage(id: string): any;
    };
  }
  
  // 扩展 Source 类型
  interface Source {
    setData(data: GeoJSON.FeatureCollection | GeoJSON.Feature): void;
  }
  
  interface AnySourceImpl {
    setData(data: GeoJSON.FeatureCollection | GeoJSON.Feature): void;
  }
  
  interface GeoJSONSource {
    setData(data: GeoJSON.FeatureCollection | GeoJSON.Feature): void;
  }
  
  // 扩展 GeoJSON 源类型
  interface GeoJSONSourceRaw {
    setData?: (data: GeoJSON.FeatureCollection | GeoJSON.Feature) => void;
  }
  
  // 扩展 Geometry 类型
  namespace GeoJSONSourceSpecification {
    interface Geometry {
      coordinates: number[] | number[][] | number[][][] | number[][][][];
    }
  }
}