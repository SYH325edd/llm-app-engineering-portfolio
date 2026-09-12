function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDefaultSingleDate() {
  return formatLocalDate(new Date());
}

export function getDefaultDateRange() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  return { startDate: formatLocalDate(yesterday), endDate: formatLocalDate(today) };
}

export function normalizeDateRangeForQuery(startDate?: string, endDate?: string) {
  const defaults = getDefaultDateRange();
  return {
    startDate: startDate || defaults.startDate,
    endDate: endDate || defaults.endDate
  };
}
