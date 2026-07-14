import { normalizeRect, type NormalizedRect, type OmrDetection, type OmrModelManifest } from '@cuenote/score-domain';
import { systemRectToPageRect } from './coordinateMapper';
import { nms } from './postprocessing';

export interface OmrTilePolicy {
  enabled: boolean;
  tileWidth: number;
  tileHeight: number;
  overlap: number;
  duplicateMerge: 'NMS';
}

export interface OmrImageTile {
  id: string;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  boundsInSystem: NormalizedRect;
  imageData: ImageData;
}

export function resolveTilePolicy(manifest: OmrModelManifest): OmrTilePolicy | null {
  if (manifest.tiling?.enabled) {
    return sanitizeTilePolicy(manifest.tiling);
  }
  if (manifest.task === 'SYMBOL_DETECTION' && manifest.version.includes('tile')) {
    return sanitizeTilePolicy({
      enabled: true,
      tileWidth: manifest.input.width,
      tileHeight: manifest.input.height,
      overlap: 0.25,
      duplicateMerge: 'NMS'
    });
  }
  return null;
}

export function createImageTiles(imageData: ImageData, policy: OmrTilePolicy): OmrImageTile[] {
  const tileWidth = Math.max(1, Math.min(policy.tileWidth, imageData.width));
  const tileHeight = Math.max(1, Math.min(policy.tileHeight, imageData.height));
  const strideX = Math.max(1, Math.round(tileWidth * (1 - policy.overlap)));
  const strideY = Math.max(1, Math.round(tileHeight * (1 - policy.overlap)));
  const xs = axisPositions(imageData.width, tileWidth, strideX);
  const ys = axisPositions(imageData.height, tileHeight, strideY);
  const source = new OffscreenCanvas(imageData.width, imageData.height);
  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) {
    throw new Error('TENSOR_BUILD_FAILED');
  }
  sourceContext.putImageData(imageData, 0, 0);

  const tiles: OmrImageTile[] = [];
  for (const y of ys) {
    for (const x of xs) {
      const canvas = new OffscreenCanvas(tileWidth, tileHeight);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        throw new Error('TENSOR_BUILD_FAILED');
      }
      context.drawImage(source, x, y, tileWidth, tileHeight, 0, 0, tileWidth, tileHeight);
      const index = tiles.length;
      tiles.push({
        id: `tile-${index}-x${x}-y${y}`,
        index,
        x,
        y,
        width: tileWidth,
        height: tileHeight,
        boundsInSystem: normalizeRect({
          x: x / imageData.width,
          y: y / imageData.height,
          width: tileWidth / imageData.width,
          height: tileHeight / imageData.height
        }),
        imageData: context.getImageData(0, 0, tileWidth, tileHeight)
      });
    }
  }
  return tiles;
}

export function stitchTileDetections(
  detections: OmrDetection[],
  tile: OmrImageTile,
  systemBoundsInPage: NormalizedRect,
  nmsThreshold: number
): OmrDetection[] {
  const stitched = detections.map((detection) => {
    const boundsInSystem = normalizeRect({
      x: tile.boundsInSystem.x + detection.boundsInSystem.x * tile.boundsInSystem.width,
      y: tile.boundsInSystem.y + detection.boundsInSystem.y * tile.boundsInSystem.height,
      width: detection.boundsInSystem.width * tile.boundsInSystem.width,
      height: detection.boundsInSystem.height * tile.boundsInSystem.height
    });
    return {
      ...detection,
      id: `${detection.id}:${tile.id}`,
      boundsInSystem,
      boundsInPage: systemRectToPageRect(boundsInSystem, systemBoundsInPage),
      attributes: {
        ...(detection.attributes ?? {}),
        tileIndex: tile.index,
        tileX: tile.x,
        tileY: tile.y,
        tileWidth: tile.width,
        tileHeight: tile.height,
        tileStitched: true
      }
    };
  });
  return nms(stitched, nmsThreshold);
}

export function mergeTileDetections(detections: OmrDetection[], threshold: number): OmrDetection[] {
  return nms(detections, threshold);
}

function sanitizeTilePolicy(policy: OmrTilePolicy): OmrTilePolicy {
  return {
    enabled: true,
    tileWidth: Math.max(1, Math.round(policy.tileWidth)),
    tileHeight: Math.max(1, Math.round(policy.tileHeight)),
    overlap: Math.min(0.8, Math.max(0, Number(policy.overlap))),
    duplicateMerge: 'NMS'
  };
}

function axisPositions(length: number, tileSize: number, stride: number): number[] {
  if (length <= tileSize) {
    return [0];
  }
  const positions: number[] = [];
  for (let value = 0; value <= length - tileSize; value += stride) {
    positions.push(value);
  }
  const last = length - tileSize;
  if (positions[positions.length - 1] !== last) {
    positions.push(last);
  }
  return positions;
}
