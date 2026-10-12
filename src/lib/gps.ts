/** Watches device GPS and reports altitude above sea level (metres), or null when unavailable. */
export function watchGpsAltitude(onAltitude: (altitudeM: number | null) => void): () => void {
  if (typeof navigator === "undefined" || !navigator.geolocation) return () => {};
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      const alt = pos.coords.altitude;
      onAltitude(typeof alt === "number" && Number.isFinite(alt) ? alt : null);
    },
    () => onAltitude(null),
    { enableHighAccuracy: true, maximumAge: 60000, timeout: 30000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
