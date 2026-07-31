"use client";

import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Modal } from "../../components/Modal";
import { useAppContext } from "../../context/AppContext";
import { useToast } from "../../context/ToastContext";

interface GeoPoint {
  lat: number;
  lng: number;
}

// Picks the device-wide point that {{$latitude}} / {{$longitude}} resolve to.
// Free OpenStreetMap tiles via Leaflet — click anywhere to set the point,
// "Use this point" persists it to the local-store "geo_point" pref.
export default function MapPickerDialog({ onClose }: { onClose: () => void }) {
  const { apiCall } = useAppContext();
  const { showToast } = useToast();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const [picked, setPicked] = useState<GeoPoint | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapRef.current) return;
    let cancelled = false;

    const placeMarker = (map: L.Map, point: GeoPoint) => {
      if (markerRef.current) {
        markerRef.current.setLatLng(point);
      } else {
        markerRef.current = L.circleMarker(point, {
          radius: 8,
          color: "#cc785c",
          fillColor: "#cc785c",
          fillOpacity: 0.6,
          weight: 2,
        }).addTo(map);
      }
    };

    const init = (stored: GeoPoint | null) => {
      if (cancelled || mapRef.current) return;
      const map = L.map(container).setView(
        stored ? [stored.lat, stored.lng] : [10, 60],
        stored ? 12 : 2
      );
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      if (stored) placeMarker(map, stored);
      map.on("click", (e: L.LeafletMouseEvent) => {
        const point = { lat: e.latlng.lat, lng: e.latlng.lng };
        placeMarker(map, point);
        setPicked(point);
      });
      mapRef.current = map;
    };

    apiCall("/api/local-store/pref/geo_point")
      .then((res: { value?: string } | null) => {
        let stored: GeoPoint | null = null;
        try {
          const parsed = JSON.parse(res?.value ?? "");
          if (typeof parsed?.lat === "number" && typeof parsed?.lng === "number") stored = parsed;
        } catch {
          // no valid stored point
        }
        init(stored);
      })
      .catch(() => init(null));

    return () => {
      cancelled = true;
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [apiCall]);

  const handleSave = async () => {
    if (!picked) return;
    setIsSaving(true);
    try {
      await apiCall("/api/local-store/pref/geo_point", {
        method: "PUT",
        body: JSON.stringify({ value: JSON.stringify(picked) }),
      });
      showToast("Location set — {{$latitude}} / {{$longitude}} now use this point", { type: "success" });
      onClose();
    } catch (e) {
      showToast(`Failed to save location: ${e instanceof Error ? e.message : String(e)}`, { type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal title="Pick a location" onClose={onClose} width={680}>
      <div className="flex flex-col gap-4">
        <p className="m-0 text-[13px] text-stone leading-relaxed">
          Click anywhere on the map. <code className="font-mono text-[12px]">{"{{$latitude}}"}</code> and{" "}
          <code className="font-mono text-[12px]">{"{{$longitude}}"}</code> resolve to the chosen point on every
          request from this device.
        </p>
        <div ref={mapContainerRef} className="h-[360px] rounded-xl border border-line overflow-hidden" />
        <div className="flex items-center justify-end gap-2 pt-1 border-t border-line">
          <span className="font-mono text-xs text-stone mr-auto">
            {picked ? `${picked.lat.toFixed(6)}, ${picked.lng.toFixed(6)}` : "No point selected"}
          </span>
          <button
            onClick={onClose}
            className="h-10 px-4 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!picked || isSaving}
            className="h-10 px-5 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white transition-colors disabled:opacity-50"
          >
            Use this point
          </button>
        </div>
      </div>
    </Modal>
  );
}
