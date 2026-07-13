import type { PageTransform } from '@cuenote/score-domain';

export function preprocessImageData(imageData: ImageData, transform: PageTransform): ImageData {
  const next = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  const data = next.data;
  const brightness = transform.brightness;
  const contrast = transform.contrast;

  for (let index = 0; index < data.length; index += 4) {
    const red = adjustChannel(data[index], brightness, contrast);
    const green = adjustChannel(data[index + 1], brightness, contrast);
    const blue = adjustChannel(data[index + 2], brightness, contrast);
    const threshold = transform.threshold;

    if (threshold === null) {
      data[index] = red;
      data[index + 1] = green;
      data[index + 2] = blue;
    } else {
      const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      const value = luminance / 255 >= threshold ? 255 : 0;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
    }
  }

  return next;
}

function adjustChannel(value: number, brightness: number, contrast: number): number {
  const adjusted = (value - 128) * contrast + 128 * brightness;
  return Math.max(0, Math.min(255, Math.round(adjusted)));
}
