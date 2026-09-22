import openpyxl
import json
import sys

# Force UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

wb = openpyxl.load_workbook(r"c:\Users\Administrator\Downloads\Live2D活动-用户端.xlsx", data_only=True)
sheet = wb['Bug清单']

results = []
for row in sheet.iter_rows(min_row=1, max_row=200, values_only=False):
    row_data = []
    for cell in row:
        try:
            val = cell.value
            if val is not None:
                if isinstance(val, str):
                    # Try to decode as UTF-16
                    try:
                        val = val.encode('latin1').decode('utf-16')
                    except:
                        pass
                row_data.append(str(val))
            else:
                row_data.append('')
        except:
            row_data.append(str(cell.value) if cell.value else '')
    results.append(row_data)

with open('excel_output.json', 'w', encoding='utf-8') as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

print(f"Total rows: {len(results)}")
