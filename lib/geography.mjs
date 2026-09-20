// Right-handed, Y-up globe: north is +Y, Greenwich is +X, 90°E is -Z.
// This keeps east to the right in a north-up view from outside the globe.
export function geographicPoint(latitude, longitude, radius = 1) {
  const lat = (latitude * Math.PI) / 180;
  const lon = (longitude * Math.PI) / 180;
  return [
    Math.cos(lat) * Math.cos(lon) * radius,
    Math.sin(lat) * radius,
    -Math.cos(lat) * Math.sin(lon) * radius,
  ];
}

export function geographicCoordinates([x, y, z]) {
  const radius = Math.hypot(x, y, z);
  return {
    lat: (Math.asin(Math.max(-1, Math.min(1, y / radius))) * 180) / Math.PI,
    lon: (Math.atan2(-z, x) * 180) / Math.PI,
  };
}
