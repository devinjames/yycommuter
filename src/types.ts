export type LatLon = { lat: number; lon: number };
export type Place = LatLon & { label: string };
export type Direction = 'toWork' | 'toHome';

export type Settings = {
  version: 1;
  home: Place | null;
  work: Place | null;
  /** route_short_name values, e.g. ["3", "300"] */
  routes: string[];
  refreshSec: 15 | 30 | 60;
  /** `${route}|${direction}` -> teleride_number */
  stopCache: Record<string, string>;
};

export type Stop = { id: string; name: string; route: string; pos: LatLon };

export type StopEta = { seq: number; time: number };

export type Bus = {
  vehicleId: string;
  tripId: string;
  routeId: string;
  pos: LatLon;
  /** epoch seconds of the vehicle position report */
  updatedAt: number;
  /** stopId -> arrivals sorted by stop sequence (a loop trip may visit a stop twice) */
  stopEtas: Map<string, StopEta[]>;
};
