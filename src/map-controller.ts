// map-controller.ts - 地图相关功能

import maplibregl from 'maplibre-gl';
import './maplibre-extensions.d'; // 导入类型扩展
import { TrackPoint, StopSegment, TrackSegment, ColorMode } from './types';
import { calculateBearing, calculateDistance, turboColormap } from './utils';
import { calculateSpeedsWithPercentiles } from './track-parser';

export class MapController {
  private map?: maplibregl.Map;
  private mapContainer: HTMLElement;
  private currentPoints: TrackPoint[] = [];
  private currentSegments: TrackSegment[] = [];
  private segmentVisibility: boolean[] = [];
  private currentStops: StopSegment[] = [];
  private currentColorMode: ColorMode = 'speed';
  // Flag to track if MapLibre is loaded

  constructor(mapContainer: HTMLElement) {
    this.mapContainer = mapContainer;
  }

  /**
   * 确保 MapLibre GL 已加载
   */
  async ensureMaplibreLoaded(): Promise<void> {
    if (window.maplibregl) {
      return Promise.resolve();
    }
    
    if (window._gpxViewerMaplibreLoading) {
      return window._gpxViewerMaplibreLoading as Promise<void>;
    }
    
    // MapLibre GL should be loaded externally via HTML script tag
    window._gpxViewerMaplibreLoading = Promise.reject(new Error('MapLibre GL must be loaded externally'));
    
    return window._gpxViewerMaplibreLoading as Promise<void>;
  }

  /**
   * 初始化地图
   */
  async initMap(): Promise<void> {
    await this.ensureMaplibreLoaded();
    
    this.map = new maplibregl.Map({
      container: this.mapContainer,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [139.767, 35.681],
      zoom: 5
    });
    
    return new Promise<void>((resolve) => {
      this.map!.on('load', () => {
        this.onMapLoaded();
        resolve();
      });
      
      this.map!.on('error', (e: maplibregl.ErrorEvent) => {
        const mapError = e.error as { status?: number, message?: string };
        const url = (e as any).url; // Cast to any to access potentially undefined url property
        if (mapError && mapError.status === 403 && url && typeof url === 'string' && url.includes('openfreemap.org')) {
          alert("无法加载 OpenFreeMap 瓦片。请检查网络连接或瓦片服务状态。");
        } else if (mapError) {
          alert("加载地图时出错：" + (mapError.message || "未知错误"));
        }
      });
      
      this.map!.on('zoomend', () => this.updateArrowsOnZoom());
    });
  }

  /**
   * 地图加载完成时的处理
   */
  private onMapLoaded(): void {
    if (!this.map) return;
    
    // 地图源和图层初始化
    this.map.addSource('full-track', { 
      type: 'geojson', 
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} } 
    });
    
    // 添加描边图层（更宽，颜色对比）
    this.map.addLayer({ 
      id: 'full-track-stroke', 
      type: 'line', 
      source: 'full-track', 
      layout: { 'line-join': 'round', 'line-cap': 'round' }, 
      paint: { 'line-color': '#000000', 'line-width': 8, 'line-opacity': 0.9 } 
    });
    
    this.map.addLayer({ 
      id: 'full-track-line', 
      type: 'line', 
      source: 'full-track', 
      layout: { 'line-join': 'round', 'line-cap': 'round' }, 
      paint: { 'line-color': '#007bff', 'line-width': 5, 'line-opacity': 0.8 } 
    });
    
    this.map.addSource('highlighted-segment', { 
      type: 'geojson', 
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} } 
    });
    
    this.map.addLayer({ 
      id: 'highlighted-segment-line', 
      type: 'line', 
      source: 'highlighted-segment', 
      layout: { 'line-join': 'round', 'line-cap': 'round' }, 
      paint: { 'line-color': '#FFD700', 'line-width': 7, 'line-opacity': 0.85 } 
    });

    // 箭头图标
    this.initArrowIcon();
    
    // 已走过轨迹
    this.map.addSource('travelled-track', { 
      type: 'geojson', 
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} } 
    });
    
    this.map.addLayer({ 
      id: 'travelled-track-line', 
      type: 'line', 
      source: 'travelled-track', 
      layout: { 'line-join': 'round', 'line-cap': 'round' }, 
      paint: { 'line-color': '#28a745', 'line-width': 6, 'line-opacity': 0.9 } 
    });
    
    // 当前点
    this.map.addSource('current-point', { 
      type: 'geojson', 
      data: { type: 'FeatureCollection', features: [] } 
    });
    
    this.map.addLayer({ 
      id: 'current-point-marker', 
      type: 'circle', 
      source: 'current-point', 
      paint: { 'circle-radius': 8, 'circle-color': '#dc3545', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } 
    });
    
    // 分段轨迹
    this.map.addSource('track-segments', { 
      type: 'geojson', 
      data: { type: 'FeatureCollection', features: [] } 
    });
    
    // 添加分段轨迹描边层（黑色，更宽）
    this.map.addLayer({ 
      id: 'track-segments-stroke', 
      type: 'line', 
      source: 'track-segments', 
      layout: { 'line-join': 'round', 'line-cap': 'round' }, 
      paint: { 'line-color': '#000000', 'line-width': 8, 'line-opacity': 0.9 } 
    }, 'full-track-line');
    
    // 添加分段轨迹彩色层
    this.map.addLayer({ 
      id: 'track-segments-line', 
      type: 'line', 
      source: 'track-segments', 
      layout: { 'line-join': 'round', 'line-cap': 'round' }, 
      paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': 0.95 } 
    }, 'full-track-line');
    
    this.map.setLayoutProperty('track-segments-stroke', 'visibility', 'none');
    this.map.setLayoutProperty('track-segments-line', 'visibility', 'none');

    // 静止点
    this.initStopPoints();
    
    // 添加悬停交互
    this.setupTrackHoverInteractions();
  }

  /**
   * 初始化方向箭头图标
   */
  private initArrowIcon(): void {
    if (!this.map) return;
    
    const arrowUpSvgString = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><polygon points="6,0 12,9 0,9" fill="currentColor"/></svg>`;
    const img = new Image(16, 16);
    
    img.onload = () => {
      if (!this.map || this.map.hasImage('arrow-icon')) return;
      
      this.map.addImage('arrow-icon', img, { sdf: true });
      
      if (!this.map.getSource('arrow-points')) {
        this.map.addSource('arrow-points', { 
          type: 'geojson', 
          data: { type: 'FeatureCollection', features: [] } 
        });
      }
      
      if (!this.map.getLayer('gpx-arrows')) {
        this.map.addLayer({ 
          id: 'gpx-arrows', 
          type: 'symbol', 
          source: 'arrow-points', 
          layout: { 
            'icon-image': 'arrow-icon', 
            'icon-size': 0.7, 
            'icon-rotate': ['get', 'bearing'], 
            'icon-rotation-alignment': 'map', 
            'icon-allow-overlap': true, 
            'icon-ignore-placement': true 
          }, 
          paint: { 
            'icon-color': '#003399', 
            'icon-opacity': 0.85 
          } 
        }, 'travelled-track-line');
      }
    };
    
    img.onerror = (e) => { 
      console.error("Failed to load arrow SVG for map icon.", e); 
    };
    
    img.src = 'data:image/svg+xml;base64,' + btoa(arrowUpSvgString);
  }

  /**
   * 初始化静止点图层
   */
  private initStopPoints(): void {
    if (!this.map) return;
    
    this.map.addSource('stop-points', { 
      type: 'geojson', 
      data: { type: 'FeatureCollection', features: [] } 
    });
    
    this.map.addLayer({
      id: 'stop-points-layer',
      type: 'circle',
      source: 'stop-points',
      paint: {
        'circle-radius': 10,
        'circle-color': ['get', 'color'],
        'circle-stroke-width': 3,
        'circle-stroke-color': '#fff',
        'circle-opacity': 0.85
      }
    });

    const pauseSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'><rect x='4' y='4' width='4' height='12' rx='1.5' fill='#fff'/><rect x='12' y='4' width='4' height='12' rx='1.5' fill='#fff'/></svg>`;
    const pauseImg = new Image(20, 20);
    
    pauseImg.onload = () => {
      if (!this.map || this.map.hasImage('pause-icon')) return;
      
      this.map.addImage('pause-icon', pauseImg, { sdf: false });
      
      if (!this.map.getLayer('stop-points-pause')) {
        this.map.addLayer({
          id: 'stop-points-pause',
          type: 'symbol',
          source: 'stop-points',
          layout: {
            'icon-image': 'pause-icon',
            'icon-size': 0.7,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
          }
        });
      }
    };
    
    pauseImg.src = 'data:image/svg+xml;base64,' + btoa(pauseSvg);
    
    // 悬停静止点显示信息
    const stopPopup = new maplibregl.Popup({ 
      closeButton: false, 
      closeOnClick: false, 
      offset: 12 
    });
    
    this.map.on('mouseenter', 'stop-points-layer', (e) => {
      if (!this.map) return;
      
      this.map.getCanvas().style.cursor = 'pointer';
      const feat = e.features && e.features[0];
      
      if (feat && feat.properties) {
        const { startTime, endTime, durationSec } = feat.properties;
        const startStr = new Date(startTime * 1000).toLocaleString();
        const endStr = new Date(endTime * 1000).toLocaleString();
        const min = Math.floor(durationSec / 60);
        const sec = Math.round(durationSec % 60);
        
        const html = `<div style="font-family:sans-serif;font-size:0.95em;line-height:1.5;">
          <b>静止区段</b><br>
          开始：${startStr}<br>
          结束：${endStr}<br>
          持续：${min}分${sec}秒
        </div>`;
        
        if (feat.geometry.type === 'Point' && Array.isArray(feat.geometry.coordinates)) {
          const coords = feat.geometry.coordinates as [number, number];
          stopPopup.setLngLat(coords)
                   .setHTML(html)
                   .addTo(this.map);
        }
      }
    });
    
    this.map.on('mouseleave', 'stop-points-layer', () => {
      if (!this.map) return;
      this.map.getCanvas().style.cursor = '';
      if (stopPopup.isOpen()) stopPopup.remove();
    });
  }

  /**
   * 设置轨迹悬停交互
   */
  private setupTrackHoverInteractions(): void {
    if (!this.map) return;
    
    const trackPopup = new maplibregl.Popup({ 
      closeButton: false, 
      closeOnClick: false, 
      offset: 15 
    });
    
    const handleTrackHoverLayer = (layerId: string) => {
      this.map!.on('mousemove', layerId, (e) => {
        if (!this.map || !this.currentPoints || this.currentPoints.length < 2) { 
          if (trackPopup.isOpen()) trackPopup.remove(); 
          if (this.map) this.map.getCanvas().style.cursor = ''; 
          return; 
        }
        
        this.map.getCanvas().style.cursor = 'pointer';
        const mouseLngLat = e.lngLat;
        
        let closestSegment: { p1: TrackPoint; p2: TrackPoint; index: number } | null = null;
        let minDistanceSqToMidpoint = Infinity;
        
        for (let i = 0; i < this.currentPoints.length - 1; i++) {
          const p1 = this.currentPoints[i];
          const p2 = this.currentPoints[i + 1];
          
          if (!p1 || !p2 || 
              typeof p1.longitude !== 'number' || 
              typeof p1.latitude !== 'number' || 
              typeof p2.longitude !== 'number' || 
              typeof p2.latitude !== 'number') continue;
          
          const midLng = (p1.longitude + p2.longitude) / 2;
          const midLat = (p1.latitude + p2.latitude) / 2;
          const distLat = midLat - mouseLngLat.lat;
          const distLng = midLng - mouseLngLat.lng;
          const distanceSq = distLat * distLat + distLng * distLng;
          
          if (distanceSq < minDistanceSqToMidpoint) { 
            minDistanceSqToMidpoint = distanceSq; 
            closestSegment = { p1, p2, index: i }; 
          }
        }
        
        if (closestSegment) {
          const { p1, p2 } = closestSegment;
          const timeDiffSeconds = p2.timestamp - p1.timestamp;
          const distanceMeters = calculateDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
          
          if (this.map!.getSource('highlighted-segment')) {
            this._setSourceData('highlighted-segment', { 
              type: 'Feature', 
              geometry: { 
                type: 'LineString', 
                coordinates: [
                  [p1.longitude, p1.latitude, p1.altitude], 
                  [p2.longitude, p2.latitude, p2.altitude]
                ] 
              }, 
              properties: {} 
            });
          }
          
          let speedKmphText = "---";
          
          if (timeDiffSeconds > 0) {
            const speedKmph = (distanceMeters / 1000) / (timeDiffSeconds / 3600);
            speedKmphText = `${speedKmph.toFixed(2)} km/h`;
          } else if (timeDiffSeconds === 0) {
            if (distanceMeters > 0) speedKmphText = "瞬时移动"; 
            else speedKmphText = "0.00 km/h (静止)";
          } else { 
            speedKmphText = "数据错误"; 
          }
          
          const segmentStartTime = new Date(p1.timestamp * 1000).toLocaleTimeString(
            [], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }
          );
          
          const segmentEndTime = new Date(p2.timestamp * 1000).toLocaleTimeString(
            [], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }
          );
          
          const segmentDuration = Math.abs(timeDiffSeconds);
          
          const popupContent = `<div style="font-family: sans-serif; font-size: 0.9em; line-height: 1.4;">
            <strong>轨迹段信息</strong><br>
            时段: ${segmentStartTime} - ${segmentEndTime}<br>
            时长: ${segmentDuration.toFixed(1)} 秒<br>
            距离: ${distanceMeters.toFixed(1)} 米<br>
            速度: ${speedKmphText}
          </div>`;
          
          trackPopup.setLngLat(mouseLngLat).setHTML(popupContent).addTo(this.map!);
        } else {
          if (trackPopup.isOpen()) trackPopup.remove();
          if (this.map!.getSource('highlighted-segment')) {
            this._setSourceData('highlighted-segment', { 
              type: 'Feature', 
              geometry: { type: 'LineString', coordinates: [] }, 
              properties: {} 
            });
          }
        }
      });
      
      this.map!.on('mouseleave', layerId, () => {
        if (!this.map) return;
        
        if (trackPopup.isOpen()) trackPopup.remove();
        this.map.getCanvas().style.cursor = '';
        
        if (this.map.getSource('highlighted-segment')) {
          this._setSourceData('highlighted-segment', { 
            type: 'Feature', 
            geometry: { type: 'LineString', coordinates: [] }, 
            properties: {} 
          });
        }
      });
    };

    // 添加悬浮事件处理
    if (this.map.getLayer('full-track-line')) {
      handleTrackHoverLayer('full-track-line');
    }
    
    if (this.map.getLayer('track-segments-line')) {
      handleTrackHoverLayer('track-segments-line');
    }
  }

  /**
   * 缩放改变时更新箭头密度
   */
  private updateArrowsOnZoom(): void {
    if (!this.map || !this.currentPoints || this.currentPoints.length <= 1) return;
    
    // 只在箭头图层可见且有可见轨迹时才更新箭头
    if (
      this.map.getSource('arrow-points') &&
      this.map.style.getImage('arrow-icon') &&
      this.map.getLayoutProperty('gpx-arrows', 'visibility') === 'visible'
    ) {
      // 获取当前可见轨迹点
      const pts = this.getVisibleTrackPoints();
      if (pts && pts.length > 1) {
        const arrowFeatures = this.generateArrowFeatures(pts, this.map.getZoom());
        this._setSourceData('arrow-points', arrowFeatures);
      }
    }
  }

  /**
   * 加载轨迹数据到地图
   */
  loadTrackData(points: TrackPoint[], segments: TrackSegment[], stops: StopSegment[]): void {
    if (!this.map) return;
    
    this.currentPoints = points;
    this.currentSegments = segments;
    this.currentStops = stops;
    this.segmentVisibility = segments.map(() => false); // 默认全未选中
    
    // 设置轨迹 GeoJSON
    if (points.length > 0) {
      const coordinates = points.map(p => [p.longitude, p.latitude, p.altitude]);
      const geoJSON = {
        type: 'Feature' as const,
        geometry: { 
          type: 'LineString' as const, 
          coordinates 
        },
        properties: {}
      };
      
      this._setSourceData('full-track', geoJSON);
    } else {
      this._setSourceData('full-track', { 
        type: 'Feature' as const, 
        geometry: { type: 'LineString' as const, coordinates: [] }, 
        properties: {} 
      });
    }
    
    // 更新当前点索引为起始点
    this.updateMapForIndex(0);
    
    // 更新分段轨迹图层
    this.updateTrackSegmentsLayer();
    
    // 更新箭头
    if (points.length > 1 && this.map.getSource('arrow-points') && this.map.style.getImage('arrow-icon')) {
      const arrowFeatures = this.generateArrowFeatures(points, this.map.getZoom());
      this._setSourceData('arrow-points', arrowFeatures);
    }
    
    // 更新静止点图层
    this.updateStopPointsLayer();
    
    // 自适应缩放到轨迹边界
    if (points.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      
      points.forEach(p => {
        bounds.extend([p.longitude, p.latitude]);
      });
      
      this.map.fitBounds(bounds, { padding: 60 });
    }
  }

  /**
   * 更新地图当前点和已走轨迹（只用可见分段）
   */
  updateMapForIndex(index: number): string {
    if (!this.map || !this.map.loaded()) return "";
    
    const visiblePoints = this.getVisibleTrackPoints();
    
    if (!visiblePoints || visiblePoints.length === 0 || index < 0 || index >= visiblePoints.length) {
      if (!visiblePoints || visiblePoints.length === 0) {
        if (this.map.getSource('current-point')) {
          this._setSourceData('current-point', { 
            type: 'FeatureCollection' as const, 
            features: [] 
          });
        }
        
        if (this.map.getSource('travelled-track')) {
          this._setSourceData('travelled-track', { 
            type: 'Feature' as const, 
            geometry: { type: 'LineString' as const, coordinates: [] }, 
            properties: {} 
          });
        }
        
        return "无轨迹数据";
      }
      
      return "";
    }
    
    const currentPointData = visiblePoints[index];
    
    if (this.map.getSource('current-point')) {
      this._setSourceData('current-point', {
        type: 'Feature' as const,
        geometry: { 
          type: 'Point' as const, 
          coordinates: [currentPointData.longitude, currentPointData.latitude] 
        },
        properties: { 
          timestamp: currentPointData.timestamp, 
          altitude: currentPointData.altitude 
        }
      });
    }
    
    if (this.map.getSource('travelled-track')) {
      const travelledCoordinates = visiblePoints.slice(0, index + 1).map(
        p => [p.longitude, p.latitude, p.altitude]
      );
      
      this._setSourceData('travelled-track', {
        type: 'Feature' as const,
        geometry: { 
          type: 'LineString' as const, 
          coordinates: travelledCoordinates 
        },
        properties: {}
      });
    }
    
    const date = new Date(currentPointData.timestamp * 1000);
    return `${date.toLocaleString()} (海拔：${currentPointData.altitude.toFixed(1)}m)`;
  }

  /**
   * 动态生成箭头
   */
  generateArrowFeatures(trackPoints: TrackPoint[], currentZoom: number): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];
    
    if (!trackPoints || trackPoints.length < 2) {
      return { type: 'FeatureCollection', features };
    }
    
    const BASE_ARROW_ZOOM = 15;
    const ARROW_INTERVAL_METERS_AT_BASE_ZOOM = 250;
    const MIN_ARROW_INTERVAL_METERS = 30;
    const MAX_ARROW_INTERVAL_METERS = 2000000;
    
    let arrowIntervalMeters = ARROW_INTERVAL_METERS_AT_BASE_ZOOM * Math.pow(2, BASE_ARROW_ZOOM - currentZoom);
    arrowIntervalMeters = Math.max(MIN_ARROW_INTERVAL_METERS, Math.min(MAX_ARROW_INTERVAL_METERS, arrowIntervalMeters));
    
    let distanceSinceLastArrow = 0;
    let bearing = calculateBearing(
      trackPoints[0].latitude, trackPoints[0].longitude, 
      trackPoints[1].latitude, trackPoints[1].longitude
    );
    
    features.push({
      type: 'Feature',
      geometry: { 
        type: 'Point', 
        coordinates: [trackPoints[0].longitude, trackPoints[0].latitude] 
      },
      properties: { bearing }
    });
    
    for (let i = 1; i < trackPoints.length; i++) {
      const p1 = trackPoints[i - 1];
      const p2 = trackPoints[i];
      
      if (p1.longitude === p2.longitude && p1.latitude === p2.latitude) continue;
      
      const segmentDistance = calculateDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
      const totalDistance = distanceSinceLastArrow + segmentDistance;
      
      if (totalDistance >= arrowIntervalMeters) {
        const arrowCount = Math.floor(totalDistance / arrowIntervalMeters);
        
        for (let j = 1; j <= arrowCount; j++) {
          const d = arrowIntervalMeters * j - distanceSinceLastArrow;
          const t = d / segmentDistance;
          const lat = p1.latitude + (p2.latitude - p1.latitude) * t;
          const lon = p1.longitude + (p2.longitude - p1.longitude) * t;
          const bearing = calculateBearing(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
          
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: { bearing }
          });
        }
        
        distanceSinceLastArrow = totalDistance % arrowIntervalMeters;
      } else {
        distanceSinceLastArrow = totalDistance;
      }
    }
    
    return { type: 'FeatureCollection', features };
  }

  /**
   * 生成分段轨迹GeoJSON，按colorMode着色
   */
  generateSegmentedTrackGeoJSON(points: TrackPoint[], colorMode: ColorMode): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];
    
    if (!points || points.length < 2) return { type: 'FeatureCollection', features };
    
    if (colorMode === 'fixed') {
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i], p2 = points[i + 1];
        
        features.push({
          type: 'Feature',
          geometry: { 
            type: 'LineString', 
            coordinates: [
              [p1.longitude, p1.latitude, p1.altitude], 
              [p2.longitude, p2.latitude, p2.altitude]
            ] 
          },
          properties: { color: '#007bff' }
        });
      }
    } else if (colorMode === 'speed') {
      const { speeds, minV, maxV } = calculateSpeedsWithPercentiles(points);
      
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i], p2 = points[i + 1];
        let norm = (maxV > minV) ? (speeds[i] - minV) / (maxV - minV) : 0;
        
        features.push({
          type: 'Feature',
          geometry: { 
            type: 'LineString', 
            coordinates: [
              [p1.longitude, p1.latitude, p1.altitude], 
              [p2.longitude, p2.latitude, p2.altitude]
            ] 
          },
          properties: { color: turboColormap(norm) }
        });
      }
    } else if (colorMode === 'time') {
      const t0 = points[0].timestamp, t1 = points[points.length - 1].timestamp;
      
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i], p2 = points[i + 1];
        let norm = (t1 > t0) ? (p1.timestamp - t0) / (t1 - t0) : 0;
        
        features.push({
          type: 'Feature',
          geometry: { 
            type: 'LineString', 
            coordinates: [
              [p1.longitude, p1.latitude, p1.altitude], 
              [p2.longitude, p2.latitude, p2.altitude]
            ] 
          },
          properties: { color: turboColormap(norm) }
        });
      }
    }
    
    return { type: 'FeatureCollection', features };
  }

  /**
   * 更新静止点图层
   */
  updateStopPointsLayer(): void {
    if (!this.map || !this.map.getSource('stop-points')) return;
    
    const stops = this.currentStops || [];
    
    // 计算最大最小durationSec
    let minDur = Infinity, maxDur = -Infinity;
    stops.forEach(s => {
      if (s.durationSec < minDur) minDur = s.durationSec;
      if (s.durationSec > maxDur) maxDur = s.durationSec;
    });
    
    // 生成带颜色的feature
    const features: GeoJSON.Feature[] = stops.map(stop => {
      let norm = (maxDur > minDur) ? (stop.durationSec - minDur) / (maxDur - minDur) : 0;
      
      return {
        type: 'Feature',
        geometry: { 
          type: 'Point', 
          coordinates: [stop.centerLng, stop.centerLat] 
        },
        properties: {
          startTime: stop.startTime,
          endTime: stop.endTime,
          durationSec: stop.durationSec,
          color: turboColormap(norm)
        }
      };
    });
    
    this._setSourceData('stop-points', { type: 'FeatureCollection', features });
  }

  /**
   * 更新分段轨迹图层（只显示选中段，未选中时显示全部）
   */
  updateTrackSegmentsLayer(): void {
    if (!this.map || !this.map.getSource('track-segments')) return;
    
    if (this.currentSegments && this.segmentVisibility) {
      const anySelected = this.segmentVisibility.some(v => v);
      const allSegments: [number, number, number][][] = [];
      const allFeatures: GeoJSON.Feature[] = [];
      
      this.currentSegments.forEach((seg, idx) => {
        if (anySelected ? this.segmentVisibility[idx] : true) {
          if (seg.points.length > 1) {
            allSegments.push(seg.points.map(p => [p.longitude, p.latitude, p.altitude]));
            
            // 为每个分段独立生成带颜色的features
            const segGeoJSON = this.generateSegmentedTrackGeoJSON(seg.points, this.currentColorMode);
            if (segGeoJSON && segGeoJSON.features) {
              allFeatures.push(...segGeoJSON.features);
            }
          }
        }
      });
      
      // 设置分段轨迹数据
      this._setSourceData('track-segments', { type: 'FeatureCollection', features: allFeatures });
      
      // 主线和描边始终MultiLineString
      const mainLineGeoJSON = { 
        type: 'Feature' as const, 
        geometry: { 
          type: 'MultiLineString' as const, 
          coordinates: allSegments 
        }, 
        properties: {} 
      };
      
      this._setSourceData('full-track', mainLineGeoJSON);
      
      // 箭头
      if (this.map.getSource('arrow-points') && this.map.style.getImage('arrow-icon')) {
        let arrowFeatures: GeoJSON.FeatureCollection = { 
          type: 'FeatureCollection', 
          features: [] 
        };
        
        allSegments.forEach(segCoords => {
          if (segCoords.length > 1) {
            const segPoints = segCoords.map(c => ({ 
              longitude: c[0], 
              latitude: c[1], 
              altitude: c[2] || 0,
              timestamp: 0 // 添加缺失的timestamp字段，使用默认值
            }));
            
            const segArrows = this.generateArrowFeatures(segPoints, this.map?.getZoom() || 0);
            arrowFeatures.features = arrowFeatures.features.concat(segArrows.features);
          }
        });
        
        this._setSourceData('arrow-points', arrowFeatures);
      }
      
      // 显示/隐藏
      const visible = allSegments.length > 0;
      const showFull = this.currentColorMode === 'fixed';
      
      this.map.setLayoutProperty('full-track-line', 'visibility', (visible && showFull) ? 'visible' : 'none');
      this.map.setLayoutProperty('full-track-stroke', 'visibility', (visible && showFull) ? 'visible' : 'none');
      this.map.setLayoutProperty('track-segments-stroke', 'visibility', (visible && !showFull) ? 'visible' : 'none');
      this.map.setLayoutProperty('track-segments-line', 'visibility', (visible && !showFull) ? 'visible' : 'none');
      this.map.setLayoutProperty('gpx-arrows', 'visibility', visible ? 'visible' : 'none');
      this.map.setLayoutProperty('travelled-track-line', 'visibility', visible ? 'visible' : 'none');
      this.map.setLayoutProperty('current-point-marker', 'visibility', visible ? 'visible' : 'none');
      
      return;
    }
    
    const segGeoJSON = this.generateSegmentedTrackGeoJSON(this.currentPoints, this.currentColorMode);
    this._setSourceData('track-segments', segGeoJSON);
    
    const showFull = this.currentColorMode === 'fixed';
    this.map.setLayoutProperty('full-track-line', 'visibility', showFull ? 'visible' : 'none');
    this.map.setLayoutProperty('full-track-stroke', 'visibility', showFull ? 'visible' : 'none');
    this.map.setLayoutProperty('track-segments-stroke', 'visibility', showFull ? 'none' : 'visible');
    this.map.setLayoutProperty('track-segments-line', 'visibility', showFull ? 'none' : 'visible');
  }

  /**
   * 获取所有可见分段和自动补全段（始终补全连接）
   */
  getVisibleSegmentsWithBridges(): Array<{ isBridge: boolean; points: TrackPoint[] }> {
    const segs = this.currentSegments || [];
    const vis = this.segmentVisibility || [];
    const result: Array<{ isBridge: boolean; points: TrackPoint[] }> = [];
    
    let lastEnd: TrackPoint | null = null;
    
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      
      if (lastEnd && seg.points.length > 0) {
        // 检查上一个分段结尾和当前分段开头是否断开，若断开则补一段
        const prev = lastEnd;
        const curr = seg.points[0];
        
        if (prev.longitude !== curr.longitude || prev.latitude !== curr.latitude) {
          result.push({
            isBridge: true,
            points: [prev, curr]
          });
        }
      }
      
      if (vis[i]) {
        result.push({
          isBridge: false,
          points: seg.points
        });
        
        if (seg.points.length > 0) {
          lastEnd = seg.points[seg.points.length - 1];
        }
      } else {
        // 不可见分段也要更新lastEnd用于桥接
        if (seg.points.length > 0) {
          lastEnd = seg.points[seg.points.length - 1];
        }
      }
    }
    
    return result;
  }

  /**
   * 为地图源设置数据的帮助函数
   */
  private _setSourceData(sourceId: string, data: GeoJSON.FeatureCollection | GeoJSON.Feature): void {
    if (!this.map) return;
    
    const source = this.map.getSource(sourceId) as maplibregl.GeoJSONSource;
    if (source) source.setData(data);
  }
  
  /**
   * 获取所有可见分段的点
   */
  getVisibleTrackPoints(): TrackPoint[] {
    if (!this.currentSegments || !this.segmentVisibility) return [];
    
    // 有选中时只显示选中段，否则显示全部
    const anySelected = this.segmentVisibility.some(v => v);
    let pts: TrackPoint[] = [];
    
    this.currentSegments.forEach((seg, idx) => {
      if (anySelected ? this.segmentVisibility[idx] : true) {
        if (pts.length > 0 && seg.points.length > 0 && pts[pts.length - 1].timestamp === seg.points[0].timestamp) {
          pts = pts.concat(seg.points.slice(1));
        } else {
          pts = pts.concat(seg.points);
        }
      }
    });
    
    return pts;
  }

  /**
   * 缩放到当前可见轨迹的bbox
   */
  fitMapToVisibleTrack(): void {
    if (!this.map) return;
    
    const pts = this.getVisibleTrackPoints();
    if (!pts || pts.length === 0) return;
    
    const bounds = new maplibregl.LngLatBounds();
    pts.forEach(p => bounds.extend([p.longitude, p.latitude]));
    
    if (!bounds.isEmpty()) {
      this.map.fitBounds(bounds, { padding: 60 });
    }
  }

  /**
   * 设置当前颜色模式
   */
  setColorMode(colorMode: ColorMode): void {
    this.currentColorMode = colorMode;
    this.updateTrackSegmentsLayer();
  }

  /**
   * 获取当前颜色模式
   */
  getColorMode(): ColorMode {
    return this.currentColorMode;
  }

  /**
   * 切换分段可见性
   */
  toggleSegmentVisibility(index: number): void {
    if (!this.segmentVisibility || !this.currentSegments) return;
    
    this.segmentVisibility[index] = !this.segmentVisibility[index];
    this.updateTrackSegmentsLayer();
    
    // 自动缩放到当前可见轨迹
    this.fitMapToVisibleTrack();
  }

  /**
   * 重置所有分段可见性
   */
  resetSegmentVisibility(): void {
    if (!this.currentSegments) return;
    
    this.segmentVisibility = this.currentSegments.map(() => false);
    this.updateTrackSegmentsLayer();
    this.fitMapToVisibleTrack();
  }

  /**
   * 获取可见性数组的拷贝
   */
  getSegmentVisibility(): boolean[] {
    return [...this.segmentVisibility];
  }

  /**
   * 清除地图
   */
  clearMap(): void {
    if (!this.map) return;
    
    this._setSourceData('full-track', { 
      type: 'Feature', 
      geometry: { type: 'LineString', coordinates: [] }, 
      properties: {} 
    });
    
    this._setSourceData('arrow-points', { 
      type: 'FeatureCollection', 
      features: [] 
    });
    
    this._setSourceData('track-segments', { 
      type: 'FeatureCollection', 
      features: [] 
    });
    
    this._setSourceData('stop-points', {
      type: 'FeatureCollection',
      features: []
    });
    
    this.updateMapForIndex(0);
  }

  /**
   * 销毁地图实例
   */
  destroy(): void {
    if (this.map) {
      this.map.remove();
      this.map = undefined;
    }
  }
}

// 为 MapLibre 全局声明，以便 TypeScript 识别
declare global {
  interface Window {
    maplibregl: typeof maplibregl;
    _gpxViewerMaplibreLoading?: Promise<void>;
  }
}