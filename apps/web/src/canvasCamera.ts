export type Camera = {
  x: number;
  y: number;
  zoom: number;
};

export type ViewportPoint = {
  x: number;
  y: number;
};

export function clampZoom(value: number, minZoom: number, maxZoom: number): number {
  return Math.min(maxZoom, Math.max(minZoom, value));
}

export function screenToWorld(point: ViewportPoint, camera: Camera): ViewportPoint {
  return {
    x: (point.x - camera.x) / camera.zoom,
    y: (point.y - camera.y) / camera.zoom
  };
}

export function zoomCameraAroundPoint(camera: Camera, nextZoom: number, point: ViewportPoint, minZoom: number, maxZoom: number): Camera {
  const zoom = clampZoom(nextZoom, minZoom, maxZoom);
  const worldPoint = screenToWorld(point, camera);
  return {
    zoom,
    x: point.x - worldPoint.x * zoom,
    y: point.y - worldPoint.y * zoom
  };
}

export function panCamera(camera: Camera, deltaX: number, deltaY: number): Camera {
  return {
    ...camera,
    x: camera.x + deltaX,
    y: camera.y + deltaY
  };
}

export function cameraTransform(camera: Camera): string {
  return `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom})`;
}
