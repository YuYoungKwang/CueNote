import type { OmrModelManifest } from '@cuenote/score-domain';
import { createLetterboxTransform, type LetterboxTransform } from './coordinateMapper';

export interface OmrTensorInput {
  data: Float32Array;
  dims: number[];
  layout: OmrModelManifest['input']['tensorLayout'];
  transform?: LetterboxTransform;
}

export function buildOmrTensorFromImageData(imageData: ImageData, input: OmrModelManifest['input']): OmrTensorInput {
  const canvas = new OffscreenCanvas(input.width, input.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('TENSOR_BUILD_FAILED');
  }

  const source = new OffscreenCanvas(imageData.width, imageData.height);
  const sourceContext = source.getContext('2d');
  if (!sourceContext) {
    throw new Error('TENSOR_BUILD_FAILED');
  }
  sourceContext.putImageData(imageData, 0, 0);

  let transform: LetterboxTransform | undefined;
  if (input.resizeMode === 'LETTERBOX') {
    transform = createLetterboxTransform(imageData.width, imageData.height, input.width, input.height);
    context.clearRect(0, 0, input.width, input.height);
    context.drawImage(source, transform.padLeft, transform.padTop, transform.resizedWidth, transform.resizedHeight);
  } else {
    context.drawImage(source, 0, 0, input.width, input.height);
  }

  const resized = context.getImageData(0, 0, input.width, input.height);
  return {
    data: imageDataToTensor(resized, input),
    dims: input.tensorLayout === 'NCHW' ? [1, input.channels, input.height, input.width] : [1, input.height, input.width, input.channels],
    layout: input.tensorLayout,
    transform
  };
}

function imageDataToTensor(imageData: ImageData, input: OmrModelManifest['input']): Float32Array {
  const pixels = imageData.data;
  const channelCount = input.channels;
  const size = imageData.width * imageData.height * channelCount;
  const tensor = new Float32Array(size);
  const writeValue = (value: number) => convertRange(value, input.valueRange);

  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      const pixelIndex = (y * imageData.width + x) * 4;
      const r = pixels[pixelIndex] ?? 0;
      const g = pixels[pixelIndex + 1] ?? r;
      const b = pixels[pixelIndex + 2] ?? r;
      const gray = Math.round((r + g + b) / 3);

      for (let channel = 0; channel < channelCount; channel += 1) {
        const value = channelCount === 1 ? gray : channel === 0 ? r : channel === 1 ? g : b;
        const targetIndex =
          input.tensorLayout === 'NCHW'
            ? channel * imageData.width * imageData.height + y * imageData.width + x
            : (y * imageData.width + x) * channelCount + channel;
        tensor[targetIndex] = writeValue(value);
      }
    }
  }

  return tensor;
}

function convertRange(value: number, range: OmrModelManifest['input']['valueRange']): number {
  if (range === 'ZERO_TO_255') {
    return value;
  }
  if (range === 'MINUS_ONE_TO_ONE') {
    return value / 127.5 - 1;
  }
  return value / 255;
}
