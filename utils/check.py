import pandas as pd
import glob
import os
import warnings
warnings.filterwarnings('ignore', category=UserWarning, module='openpyxl')

# Укажи здесь путь к папке, где лежат твои 6 Excel-файлов
PATH_TO_FILES = r'C:\MyPyProjects\reestr\docs' 

def calculate_total_volume(folder_path):
    # Ищем все файлы .xlsx в папке
    files = glob.glob(os.path.join(folder_path, "*.xlsx"))
    
    overall_total = 0
    
    print(f"Найдено файлов: {len(files)}")
    
    for file_path in files:
        file_name = os.path.basename(file_path)
        file_total = 0
        
        try:
            # Читаем все листы сразу, чтобы не открывать файл многократно
            excel_data = pd.read_excel(file_path, sheet_name=None, skiprows=14)
            
            for sheet_name, df in excel_data.items():
                # Пропускаем технические листы
                if "тех" in sheet_name.lower():
                    continue
                
                # Проверяем, что в листе есть данные (минимум 3 колонки)
                if df.shape[1] >= 3:
                    # Считаем заполненные ячейки в колонке "Контрагент" (индекс 2)
                    # Исключаем строки, которые могут быть дублями заголовков
                    valid_rows = df[df.iloc[:, 2].astype(str).str.contains('Контрагент|Получатель', na=False) == False]
                    count = valid_rows.iloc[:, 2].dropna().count()
                    file_total += count
            
            print(f"Файл '{file_name}': {file_total} заявок")
            overall_total += file_total
            
        except Exception as e:
            print(f"Ошибка при обработке {file_name}: {e}")
            
    print("-" * 30)
    print(f"ИТОГО по всем файлам: {overall_total} заявок в месяц")

if __name__ == "__main__":
    calculate_total_volume(PATH_TO_FILES)