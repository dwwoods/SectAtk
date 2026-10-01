// Worldgen configuration — single source of truth for world size and
// raster resolutions. The sim and renderer both read from this.
// Design doc §13-2: "World size: Suggest 400–600 m rather than the
// reference's 2,400 m, reclaiming budget for density."

/** World extent in metres (square). */
export const WORLD_SIZE = 600;

export const HALF = WORLD_SIZE / 2;

/** Heightmap texels per side. */
export const HEIGHTMAP_RES = 512;

/** Splat/meadow/foliage mask texels per side. */
export const MASK_RES = 256;

/** Distance field resolution (per side). */
export const DF_RES = 128;