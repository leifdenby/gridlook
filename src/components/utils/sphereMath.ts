export function latLongToXYZ(
  lat: number,
  lon: number,
  radius = 1.0
): [number, number, number] {
  const latRad = lat * (Math.PI / 180);
  const lonRad = lon * (Math.PI / 180);

  const x = radius * Math.cos(latRad) * Math.cos(lonRad);
  const y = radius * Math.cos(latRad) * Math.sin(lonRad);
  const z = radius * Math.sin(latRad);
  return [x, y, z];
}

export function generateGridIndices(
  latCount: number,
  lonCount: number,
  isGlobal: boolean
) {
  const indices: number[] = [];
  const latIterationEnd = latCount - 1;
  const lonIterationEnd = isGlobal ? lonCount : lonCount - 1;

  for (let latIt = 0; latIt < latIterationEnd; latIt++) {
    for (let lonIt = 0; lonIt < lonIterationEnd; lonIt++) {
      const nextJ = isGlobal ? (lonIt + 1) % lonCount : lonIt + 1;
      const lowLeft = latIt * lonCount + lonIt;
      const lowRight = latIt * lonCount + nextJ;
      const topLeft = (latIt + 1) * lonCount + lonIt;
      const topRight = (latIt + 1) * lonCount + nextJ;

      indices.push(lowLeft, topRight, topLeft);
      indices.push(lowLeft, lowRight, topRight);
    }
  }

  return indices;
}

