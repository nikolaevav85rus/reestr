import urllib.request, urllib.parse, json

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
            body = json.dumps(data).encode()
    r = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw) if raw else {}
        except Exception:
            return e.code, {'detail': raw.decode('utf-8', errors='replace')}

def login(u):
    code, data = req('POST', '/auth/login', data={'username': u, 'password': '123'}, form=True)
    return data.get('access_token') if code == 200 else None

t = {u: login(u) for u in ['admin', 'feo1', 'cashier1', 'initiator1', 'director1', 'accountant1']}
print('Tokens:', [u for u, v in t.items() if v])

code, orgs = req('GET', '/dict/organizations', t['initiator1'])
code, budgets = req('GET', '/dict/budget_items', t['initiator1'])
code, dirs = req('GET', '/dict/directions', t['initiator1'])
org_id = orgs[0]['id']
bi_id = budgets[0]['id']
dir_id = dirs[0]['id']

def new(desc):
    d = {
        'description': desc, 'note': '', 'amount': 3000.0, 'counterparty': 'Vendor',
        'payment_date': '2026-04-28', 'organization_id': org_id,
        'budget_item_id': bi_id, 'direction_id': dir_id
    }
    code, r = req('POST', '/requests/', t['initiator1'], d)
    return r.get('id') if code in (200, 201) else None

def submit_and_pass_gate(rid):
    req('POST', '/requests/' + rid + '/submit', t['initiator1'])
    code, st = req('GET', '/requests/all', t['admin'])
    r = next((x for x in (st if code == 200 else []) if x['id'] == rid), None)
    if r and r.get('approval_status') == 'PENDING_GATE':
        req('POST', '/requests/' + rid + '/approve_gate', t['feo1'], {'reason': 'test'})

print()
print('=== ЭТАП 9: ДОГОВОР ===')
rid = new('Contract test')
submit_and_pass_gate(rid)
code, r = req('PATCH', '/requests/' + rid + '/contract', t['accountant1'], {'contract_status': 'YES'})
print('9.1 contract=YES (accountant1):', code, r.get('contract_status', '?') if code == 200 else str(r.get('detail', ''))[:60])
code, r = req('PATCH', '/requests/' + rid + '/contract', t['accountant1'], {'contract_status': 'NO'})
print('9.2 contract=NO:', code, r.get('contract_status', '?') if code == 200 else str(r.get('detail', ''))[:60])
code, r = req('PATCH', '/requests/' + rid + '/contract', t['initiator1'], {'contract_status': 'YES'})
print('9.3 initiator1 set contract (expect 403):', code)

print()
print('=== ЭТАП 10: ПОМЕТКА НА УДАЛЕНИЕ ===')
rid2 = new('Delete mark test')
code, r = req('PATCH', '/requests/' + rid2 + '/mark_deletion', t['initiator1'])
print('10.1 Mark own draft:', code, r.get('is_marked_for_deletion', '?') if code == 200 else str(r.get('detail', ''))[:60])
code, r = req('PATCH', '/requests/' + rid2 + '/mark_deletion', t['initiator1'])
print('10.1b Unmark toggle:', code, r.get('is_marked_for_deletion', '?') if code == 200 else str(r.get('detail', ''))[:60])

code, paid = req('GET', '/requests/all?payment_status=PAID', t['admin'])
paid_init = [x for x in (paid if code == 200 else []) if x.get('creator', {}).get('ad_login') == 'initiator1']
if paid_init:
    code, r = req('PATCH', '/requests/' + paid_init[0]['id'] + '/mark_deletion', t['initiator1'])
    print('10.2 Mark own PAID (expect 400):', code, str(r.get('detail', ''))[:50])
else:
    print('10.2 No PAID requests for initiator1 — skip')

rid3 = new('FEO mark test')
code, r = req('PATCH', '/requests/' + rid3 + '/mark_deletion', t['feo1'])
print('10.4 feo1 marks foreign draft:', code, r.get('is_marked_for_deletion', '?') if code == 200 else str(r.get('detail', ''))[:60])

code, marked = req('GET', '/requests/marked_for_deletion', t['admin'])
print('10.7 marked_for_deletion list (admin):', code, 'count=' + str(len(marked)) if code == 200 else str(marked)[:60])

# 10.9 Delete marked
if code == 200 and marked:
    code2, r2 = req('DELETE', '/requests/marked_for_deletion', t['admin'])
    print('10.9 DELETE marked_for_deletion:', code2, r2)
    code3, marked2 = req('GET', '/requests/marked_for_deletion', t['admin'])
    print('    After delete, count:', len(marked2) if code3 == 200 else '?')

print()
print('=== ЭТАП 11: ФИЛЬТРЫ ===')
code, r = req('GET', '/requests/all?payment_date_from=2026-04-01&payment_date_to=2026-04-30', t['feo1'])
print('11.1 date range Apr 2026:', code, 'count=' + str(len(r)) if code == 200 else str(r)[:80])

code, r = req('GET', '/requests/all?organization_id=' + org_id, t['feo1'])
print('11.2 filter by org:', code, 'count=' + str(len(r)) if code == 200 else str(r)[:80])

code, r = req('GET', '/requests/all?approval_status=APPROVED', t['feo1'])
print('11.4 filter status=APPROVED:', code, 'count=' + str(len(r)) if code == 200 else str(r)[:80])

code, r = req('GET', '/requests/all', t['initiator1'])
foreign = [x for x in (r if code == 200 else []) if x.get('creator', {}).get('ad_login') != 'initiator1']
print('11.6 initiator1 RLS — foreign visible:', len(foreign), '(expect 0, total:', len(r) if code == 200 else '?', ')')

code, r = req('GET', '/requests/all?search=workflow', t['feo1'])
print('11.x search=workflow:', code, 'count=' + str(len(r)) if code == 200 else str(r)[:80])

code, r = req('GET', '/requests/all?is_marked_for_deletion=true', t['admin'])
print('10.5 filter marked=true:', code, 'count=' + str(len(r)) if code == 200 else str(r)[:80])

print()
print('=== ИТОГО ЗАЯВОК В БД ===')
code, all_r = req('GET', '/requests/all', t['admin'])
print('Total:', len(all_r) if code == 200 else code)
by_status = {}
for r in (all_r if code == 200 else []):
    s = r.get('approval_status', '?')
    by_status[s] = by_status.get(s, 0) + 1
for s, cnt in sorted(by_status.items()):
    print(' ', s, ':', cnt)
