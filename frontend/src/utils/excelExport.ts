import * as XLSX from 'xlsx';

export type ExcelColumn<T = any> = {
  key: string;
  label: string;
  visible: boolean;
  order: number;
  value: (row: T) => string | number | boolean | null | undefined;
};

function safeSheetName(name: string): string {
  return (name || 'Реестр').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
}

export function exportRowsToExcel<T>(rows: T[], columns: ExcelColumn<T>[], fileName: string, sheetName = 'Реестр') {
  const visibleColumns = columns
    .filter((column) => column.visible)
    .sort((a, b) => a.order - b.order);

  const data = rows.map((row) => {
    const item: Record<string, string | number | boolean> = {};
    for (const column of visibleColumns) {
      const value = column.value(row);
      item[column.label] = value ?? '';
    }
    return item;
  });

  const worksheet = XLSX.utils.json_to_sheet(data);
  worksheet['!cols'] = visibleColumns.map((column) => ({ wch: Math.max(12, Math.min(36, column.label.length + 6)) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(sheetName));
  XLSX.writeFile(workbook, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}

export function formatDateRu(value?: string | null) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU') : '';
}

export function formatMoney(value?: number | null) {
  return value == null ? '' : Number(value.toFixed(2));
}
