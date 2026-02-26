(function () {
  const fallbackDatasetPath = "static/index_mr_dpp0066.json";

  function formatCyclePath(date) {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const HH = String(date.getUTCHours()).padStart(2, "0");
    return `https://harmonie-zarr.s3.amazonaws.com/dini/control/${yyyy}-${mm}-${dd}T${HH}0000Z/single_levels.zarr`;
  }

  async function pathExists(datasetPath) {
    try {
      const response = await fetch(`${datasetPath}/.zgroup`, {
        method: "HEAD",
        cache: "no-store",
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  window.__GRIDLOOK_DATASET_PATH_RESOLVER__ = async function () {
    const lagHours = 3;
    const cycleHours = 3;
    const maxLookbackCycles = 16; // 48 hours

    const t = new Date(Date.now() - lagHours * 60 * 60 * 1000);
    t.setUTCMinutes(0, 0, 0);
    t.setUTCHours(t.getUTCHours() - (t.getUTCHours() % cycleHours));

    for (let i = 0; i < maxLookbackCycles; i += 1) {
      const candidate = new Date(t.getTime() - i * cycleHours * 60 * 60 * 1000);
      const datasetPath = formatCyclePath(candidate);
      if (await pathExists(datasetPath)) {
        return datasetPath;
      }
    }

    return fallbackDatasetPath;
  };

  // Use this same file as the resolver script entrypoint.
  window.__GRIDLOOK_CONFIG__ = {
    defaultDatasetPath: "./runtime-config.js",
    defaultVariableName: "",
    defaultTimeIndex: (availableTimes) => {
      if (!Array.isArray(availableTimes) || availableTimes.length === 0) {
        return 0;
      }

      const nowMs = Date.now();
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let i = 0; i < availableTimes.length; i += 1) {
        const timeMs = Date.parse(availableTimes[i]);
        if (!Number.isFinite(timeMs)) {
          continue;
        }
        const distance = Math.abs(timeMs - nowMs);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
        }
      }

      return bestIndex;
    },
  };
})();
