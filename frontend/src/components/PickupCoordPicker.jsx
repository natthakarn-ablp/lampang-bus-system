import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import './PickupCoordPicker.css';

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
 * Containment notes (Phase 6.1 hotfix-2 — escapes-the-modal bug):
 *
 *   Round 1 (commit 574ee2c) added `position: relative; overflow: hidden`
 *   on the wrapper. That wasn't enough on production: bare `position:
 *   relative` does NOT create a CSS stacking context. Leaflet's panes
 *   have z-indices 200–700 and the control wrapper is z-1000 — they
 *   stacked ABOVE sibling modal content (the student checklist, save
 *   buttons), making the map appear to "escape" visually.
 *
 *   Round 2 (this commit) seals the picker into a real stacking context:
 *
 *     1. Wrapper: `relative isolate z-0` + the .pickup-coord-picker
 *        scoping class. `isolation: isolate` + explicit `z-index: 0`
 *        on a `position: relative` element CREATES a stacking context
 *        — every Leaflet z-index inside is now contained.
 *     2. MapContainer: forced `!relative !z-0` + `zIndex: 0` inline so
 *        even a CSS conflict with leaflet.css's `.leaflet-container`
 *        (which sets its own z-index/position) loses to ours.
 *     3. PickupCoordPicker.css scopes Leaflet pane/control z-indices
 *        to 1 inside `.pickup-coord-picker` so they can't outrank
 *        anything in the modal.
 *     4. <SizeInvalidator/> still corrects the "0×0 at mount" measure
 *        bug for animating modals.
 */
export default function PickupCoordPicker({ value, onChange, height = 240 }) {
  return (
    <div
      className="pickup-coord-picker relative isolate z-0 overflow-hidden rounded-lg border border-surface-border"
      style={{ height, width: '100%' }}
    >
      <MapContainer
        center={value || LAMPANG_CENTER}
        zoom={value ? 15 : 13}
        className="!relative !z-0 h-full w-full"
        style={{ height: '100%', width: '100%', zIndex: 0 }}
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
