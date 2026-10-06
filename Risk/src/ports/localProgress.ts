// Published verbatim from SPEC §4.16 as the cross-slice contract. S4 owns this file.

// src/ports/localProgress.ts
export interface MapRecord { played: number; won: number; lastSeats: number }
export interface LocalProgress { maps: Record<string, MapRecord>; deviceId: string }
export interface LocalProgressPort { read(): LocalProgress; recordResult(mapSlug: string, won: boolean): void }

