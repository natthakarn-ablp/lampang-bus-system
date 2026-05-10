import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';

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
 */
export default function PickupCoordPicker({ value, onChange, height = 240 }) {
  return (
    <MapContainer
      center={value || LAMPANG_CENTER}
      zoom={value ? 15 : 13}
      style={{ height }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {value && <Marker position={value} />}
      <ClickHandler onChange={onChange} />
    </MapContainer>
  );
}

function ClickHandler({ onChange }) {
  useMapEvents({
    click(e) { onChange([e.latlng.lat, e.latlng.lng]); },
  });
  return null;
}
