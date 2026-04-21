# -*- coding: utf-8 -*-
import urllib.request, urllib.parse, json, itertools
from datetime import date, timedelta

BASE = 'http://127.0.0.1:8080/api/v1'

def req(method, path, token=None, data=None, form=False):
    url = BASE + path
    headers = {'Content-Type': 'application/json'}
    if token: headers['Authorization'] = 'Bearer ' + token
    body = None
    if data:
        if form:
            body = urllib.parse.urlencode(data).encode()
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
        else:
            body = json.dumps(data, ensure_ascii=False).encode('utf-8')
    r = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read(); return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, json.loads(raw) if raw else {}
        except: return e.code, {}

def login(u):
    code, data = req('POST', '/auth/login', data={'username': u, 'password': '123'}, form=True)
    return data.get('access_token') if code==200 else None

tokens = {u: login(u) for u in ['admin', 'initiator1', 'feo1', 'cashier1', 'director1']}

# Загружаем справочники
_, orgs = req('GET', '/dict/organizations', tokens['admin'])
_, dirs = req('GET', '/dict/directions', tokens['admin'])
_, bis  = req('GET', '/dict/budget_items', tokens['admin'])

print(f"Орг: {len(orgs)}, ЦФО: {len(dirs)}, ДДС: {len(bis)}")

# Контрагенты по типу
COUNTERPARTIES = {
    'BANK':      ['Сбербанк', 'ВТБ', 'Газпромбанк', 'Альфа-Банк'],
    'SALARY':    ['Сотрудники АХО', 'Персонал склада', 'Производственный персонал'],
    'TAXES':     ['ИФНС России', 'ФСС', 'ПФР'],
    'SUPPLIERS': ['ООО Метпром', 'АО СтальГрупп', 'ООО ТехноСнаб', 'ИП Федоров', 'ООО ПромЛогистик'],
    'TRANSPORT': ['ТК Деловые Линии', 'ООО Автотранс', 'ИП Перевозчиков'],
    'OTHER':     ['ООО Клининг Сервис', 'АО РосОхрана', 'ООО ИТ-Решения', 'ИП Иванов', 'ООО Консалтинг Плюс'],
}

DESCRIPTIONS = {
    'BANK':      ['Оплата банковской комиссии за расчётно-кассовое обслуживание',
                  'Комиссия за исходящий платёж в валюте',
                  'Плата за обслуживание корпоративной карты'],
    'SALARY':    ['Выплата заработной платы за апрель 2026 года',
                  'Аванс за первую половину апреля 2026 года',
                  'Выплата премии по итогам квартала'],
    'TAXES':     ['Уплата НДС за I квартал 2026 года',
                  'Уплата налога на прибыль организаций',
                  'Страховые взносы в ПФР за март 2026'],
    'SUPPLIERS': ['Оплата поставки металлопроката согласно договору №123',
                  'Предоплата 50% за партию трубного проката',
                  'Оплата арматуры по счёту №А-4521',
                  'Оплата листового металла по договору поставки',
                  'Окончательный расчёт за поставку профиля'],
    'TRANSPORT': ['Оплата транспортных услуг по доставке материалов',
                  'Фрахт автотранспорта для перевозки груза',
                  'Оплата логистических услуг по маршруту Москва–Магнитогорск'],
    'OTHER':     ['Оплата клининговых услуг за апрель 2026 года',
                  'Оплата услуг охраны объекта',
                  'Оплата лицензии на программное обеспечение',
                  'Оплата консультационных услуг по налогообложению',
                  'Аренда офисного оборудования'],
}

NOTES = {
    'BANK':      ['Ежемесячная комиссия — плановый платёж',
                  'Разовая транзакция по валютному контракту',
                  'Обслуживание карт топ-менеджмента'],
    'SALARY':    ['Зарплата производственного цеха №2',
                  'Аванс — 40% от оклада согласно трудовому договору',
                  'Квартальная премия по KPI'],
    'TAXES':     ['Квартальный налог — срок 25 апреля',
                  'Авансовый платёж по налогу на прибыль',
                  'Социальные взносы за март — плановый платёж'],
    'SUPPLIERS': ['Плановая закупка по годовому договору поставки',
                  'Предоплата под производственную программу мая',
                  'Срочная закупка для выполнения заказа №8801',
                  'Плановая поставка склад №3',
                  'Закрытие задолженности по договору'],
    'TRANSPORT': ['Доставка с завода НЛМК',
                  'Межрегиональная перевозка сборного груза',
                  'Плановая логистика по маршруту апреля'],
    'OTHER':     ['Ежемесячный сервисный контракт',
                  'Годовой договор охраны, апрельский платёж',
                  'Продление лицензий 1С и MS Office',
                  'Разовая консультация по налоговой оптимизации',
                  'Аренда принтеров и МФУ'],
}

AMOUNTS = {
    'BANK':      [15000, 28500, 42000, 8750, 63000],
    'SALARY':    [850000, 1200000, 450000, 320000, 2100000],
    'TAXES':     [380000, 920000, 540000, 1650000, 275000],
    'SUPPLIERS': [2500000, 1800000, 750000, 4200000, 960000, 3300000, 1100000],
    'TRANSPORT': [85000, 140000, 220000, 65000, 195000],
    'OTHER':     [45000, 120000, 380000, 95000, 55000, 210000],
}

# Платёжные даты (разброс по апрелю-маю)
dates = [
    '2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24', '2026-04-25',
    '2026-04-28', '2026-04-29', '2026-04-30', '2026-05-05', '2026-05-06',
    '2026-05-07', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15',
]

created = 0
errors = 0

# Проходим по всем комбинациям org × dir × bi (циклически)
combos = list(itertools.product(orgs, dirs, bis))
import random
random.seed(42)
random.shuffle(combos)

# Берём достаточно комбинаций чтобы покрыть всё
# Цель: каждая орг, каждое цфо, каждая ддс — хотя бы раз
seen_orgs = set()
seen_dirs = set()
seen_bis  = set()
selected  = []

for org, d, bi in combos:
    if org['id'] not in seen_orgs or d['id'] not in seen_dirs or bi['id'] not in seen_bis:
        selected.append((org, d, bi))
        seen_orgs.add(org['id'])
        seen_dirs.add(d['id'])
        seen_bis.add(bi['id'])
    if len(seen_orgs) == len(orgs) and len(seen_dirs) == len(dirs) and len(seen_bis) == len(bis):
        # Добавляем ещё немного для разнообразия
        if len(selected) >= max(len(orgs), len(dirs), len(bis)) * 2:
            break

# Добавляем ещё случайных для объёма
extras = random.sample(combos, min(30, len(combos)))
selected += extras

print(f"Будет создано заявок: {len(selected)}")

for i, (org, d, bi) in enumerate(selected):
    cat = bi.get('category', 'OTHER')
    cp_list  = COUNTERPARTIES.get(cat, COUNTERPARTIES['OTHER'])
    desc_list = DESCRIPTIONS.get(cat, DESCRIPTIONS['OTHER'])
    note_list = NOTES.get(cat, NOTES['OTHER'])
    amt_list  = AMOUNTS.get(cat, AMOUNTS['OTHER'])

    counterparty = cp_list[i % len(cp_list)]
    description  = desc_list[i % len(desc_list)]
    note         = note_list[i % len(note_list)]
    amount       = amt_list[i % len(amt_list)]
    pay_date     = dates[i % len(dates)]

    data = {
        'description': description,
        'note': note,
        'amount': float(amount),
        'counterparty': counterparty,
        'payment_date': pay_date,
        'organization_id': org['id'],
        'budget_item_id': bi['id'],
        'direction_id': d['id'],
    }

    code, r = req('POST', '/requests/', tokens['initiator1'], data)
    if code in (200, 201):
        created += 1
        if created % 10 == 0:
            print(f"  Создано: {created}...")
    else:
        errors += 1
        print(f"  ОШИБКА: {r.get('detail', '')[:80]}")

print(f"\nИтого создано: {created}, ошибок: {errors}")

# Проверка покрытия
_, all_req = req('GET', '/requests/all', tokens['admin'])
if isinstance(all_req, list):
    used_orgs = {r['organization_id'] for r in all_req}
    used_dirs = {r['direction_id'] for r in all_req if r.get('direction_id')}
    used_bis  = {r['budget_item_id'] for r in all_req if r.get('budget_item_id')}
    print(f"Покрытие орг: {len(used_orgs)}/{len(orgs)}")
    print(f"Покрытие ЦФО: {len(used_dirs)}/{len(dirs)}")
    print(f"Покрытие ДДС: {len(used_bis)}/{len(bis)}")
    print(f"Всего заявок в БД: {len(all_req)}")
