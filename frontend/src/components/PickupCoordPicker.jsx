import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';

// Lampang centroid — sane default when the form has no coords yet.
const LAMPANG_CENTER = [18.2884, 99.4906];

/**
 * PickupCoordPicker — a small click-to-set Leaflet map for forms.
 *
 * Used inside the create/edit pickup-point modals on Driver, School,
 * and Admin pages. When the user clicks anywhere on the map, the
 * onChange callback fires with [lat, lng] and the marker (if any)
 * moves to that spot.
 *
 * Props:
 *   value     — [lat, lng] | null    (current pin location)
 *   onChange  — ([lat, lng]) => void
 *   height    — number | string      (default 240)
 *
 * Containment notes (Phase 6.1 fix):
 *  - Wrapper div has `position: relative` + `overflow: hidden`. Leaflet's
 *    tile/popup/control panes use `position: absolute` and walk up the
 *    DOM looking for the nearest positioned ancestor; without an
 *    explicit one, they can attach to the document body and escape the
 *    modal visually.
 *  - Wrapper has explicit `height` + `width: 100%` so Leaflet measures
 *    a real box at mount instead of falling back to the viewport.
 *  - <SizeInvalidator/> calls map.invalidateSize() after mount to
 *    correct the sizing if the modal was animating in when the map
 *    measured its container.
 */
export default function PickupCoordPicker({ value, onChange, height = 240 }) {
  return (
    <div
      className="relative overflow-hidden rounded-lg"
      style={{ height, width: '100%' }}
    >
      <MapContainer
        center={value || LAMPANG_CENTER}
        zoom={value ? 15 : 13}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {value && <Marker position={value} />}
        <ClickHandler onChange={onChange} />
        <SizeInvalidator />
      </MapContainer>
    </div>
  );
}

function ClickHandler({ onChange }) {
  useMapEvents({
    click(e) { onChange([e.latlng.lat, e.latlng.lng]); },
  });
  return null;
}

/* Force Leaflet to recompute container size after mount.
   Fixes the "map renders huge / outside container" bug when the picker
   mounts inside an animating modal — at mount time the modal's box
   may still be 0×0, so Leaflet sizes itself wrong; invalidateSize()
   re-measures against the now-settled container. */
function SizeInvalidator() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}
