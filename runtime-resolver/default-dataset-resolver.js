window.__GRIDLOOK_DATASET_PATH_RESOLVER__ = async function () {
  const lagHours = 3;
  const cycleHours = 3;
  const maxLookbackCycles = 16; // 48 hours
  const baseUrl = "https://harmonie-zarr.s3.amazonaws.com/dini/control";
  const datasetName = "single_levels.zarr";

  function cycleStartFrom(date) {
    const d = new Date(date.getTime());
    d.setUTCMinutes(0, 0, 0);
    d.setUTCHours(d.getUTCHours() - (d.getUTCHours() % cycleHours));
    return d;
  }

  function fmt(date) {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const HH = String(date.getUTCHours()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${HH}0000Z`;
  }

  async function pathExists(url) {
    try {
      const response = await fetch(url, { method: "HEAD", cache: "no-store" });
      return response.ok;
    } catch {
      return false;
    }
  }

  const latestCandidate = cycleStartFrom(
    new Date(Date.now() - lagHours * 3600 * 1000)
  );

  for (let i = 0; i < maxLookbackCycles; i += 1) {
    const candidate = new Date(
      latestCandidate.getTime() - i * cycleHours * 3600 * 1000
    );
    const cycle = fmt(candidate);
    const root = `${baseUrl}/${cycle}/${datasetName}`;
    // Support zarr v2 (.zgroup) and v3 (zarr.json)
    const [hasZarrV2, hasZarrV3] = await Promise.all([
      pathExists(`${root}/.zgroup`),
      pathExists(`${root}/zarr.json`),
    ]);
    const ready = hasZarrV2 || hasZarrV3;

    if (ready) {
      return root;
    }
  }

  // Last-resort fallback to latest candidate path.
  return `${baseUrl}/${fmt(latestCandidate)}/${datasetName}`;
};
