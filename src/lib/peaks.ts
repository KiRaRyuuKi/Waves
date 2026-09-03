export interface Peaks {
  min: Float32Array;
  max: Float32Array;
}

export function computePeaks(buffer: AudioBuffer, buckets: number): Peaks {
  const channelCount = buffer.numberOfChannels;
  const length = buffer.length;
  const samplesPerBucket = Math.max(1, Math.floor(length / buckets));

  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);

  const channelData: Float32Array[] = [];
  for (let c = 0; c < channelCount; c++) channelData.push(buffer.getChannelData(c));

  for (let b = 0; b < buckets; b++) {
    const start = b * samplesPerBucket;
    const end = Math.min(length, start + samplesPerBucket);
    let bucketMin = 0;
    let bucketMax = 0;
    for (let c = 0; c < channelCount; c++) {
      const data = channelData[c];
      for (let i = start; i < end; i++) {
        const v = data[i];
        if (v < bucketMin) bucketMin = v;
        if (v > bucketMax) bucketMax = v;
      }
    }
    min[b] = bucketMin;
    max[b] = bucketMax;
  }

  return { min, max };
}
