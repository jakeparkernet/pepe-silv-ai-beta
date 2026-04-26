export function mapsShareKey(map1, map2) {
  for (const key of map1.keys()) {
    if (map2.has(key)) return true;
  }
  return false;
}