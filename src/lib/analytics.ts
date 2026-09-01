const GA4_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]+$/;

export function getGoogleAnalyticsMeasurementId(
  value = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
): string | null {
  const measurementId = value?.trim().toUpperCase();

  return measurementId && GA4_MEASUREMENT_ID_PATTERN.test(measurementId)
    ? measurementId
    : null;
}
