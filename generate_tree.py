import os

# Папки и файлы, которые не нужны для понимания архитектуры
IGNORE_DIRS = {
    'node_modules', 'venv', '.venv', 'env', '__pycache__', 
    '.git', '.vscode', '.idea', 'dist', 'build', '.pytest_cache', 'alembic'
}
IGNORE_FILES = {'.DS_Store', 'package-lock.json', 'yarn.lock'}

def generate_tree(startpath: str, output_filename: str) -> None:
    """
    Генерирует дерево проекта и записывает его в файл, игнорируя заданные директории.
    """
    with open(output_filename, 'w', encoding='utf-8') as f:
        f.write("Структура проекта:\n")
        f.write("==================\n\n")
        
        for root, dirs, files in os.walk(startpath):
            # Модифицируем список dirs in-place, чтобы os.walk не заходил в игнорируемые папки
            dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
            
            # Вычисляем уровень вложенности
            level = root.replace(startpath, '').count(os.sep)
            indent = '│   ' * (level - 1) + '├── ' if level > 0 else ''
            
            if level > 0:
                f.write(f"{indent}{os.path.basename(root)}/\n")
            else:
                f.write(f"{os.path.basename(startpath)}/\n")
                
            subindent = '│   ' * level + '├── '
            
            # Сортируем файлы для красоты и записываем
            for file in sorted(files):
                if file not in IGNORE_FILES and not file.endswith('.pyc'):
                    f.write(f"{subindent}{file}\n")

if __name__ == "__main__":
    # Запускаем от текущей директории и сохраняем в project_structure.txt
    current_dir = os.getcwd()
    output_file = 'project_structure.txt'
    generate_tree(current_dir, output_file)
    print(f"✅ Структура проекта успешно сохранена в {output_file}")