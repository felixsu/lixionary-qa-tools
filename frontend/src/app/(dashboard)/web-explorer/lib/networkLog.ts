// Small pure helpers for turning captured network-log entries into
// API Explorer request fields.

export const logBaseUrl = (url: string) => url.split("?")[0];

export const parseLogQueryParams = (url: string): { key: string; value: string }[] => {
  try {
    return Array.from(new URL(url).searchParams.entries()).map(([key, value]) => ({ key, value }));
  } catch { return []; }
};

export const suggestRequestName = (url: string): string => {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    return segments[segments.length - 1] || "API Request";
  } catch { return "API Request"; }
};
