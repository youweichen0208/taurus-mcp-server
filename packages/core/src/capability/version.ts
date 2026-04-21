function parseVersion(version: string | undefined): number[] {
  if (!version) {
    return [];
  }

  const match = version.match(/\d+(?:\.\d+)+/);
  if (!match) {
    return [];
  }

  return match[0]
    .split(".")
    .map((segment) => Number.parseInt(segment, 10))
    .filter((segment) => Number.isFinite(segment));
}

export function compareKernelVersions(left: string | undefined, right: string | undefined): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  const size = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < size; index += 1) {
    const a = leftParts[index] ?? 0;
    const b = rightParts[index] ?? 0;
    if (a === b) {
      continue;
    }
    return a > b ? 1 : -1;
  }

  return 0;
}

export function isKernelVersionAtLeast(
  currentVersion: string | undefined,
  minimumVersion: string | undefined,
): boolean {
  if (!minimumVersion) {
    return true;
  }
  if (!currentVersion) {
    return false;
  }
  return compareKernelVersions(currentVersion, minimumVersion) >= 0;
}

export function extractKernelVersion(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }

  const exact = input.match(/\b\d+\.\d+\.\d+\.\d+\b/);
  if (exact) {
    return exact[0];
  }

  const fallback = input.match(/\b\d+\.\d+\.\d+\b/);
  return fallback?.[0];
}
