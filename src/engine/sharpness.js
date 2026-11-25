// Sharpness as the variance of the discrete Laplacian
//
//   L(x, y) = 4 f(x, y) − f(x − 1, y) − f(x + 1, y) − f(x, y − 1) − f(x, y + 1)
//
// over all interior pixels. Blurred or out-of-focus images have fewer strong
// second derivatives and therefore a lower variance. The value is only
// comparable between images of the same analysis size, which is how it is
// used: as a tie-breaker when choosing which copy to keep.

/**
 * @param {Float32Array} gray
 * @param {number} width
 * @param {number} height
 * @returns {number} variance of the Laplacian (0 for images smaller than 3×3)
 */
export function laplacianVariance(gray, width, height) {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const l = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += l;
      sumSq += l * l;
      count++;
    }
  }
  const mean = sum / count;
  return Math.max(0, sumSq / count - mean * mean);
}
