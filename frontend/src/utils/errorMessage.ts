type ErrorResponseData = {
  detail?: unknown;
  message?: unknown;
};

type ErrorLike = {
  response?: {
    data?: ErrorResponseData;
    status?: number;
  };
  message?: unknown;
};

const nonEmptyString = (value: unknown): string | null => (
  typeof value === 'string' && value.trim() ? value : null
);

const detailArrayMessage = (detail: unknown): string | null => {
  if (!Array.isArray(detail)) return null;
  const message = detail
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object' && 'msg' in item) {
        return nonEmptyString((item as { msg?: unknown }).msg) ?? '';
      }
      return '';
    })
    .filter(Boolean)
    .join('; ');
  return message || null;
};

export const getErrorMessage = (error: unknown, fallback: string): string => {
  const errorLike = error as ErrorLike | null | undefined;
  const detail = errorLike?.response?.data?.detail;

  const detailMessage = nonEmptyString(detail);
  if (detailMessage) return detailMessage;

  const validationMessage = detailArrayMessage(detail);
  if (validationMessage) return validationMessage;

  const responseMessage = nonEmptyString(errorLike?.response?.data?.message);
  if (responseMessage) return responseMessage;

  const runtimeMessage = nonEmptyString(errorLike?.message);
  if (runtimeMessage) return runtimeMessage;

  return fallback;
};
