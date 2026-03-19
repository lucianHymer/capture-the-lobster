import { Hex, hexToString, stringToHex } from './hex.js';
import { UnitClass } from './movement.js';
import { getVisibleHexes } from './los.js';
import { CLASS_VISION } from './combat.js';

export interface FogUnit {
  id: string;
  team: 'A' | 'B';
  unitClass: UnitClass;
  position: Hex;
  alive: boolean;
}

export interface VisibleTile {
  q: number;
  r: number;
  type: 'ground' | 'wall' | 'base_a' | 'base_b';
  unit?: {
    id?: string; // only included for allies
    team: 'A' | 'B';
    unitClass: UnitClass;
    carryingFlag?: boolean;
  };
  flag?: {
    team: 'A' | 'B';
  };
}

/**
 * Get the set of hex keys visible to a specific unit.
 * Wraps the LoS system with the unit's class-specific vision radius.
 */
export function getUnitVision(
  unit: FogUnit,
  walls: Set<string>,
  allHexes: Set<string>,
): Set<string> {
  const radius = CLASS_VISION[unit.unitClass];
  return getVisibleHexes(unit.position, radius, walls, allHexes);
}

/**
 * Build the visible tile array for an agent's game state response.
 *
 * - Only includes tiles the viewer can see.
 * - Allies: include unit ID.
 * - Enemies: do NOT include unit ID (just team + class).
 * - Dead units are invisible.
 * - Flags are shown if they sit on a visible hex (either on the ground or
 *   carried by a unit standing on that hex).
 */
export function buildVisibleState(
  viewer: FogUnit,
  allUnits: FogUnit[],
  walls: Set<string>,
  tiles: Map<string, string>, // "q,r" -> tile type
  flags: {
    A: { position: Hex; carried: boolean; carrierId?: string };
    B: { position: Hex; carried: boolean; carrierId?: string };
  },
): VisibleTile[] {
  const visibleKeys = getUnitVision(viewer, walls, new Set(tiles.keys()));

  // Index alive units by hex key for quick lookup
  const unitsByHex = new Map<string, FogUnit[]>();
  for (const u of allUnits) {
    if (!u.alive) continue;
    const key = hexToString(u.position);
    const list = unitsByHex.get(key) ?? [];
    list.push(u);
    unitsByHex.set(key, list);
  }

  // Index flags by hex key
  const flagsByHex = new Map<string, 'A' | 'B'>();
  for (const team of ['A', 'B'] as const) {
    const f = flags[team];
    const flagKey = hexToString(f.position);
    // Flag is visible on its hex if not carried, OR if carried by a unit on that hex
    if (!f.carried) {
      flagsByHex.set(flagKey, team);
    } else if (f.carrierId) {
      // Find carrier position
      const carrier = allUnits.find((u) => u.id === f.carrierId && u.alive);
      if (carrier) {
        flagsByHex.set(hexToString(carrier.position), team);
      }
    }
  }

  const result: VisibleTile[] = [];

  for (const key of visibleKeys) {
    const hex = stringToHex(key);
    const tileType = (tiles.get(key) ?? 'ground') as VisibleTile['type'];

    const tile: VisibleTile = {
      q: hex.q,
      r: hex.r,
      type: tileType,
    };

    // Check for units on this hex
    const unitsHere = unitsByHex.get(key);
    if (unitsHere && unitsHere.length > 0) {
      // Pick the first unit on this hex (in practice there should be at most
      // one per team; enemy stacking is allowed but we report the first).
      const u = unitsHere[0];
      const isAlly = u.team === viewer.team;

      const isCarrying =
        (flags.A.carrierId === u.id && flags.A.carried) ||
        (flags.B.carrierId === u.id && flags.B.carried);

      tile.unit = {
        ...(isAlly ? { id: u.id } : {}),
        team: u.team,
        unitClass: u.unitClass,
        ...(isCarrying ? { carryingFlag: true } : {}),
      };
    }

    // Check for flag on this hex
    const flagTeam = flagsByHex.get(key);
    if (flagTeam !== undefined) {
      tile.flag = { team: flagTeam };
    }

    result.push(tile);
  }

  return result;
}
